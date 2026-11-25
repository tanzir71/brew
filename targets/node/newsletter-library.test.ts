import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './src/db/database.js';
import { NewsletterService } from './src/services/newsletter-service.js';
import { NewsletterLibrary } from './src/services/newsletter-library.js';
import { BrewService } from './src/services/brew-service.js';
import { ReaderService } from './src/services/reader-service.js';
import { ArticleService } from './src/services/article-service.js';
import { createApp } from './src/app.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';
import { originalNewsletterPolicy } from '../../packages/api/src/newsletters.js';
import { feeds } from './src/db/schema.js';

const now = new Date('2026-11-26T12:00:00Z');
const clock = { now: () => new Date(now), monotonic: () => 0 };
const closes: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
async function setup() {
  const database = openDatabase(':memory:');
  const app = await createApp({ database, clock });
  closes.push(() => app.close());
  const pipeline = new NewsletterService(database, clock);
  const library = new NewsletterLibrary(database, clock);
  const letter = async (id: string, from = 'notes@journal.test') =>
    pipeline.ingestMessage({
      from: { address: from, name: from.split('@')[0]! },
      messageId: id,
      subject: `Letter ${id}`,
      date: now.toISOString(),
      html: '<p>Forest story</p><div class="sponsor">Sponsor original</div><footer><a href="https://journal.test/unsubscribe">Unsubscribe original</a></footer><img width="1" src="https://metrics.test/open">',
    });
  const brew = new BrewService(database, clock);
  const makeBrew = (name: string) =>
    brew.createComposition({
      name,
      timezone: 'UTC',
      enabled: true,
      schedule: { kind: 'daily', time: '12:00' },
      delivery: defaultDelivery(),
      sections: [{ ...newBrewSection('note', 'note'), note: 'Keep this note' }],
    });
  return { app, database, pipeline, library, letter, brew, makeBrew };
}

