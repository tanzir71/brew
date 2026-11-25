import Database from 'better-sqlite3';
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, migrateDatabase } from './src/db/database.js';
import { articles, feeds } from './src/db/schema.js';
import { NewsletterService } from './src/services/newsletter-service.js';
import { NodeNewsletterStorage } from './src/ports/newsletter-storage.js';
import { ArticleService } from './src/services/article-service.js';
import { RulesService } from './src/services/rules-service.js';
import { PollerService } from './src/services/poller-service.js';
import { BrewService } from './src/services/brew-service.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';
import { newsletterCorpus } from '../../packages/core/test/newsletter-corpus.js';
import { parseNewsletterMime } from '../../packages/core/src/newsletter-mime.js';
import type { NewsletterMessage } from '../../packages/core/src/types/newsletters.js';
import { createApp } from './src/app.js';

const now = new Date('2026-11-26T12:00:00Z');
const clock = { now: () => new Date(now), monotonic: () => 0 };
const closers: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
function setup() {
  const database = openDatabase(':memory:');
  closers.push(() => {
    if (database.sqlite.open) database.close();
  });
  return { database, service: new NewsletterService(database, clock) };
}
const message = (extra: Partial<NewsletterMessage> = {}): NewsletterMessage => ({
  from: { address: 'NEWS@Journal.TEST', name: 'Field Notes' },
  subject: 'Dispatch',
  messageId: '<one@journal.test>',
  date: now.toISOString(),
  html: '<h2>Keep this story</h2><p>Forest walks and quiet tools.</p>',
  ...extra,
});

describe('newsletter ingestion through the real Node database', () => {
  it('migrates existing RSS data losslessly with safe defaults, idempotently', () => {
    const sqlite = new Database(':memory:');
    closers.push(() => sqlite.close());
    sqlite.exec(
      'CREATE TABLE __brew_migrations(name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)',
    );
    const directory = new URL('../../packages/db/migrations/', import.meta.url);
    for (const file of fs
      .readdirSync(directory)
      .filter((file) => file.endsWith('.sql') && file < '0008')) {
      sqlite.exec(fs.readFileSync(new URL(file, directory), 'utf8'));
      sqlite.prepare('INSERT INTO __brew_migrations VALUES(?,0)').run(file);
    }
    sqlite.exec(
      "INSERT INTO feeds(id,url,title,retention_days) VALUES(1,'https://journal.test/rss','Personal title',45)",
    );
    sqlite
      .prepare(
        'INSERT INTO articles(feed_id,guid,url,title,content_html,published_at,hash) VALUES(1,?,?,?,?,?,?)',
      )
      .run('one', 'https://journal.test/one', 'Story', '<p>Original RSS</p>', now.getTime(), 'one');
    const before = sqlite.prepare('SELECT * FROM articles').get();
    migrateDatabase(sqlite);
    migrateDatabase(sqlite);
    expect(sqlite.prepare('SELECT * FROM articles').get()).toEqual({
      ...(before as object),
      raw_html: null,
      cleaning_json: null,
    });
    expect(
      sqlite.prepare('SELECT kind,settings_json,title,retention_days FROM feeds').get(),
    ).toEqual({ kind: 'rss', settings_json: '{}', title: 'Personal title', retention_days: 45 });
  });

  it('auto-creates one normalized sender, atomically deduplicates replays, and preserves repeated subjects', async () => {
    const { database, service } = setup();
    const first = await service.ingestMessage(message());
    const duplicate = await service.ingestMessage(message({ html: '<p>A modified retry</p>' }));
    expect(duplicate).toEqual({ ...first, outcome: 'duplicate' });
    await service.ingestMessage(message({ messageId: '<two@journal.test>' }));
    await service.ingestMessage(message({ from: { address: 'other@journal.test' } }));
    const storedFeeds = database.db.select().from(feeds).all();
    expect(storedFeeds).toHaveLength(2);
    expect(storedFeeds[0]).toMatchObject({
      kind: 'newsletter',
      url: 'mailto:news@journal.test',
      title: 'Field Notes',
      retentionDays: 90,
    });
    expect(JSON.parse(storedFeeds[0]!.settingsJson)).toEqual({
      favorite: false,
      skipInbox: false,
      blocked: false,
      onlyInBrew: false,
      retentionDays: 90,
    });
    expect(database.db.select().from(articles).all()).toHaveLength(3);
    expect(new ArticleService(database).get(first.articleId!)?.url).toBe(`/a/${first.articleId}`);
    database.sqlite.prepare('UPDATE feeds SET title=? WHERE id=?').run('My title', first.feedId);
    await service.ingestMessage(message({ messageId: '<three@journal.test>' }));
    expect(database.db.select().from(feeds).all()[0]?.title).toBe('My title');
  });

  it('uses deterministic fallback IDs without equating distinct undated letters', async () => {
    const { database, service } = setup();
    const input = message({ messageId: undefined, date: undefined });
    const first = await service.ingestMessage(input);
    expect((await service.ingestMessage(input)).articleId).toBe(first.articleId);
    expect(
      (await service.ingestMessage({ ...input, html: '<p>A different dispatch</p>' })).outcome,
    ).toBe('inserted');
    expect(database.db.select().from(articles).all()).toHaveLength(2);
  });

  it('stores all 20 cleaned fixtures as ordinary searchable articles while retaining decoded originals', async () => {
    const { database, service } = setup();
    for (const [index, fixture] of newsletterCorpus.entries()) {
      const sender = new NodeNewsletterStorage(database).ensureSender({
        address: `sender${index}@journal.test`,
        name: fixture.name,
      });
      if (fixture.selectors)
        database.sqlite
          .prepare('UPDATE feeds SET settings_json=? WHERE id=?')
          .run(JSON.stringify({ cleaning: fixture.selectors }), sender.id);
      const raw = `From: sender${index}@journal.test\r\nSubject: ${fixture.name}\r\nMessage-ID: <${index}@journal.test>\r\nDate: ${now.toUTCString()}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${fixture.html}`;
      const decoded = await parseNewsletterMime(raw);
      const result = await service.ingest(raw);
      const row = database.db
        .select()
        .from(articles)
        .all()
        .find((article) => article.id === result.articleId)!;
      expect(row.rawHtml).toBe(decoded.html);
      expect(row.contentHtml).not.toMatch(/secretadtoken|<script|<form|onclick|onload|utm_|mc_eid/);
      expect(JSON.parse(row.cleaningJson!)).toEqual({
        trackers: fixture.trackers,
        sponsorBlocks: fixture.sponsors,
        footerTrimmed: !!fixture.footer,
      });
      expect(new ArticleService(database).get(row.id)).not.toHaveProperty('rawHtml');
    }
    expect(
      database.sqlite
        .prepare("SELECT count(*) AS n FROM articles_fts WHERE articles_fts MATCH 'secretadtoken'")
        .get(),
    ).toEqual({ n: 0 });
    expect(
      database.sqlite
        .prepare("SELECT count(*) AS n FROM articles_fts WHERE articles_fts MATCH 'story'")
        .get(),
    ).toEqual({ n: 20 });
  });

  it('runs actual rules once per inserted letter and exposes tags and letters to Reader and a feed-sourced Brew', async () => {
    const { database } = setup();
    const rules = new RulesService(database);
    rules.create({
      name: 'Keep walks',
      enabled: true,
      matchType: 'all',
      scope: {},
      conditions: [{ field: 'content', operator: 'contains', value: 'Forest' }],
      actions: [{ type: 'add_tag', tag: 'Outdoors' }, { type: 'star' }],
      stopProcessing: false,
    });
    const service = new NewsletterService(database, clock, rules);
    const result = await service.ingestMessage(message());
    await service.ingestMessage(message());
    const detail = new ArticleService(database).get(result.articleId!);
    expect(detail?.starredAt).toBeTruthy();
    expect(detail?.tags.map((tag) => tag.name)).toEqual(['Outdoors']);
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM rule_logs').get()).toEqual({ n: 1 });
    const brew = new BrewService(database, clock);
    const config = brew.createComposition({
      name: 'Letters',
      enabled: true,
      timezone: 'UTC',
      schedule: { kind: 'daily', time: '12:00' },
      delivery: defaultDelivery(),
      sections: [
        {
          ...newBrewSection('letters'),
          sources: [{ kind: 'feed', id: result.feedId }],
          onlyUnread: false,
          depth: 'full',
        },
      ],
    });
    const preview = await brew.previewBrew(config.id, now.toISOString());
    expect(preview?.snapshot.sections[0]?.items[0]).toMatchObject({
      id: result.articleId,
      title: 'Dispatch',
    });
    const app = await createApp({ database, clock });
    closers.push(() => app.close());
    const response = await app.inject(`/api/articles/${result.articleId}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().contentHtml).toContain('Forest walks');
    expect(response.body).not.toMatch(/rawHtml|raw_html|cleaningJson/);
    expect((await app.inject('/api/capabilities')).json().inboundMail).toBeNull();
  });

  it('honors blocked senders and custom cleaning while storing inbox preferences without hiding stories', async () => {
    const { database, service } = setup();
    const first = await service.ingestMessage(message());
    database.sqlite
      .prepare('UPDATE feeds SET settings_json=? WHERE id=?')
      .run(JSON.stringify({ blocked: true }), first.feedId);
    expect(await service.ingestMessage(message({ messageId: 'blocked' }))).toEqual({
      feedId: first.feedId,
      articleId: null,
      outcome: 'blocked',
    });
    database.sqlite.prepare('UPDATE feeds SET settings_json=? WHERE id=?').run(
      JSON.stringify({
        favorite: true,
        skipInbox: true,
        onlyInBrew: true,
        cleaning: { sponsorSelectors: ['#partner'] },
      }),
      first.feedId,
    );
    const next = await service.ingestMessage(
      message({ messageId: 'next', html: '<p>Story</p><div id="partner">secretadtoken</div>' }),
    );
    expect(new ArticleService(database).get(next.articleId!)?.contentHtml).toBe('<p>Story</p>');
    expect(
      database.db
        .select()
        .from(articles)
        .all()
        .map((article) => article.hidden),
    ).toEqual([false, false]);
  });

  it('prunes originals of retained starred/tagged stories and deletes expired unprotected letters', async () => {
    const { database, service } = setup();
    const one = await service.ingestMessage(message());
    const two = await service.ingestMessage(message({ messageId: 'two' }));
    await service.ingestMessage(message({ messageId: 'three' }));
    database.sqlite
      .prepare('UPDATE articles SET published_at=?')
      .run(now.getTime() - 40 * 86_400_000);
    database.sqlite
      .prepare('UPDATE articles SET starred_at=? WHERE id=?')
      .run(now.getTime(), one.articleId);
    database.sqlite.exec("INSERT INTO tags(id,name,color) VALUES(1,'Keep','#000')");
    database.sqlite
      .prepare('INSERT INTO article_tags(article_id,tag_id) VALUES(?,1)')
      .run(two.articleId);
    database.sqlite.prepare('UPDATE feeds SET retention_days=30 WHERE id=?').run(one.feedId);
    await service.ingestMessage(message({ messageId: 'fresh' }));
    const rows = database.db.select().from(articles).all();
    expect(rows.map((row) => row.guid)).toEqual([
      'newsletter:<one@journal.test>',
      'newsletter:two',
      'newsletter:fresh',
    ]);
    expect(rows.slice(0, 2).map((row) => row.rawHtml)).toEqual([null, null]);
    expect(rows.slice(0, 2).every((row) => row.contentHtml?.includes('Forest'))).toBe(true);
  });

  it('escapes text-only letters, falls back from invalid/future dates, and rejects malformed messages before writes', async () => {
    const { database, service } = setup();
    await expect(service.ingest('From: broken\r\n\r\nBody')).rejects.toThrow('valid From');
    await expect(
      service.ingestMessage(message({ html: 'x'.repeat(2 * 1024 * 1024 + 1) })),
    ).rejects.toThrow('2 MiB');
    expect(database.db.select().from(feeds).all()).toEqual([]);
    for (const date of ['invalid', '2099-01-01'])
      await service.ingestMessage(
        message({ html: undefined, text: '<script>& story', messageId: date, date }),
      );
    const rows = database.db.select().from(articles).all();
    expect(rows.every((row) => row.publishedAt.getTime() === now.getTime())).toBe(true);
    expect(rows[0]?.contentHtml).toBe('<pre>&lt;script&gt;&amp; story</pre>');
    expect(rows[0]?.rawHtml).toBe('<pre>&lt;script&gt;&amp; story</pre>');
  });

  it('expires originals without new mail, including blocked senders, while leaving RSS policy unchanged', async () => {
    const { database, service } = setup();
    const result = await service.ingestMessage(message());
    database.sqlite
      .prepare('UPDATE feeds SET settings_json=? WHERE id=?')
      .run('{"blocked":true}', result.feedId);
    database.sqlite
      .prepare('UPDATE articles SET published_at=?,starred_at=?')
      .run(now.getTime() - 91 * 86_400_000, now.getTime());
    const rss = database.db
      .insert(feeds)
      .values({ url: 'https://journal.test/rss', title: 'RSS' })
      .returning()
      .get();
    database.db
      .insert(articles)
      .values({
        feedId: rss.id,
        guid: 'rss',
        hash: 'rss',
        url: 'https://journal.test/rss/old',
        title: 'Old RSS',
        publishedAt: new Date(now.getTime() - 91 * 86_400_000),
      })
      .run();
    const app = await createApp({ database, clock, startPoller: true });
    closers.push(() => app.close());
    expect(database.db.select().from(articles).get()).toMatchObject({
      rawHtml: null,
      contentHtml: message().html,
    });
    expect(new ArticleService(database).get(result.articleId!)).toBeTruthy();
    expect(
      database.sqlite.prepare('SELECT count(*) AS n FROM articles WHERE feed_id=?').get(rss.id),
    ).toEqual({ n: 1 });
    expect((await service.ingestMessage(message({ messageId: 'blocked' }))).outcome).toBe(
      'blocked',
    );
  });

  it('never polls newsletter senders over HTTP, including explicit refresh requests', async () => {
    const { database, service } = setup();
    const result = await service.ingestMessage(message());
    const fetcher = vi.fn<typeof fetch>();
    const poller = new PollerService(database, fetcher);
    expect(poller.dueFeeds()).toEqual([]);
    expect(await poller.pollDue()).toEqual([]);
    expect(await poller.pollFeedById(result.feedId)).toMatchObject({
      outcome: 'error',
      newItems: 0,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(database.db.select().from(feeds).all()[0]).toMatchObject({
      lastFetchedAt: null,
      consecutiveFailures: 0,
    });
  });
});