describe('Newsletter library and sender actions', () => {
  it('reports real sender counts and Inbox/Favorites/Skipped/Blocked filters without losing retained letters', async () => {
    const { app, library, letter, database } = await setup();
    const one = await letter('one');
    await letter('two');
    const two = await letter('other', 'other@journal.test');
    database.sqlite
      .prepare('UPDATE articles SET read_at=? WHERE id=?')
      .run(now.getTime(), one.articleId);
    let overview = library.overview();
    expect(overview.unreadCount).toBe(2);
    expect(overview.senders.find((sender) => sender.id === one.feedId)).toMatchObject({
      unreadCount: 1,
      letterCount: 2,
    });
    library.updateSender(one.feedId, { favorite: true });
    expect(library.letters({ view: 'favorites', page: 1 }).total).toBe(2);
    library.updateSender(one.feedId, { skipInbox: true });
    expect(library.letters({ view: 'inbox', page: 1 }).items.map((item) => item.id)).toEqual([
      two.articleId,
    ]);
    expect(library.letters({ view: 'skipped', page: 1 }).total).toBe(2);
    library.updateSender(one.feedId, { blocked: true });
    overview = library.overview();
    expect(overview.counts).toEqual({ inbox: 1, favorites: 0, skipped: 0, blocked: 2 });
    expect(overview.unreadCount).toBe(1);
    expect(library.letters({ view: 'blocked', senderId: one.feedId, page: 1 }).total).toBe(2);
    library.updateSender(one.feedId, { blocked: false, skipInbox: false });
    expect(library.letters({ view: 'inbox', page: 1 }).total).toBe(3);
    expect(library.letter(one.articleId!)?.sender.settings.favorite).toBe(true);
    database.sqlite
      .prepare('UPDATE articles SET published_at=? WHERE id=?')
      .run(now.getTime() - 25 * 3_600_000, two.articleId);
    expect((await app.inject('/api/reader/navigation')).json().counts.today).toBe(1);
    const saved = await app.inject({
      method: 'PATCH',
      url: `/api/articles/${two.articleId}`,
      payload: { read: true },
    });
    expect(saved.json().readAt).toBe(now.toISOString());
  });
  it('paginates deterministically and rejects invalid API inputs without writes', async () => {
    const { app, library, letter, database } = await setup();
    for (let index = 0; index < 53; index++) await letter(String(index));
    const first = library.letters({ view: 'inbox', page: 1 });
    const last = library.letters({ view: 'inbox', page: 2 });
    expect(first.items).toHaveLength(50);
    expect(last.items).toHaveLength(3);
    expect(new Set([...first.items, ...last.items].map((item) => item.id)).size).toBe(53);
    expect(first.items[0]?.title).toBe('Letter 52');
    const before = database.sqlite.prepare('SELECT total_changes() AS n').get();
    for (const query of ['view=unknown', 'page=0', 'page=1.1', 'sender=-1', 'page=Infinity'])
      expect((await app.inject(`/api/newsletters/letters?${query}`)).statusCode).toBe(400);
    expect(database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  });
  it('validates partial settings atomically and applies per-sender cleaning overrides to future mail', async () => {
    const { app, library, letter, database, pipeline } = await setup();
    const item = await letter('first');
    const before = library.overview();
    for (const payload of [
      { onlyInBrew: true },
      { favorite: 'false' },
      { retentionDays: 0 },
      { retentionDays: 1.5 },
      { retentionDays: 3651 },
      { brewId: -1 },
      { kind: 'rss' },
      { cleaning: { sponsorSelectors: ['['] } },
    ])
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/api/newsletters/senders/${item.feedId}`,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    expect(library.overview()).toEqual(before);
    await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/api/newsletters/senders/${item.feedId}`,
        payload: { favorite: true },
      }),
      app.inject({
        method: 'PATCH',
        url: `/api/newsletters/senders/${item.feedId}`,
        payload: { skipInbox: true },
      }),
    ]);
    library.updateSender(item.feedId, { cleaning: { sponsorSelectors: ['#partner'] } });
    const result = await pipeline.ingestMessage({
      from: { address: 'notes@journal.test' },
      messageId: 'future',
      date: now.toISOString(),
      html: '<p>New story</p><div id="partner">Custom sponsor</div>',
    });
    expect(library.letter(result.articleId!)?.contentHtml).toBe('<p>New story</p>');
    expect(library.letter(item.articleId!)?.sender.settings).toMatchObject({
      favorite: true,
      skipInbox: true,
    });
    expect(
      (
        database.sqlite.prepare('SELECT raw_html FROM articles WHERE id=?').get(item.articleId) as {
          raw_html: string;
        }
      ).raw_html,
    ).toContain('Sponsor original');
  });
  it('routes a sender to a real Brew, preserves custom sources and frozen issues, and moves only its managed reference', async () => {
    const { library, letter, brew, makeBrew, database } = await setup();
    const item = await letter('first');
    const other = await letter('other', 'other@journal.test');
    const morning = makeBrew('Morning');
    const weekend = makeBrew('Weekend');
    library.updateSender(item.feedId, { brewId: morning.id });
    library.updateSender(other.feedId, { brewId: morning.id });
    const preview = await brew.previewBrew(morning.id, now.toISOString());
    expect(
      preview?.snapshot.sections
        .find((section) => section.title === 'From your newsletters')
        ?.items.map((article) => article.id)
        .sort(),
    ).toEqual([item.articleId, other.articleId].sort());
    const frozen = await brew.generateComposition(morning.id);
    const before = database.sqlite
      .prepare('SELECT payload_json FROM brews WHERE id=?')
      .get(frozen.id);
    library.updateSender(item.feedId, { brewId: weekend.id });
    expect(
      brew
        .composition(morning.id)
        ?.sections.find((section) => section.id === 'brew:newsletter-senders')?.sources,
    ).toEqual([{ kind: 'feed', id: other.feedId }]);
    expect(
      brew
        .composition(weekend.id)
        ?.sections.some(
          (section) =>
            section.layout === 'grid' &&
            section.sources.some((source) => source.id === item.feedId),
        ),
    ).toBe(true);
    library.updateSender(item.feedId, { brewId: null });
    expect(brew.composition(weekend.id)?.sections.map((section) => section.id)).toEqual(['note']);
    expect(
      database.sqlite.prepare('SELECT payload_json FROM brews WHERE id=?').get(frozen.id),
    ).toEqual(before);
    expect(() => library.updateSender(other.feedId, { brewId: 9999 })).toThrow('no longer exists');
    expect(library.letter(other.articleId!)?.sender.settings.brewId).toBe(morning.id);
  });
  it('honors Only in Brew in general Reader lists/bulk-read while keeping explicit saved/search/direct access', async () => {
    const { library, letter, makeBrew, database, brew } = await setup();
    const item = await letter('only');
    const plain = await letter('plain', 'plain@journal.test');
    const config = makeBrew('Morning');
    library.updateSender(item.feedId, { brewId: config.id, onlyInBrew: true });
    const reader = new ReaderService(database, () => now);
    const articles = new ArticleService(database);
    expect(reader.navigation().counts.all).toBe(1);
    expect(reader.articles({ view: 'all' }).items.map((row) => row.id)).toEqual([plain.articleId]);
    expect(articles.markAllRead({ view: 'all' }).updated).toBe(1);
    expect(articles.get(item.articleId!)?.readAt).toBeNull();
    expect(reader.articles({ view: 'all', feedId: item.feedId }).items[0]?.id).toBe(item.articleId);
    articles.updateState(item.articleId!, { starred: true });
    expect(reader.articles({ view: 'starred' }).items[0]?.id).toBe(item.articleId);
    expect(
      (await brew.previewBrew(config.id, now.toISOString()))?.snapshot.sections.at(-1)?.items[0]
        ?.id,
    ).toBe(item.articleId);
    brew.delete(config.id);
    expect(library.letter(item.articleId!)?.sender.settings).toMatchObject({ onlyInBrew: false });
    expect(library.letter(item.articleId!)?.sender.settings.brewId).toBeUndefined();
    expect(reader.navigation().counts.all).toBe(1); // Plain was marked read; the routed letter is visible again.
  });
  it('prunes originals on retention change while preserving tagged/starred cleaned content and rejecting RSS IDs', async () => {
    const { library, letter, database, app } = await setup();
    const item = await letter('old');
    await letter('delete');
    database.sqlite
      .prepare('UPDATE articles SET published_at=?')
      .run(now.getTime() - 60 * 86_400_000);
    database.sqlite
      .prepare('UPDATE articles SET starred_at=? WHERE id=?')
      .run(now.getTime(), item.articleId);
    library.updateSender(item.feedId, { retentionDays: 30 });
    expect(library.letter(item.articleId!)).toMatchObject({
      originalAvailable: false,
      contentHtml: '<p>Forest story</p>',
    });
    expect(library.letters({ view: 'inbox', page: 1 }).total).toBe(1);
    expect(
      (await app.inject(`/api/newsletters/letters/${item.articleId}/original`)).statusCode,
    ).toBe(404);
    const rss = database.db
      .insert(feeds)
      .values({ title: 'RSS', url: 'https://journal.test/rss' })
      .returning()
      .get();
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/newsletters/senders/${rss.id}`,
          payload: { blocked: true },
        })
      ).statusCode,
    ).toBe(404);
    expect(library.overview().senders).toHaveLength(1);
    expect(
      JSON.parse(
        (
          database.sqlite
            .prepare('SELECT settings_json FROM feeds WHERE id=?')
            .get(item.feedId) as { settings_json: string }
        ).settings_json,
      ).retentionDays,
    ).toBe(30);
  });
  it('returns an inert uncleaned original with strict CSP, and keeps raw HTML out of JSON endpoints', async () => {
    const { app, letter, library, database } = await setup();
    const item = await letter('original');
    database.sqlite
      .prepare('UPDATE articles SET raw_html=raw_html||? WHERE id=?')
      .run(
        '<script>evil()</script><style>body{background:url(https://metrics.test/x)}</style><iframe src="https://metrics.test/frame"></iframe><p onclick="evil()">Original words</p><a href="https://metrics.test/link">Original link</a>',
        item.articleId,
      );
    const response = await app.inject(`/api/newsletters/letters/${item.articleId}/original`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toBe(originalNewsletterPolicy);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toContain('Sponsor original');
    expect(response.body).toContain('Unsubscribe original');
    expect(response.body).not.toMatch(/<script|<iframe|<img|onclick|href=|metrics\.test/);
    expect(response.body).toContain('font-style:normal!important');
    for (const path of [
      `/api/articles/${item.articleId}`,
      `/api/newsletters/letters/${item.articleId}`,
    ]) {
      const data = await app.inject(path);
      expect(data.body).not.toMatch(/rawHtml|raw_html|Sponsor original|Unsubscribe original/);
    }
    expect(library.letter(item.articleId!)?.cleaning).toEqual({
      trackers: 1,
      sponsorBlocks: 1,
      footerTrimmed: true,
    });
  });
});
