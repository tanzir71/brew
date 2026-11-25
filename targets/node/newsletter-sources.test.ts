import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './src/db/database.js';
import { createApp } from './src/app.js';
import { articles, feeds } from './src/db/schema.js';
import { BrewService } from './src/services/brew-service.js';
import { NewsletterService } from './src/services/newsletter-service.js';
import { ArticleService } from './src/services/article-service.js';
import { NewsletterLibrary } from './src/services/newsletter-library.js';
import {
  defaultDelivery,
  newBrewSection,
  sectionWithSources,
} from '../../packages/core/src/composition-model.js';
import type { BrewSourceRef } from '../../packages/core/src/types/brew.js';

const at = new Date('2026-11-26T08:00:00Z');
const clock = { now: () => new Date(at), monotonic: () => 0 };
const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
async function setup() {
  const database = openDatabase(':memory:');
  const app = await createApp({ database, clock });
  closes.push(() => app.close());
  const service = new BrewService(database, clock);
  const ingress = new NewsletterService(database, clock);
  const state = new ArticleService(database);
  const one = await ingress.ingestMessage({
    from: { address: 'one@journal.test' },
    messageId: 'one',
    subject: 'One letter',
    date: at.toISOString(),
    html: '<p>A clean forest story</p><div class="sponsor">Sponsor</div><img width="1" src="https://metrics.test/pixel">',
  });
  const two = await ingress.ingestMessage({
    from: { address: 'two@journal.test' },
    messageId: 'two',
    subject: 'Two letter',
    date: new Date(at.getTime() - 60_000).toISOString(),
    html: '<p>A second story about tools</p>',
  });
  const rss = database.db
    .insert(feeds)
    .values({ title: 'RSS', url: 'https://journal.test/rss' })
    .returning()
    .get();
  const story = database.db
    .insert(articles)
    .values({
      feedId: rss.id,
      guid: 'rss',
      hash: 'rss',
      title: 'RSS story',
      url: 'https://journal.test/story',
      publishedAt: at,
    })
    .returning()
    .get();
  const tag = state.createTag('Design');
  state.setTags(two.articleId!, [tag.id]);
  state.setTags(story.id, [tag.id]);
  const draft = (sources: BrewSourceRef[]) => ({
    name: 'Morning',
    enabled: true,
    timezone: 'UTC',
    schedule: { kind: 'daily' as const, time: '08:00' },
    delivery: defaultDelivery(),
    sections: [
      {
        ...sectionWithSources(newBrewSection('letters'), sources),
        title: 'Letters',
        onlyUnread: false,
      },
    ],
  });
  const ids = async (sources: BrewSourceRef[]) =>
    (
      await service.previewComposition(draft(sources), 0, at.toISOString())
    ).snapshot.sections[0]!.items.map((item) => item.id);
  return { database, app, service, ingress, state, one, two, rss, story, tag, draft, ids };
}

describe('Newsletter Brew sources', () => {
  it('selects retained newsletters across senders, including skipped/blocked history, and automatically follows new senders', async () => {
    const { database, service, ingress, one, two, draft, ids } = await setup();
    const library = new NewsletterLibrary(database, clock);
    library.updateSender(one.feedId, { skipInbox: true });
    library.updateSender(two.feedId, { blocked: true });
    expect(await ids([{ kind: 'newsletters' }])).toEqual([one.articleId, two.articleId]);
    const config = service.createComposition(draft([{ kind: 'newsletters' }]));
    const issue = await service.generateComposition(config.id);
    const frozen = JSON.stringify(service.snapshot(issue.id));
    const third = await ingress.ingestMessage({
      from: { address: 'three@journal.test' },
      messageId: 'three',
      subject: 'New sender',
      date: at.toISOString(),
      text: 'New letter',
    });
    expect(await ids([{ kind: 'newsletters' }])).toEqual([
      third.articleId,
      one.articleId,
      two.articleId,
    ]);
    expect(JSON.stringify(service.snapshot(issue.id))).toBe(frozen);
  });
  it('matches chosen senders OR tags, excludes RSS carrying the same tag, and never broadens missing IDs', async () => {
    const { ids, one, two, rss, tag } = await setup();
    expect(await ids([{ kind: 'newsletters', senderIds: [one.feedId] }])).toEqual([one.articleId]);
    expect(await ids([{ kind: 'newsletters', tagIds: [tag.id] }])).toEqual([two.articleId]);
    expect(await ids([{ kind: 'newsletters', senderIds: [one.feedId], tagIds: [tag.id] }])).toEqual(
      [one.articleId, two.articleId],
    );
    expect(await ids([{ kind: 'newsletters', senderIds: [two.feedId], tagIds: [tag.id] }])).toEqual(
      [two.articleId],
    );
    expect(await ids([{ kind: 'newsletters', senderIds: [9999, rss.id], tagIds: [9999] }])).toEqual(
      [],
    );
    expect(await ids([{ kind: 'newsletters' }, { kind: 'feed', id: one.feedId }])).toEqual([
      one.articleId,
      two.articleId,
    ]);
  });
  it('preserves section filtering, unread state, order, dates and cleaned bodies in previews and scheduled frozen issues', async () => {
    const { database, service, state, one, two, draft } = await setup();
    const value = draft([{ kind: 'newsletters' }]);
    value.sections[0]!.depth = 'full';
    value.sections[0]!.sort = 'oldest';
    value.sections[0]!.maxItems = 1;
    const preview = await service.previewComposition(value, 0, at.toISOString());
    expect(preview.snapshot.sections[0]!.items[0]?.id).toBe(two.articleId);
    expect(preview.warnings).toEqual([]);
    expect(preview.snapshot.sections[0]!.items[0]?.newsletter?.cleaning).toEqual({
      trackers: 0,
      sponsorBlocks: 0,
      footerTrimmed: false,
    });
    expect(preview.snapshot.sections[0]!.items[0]?.summaryHtml).toContain('second story');
    state.updateState(two.articleId!, { read: true });
    value.sections[0]!.onlyUnread = true;
    const cleaned = await service.previewComposition(value, 0, at.toISOString());
    expect(cleaned.snapshot.sections[0]!.items[0]).toMatchObject({
      id: one.articleId,
      contentHtml: '<p>A clean forest story</p>',
    });
    database.sqlite
      .prepare('UPDATE articles SET published_at=? WHERE id=?')
      .run(at.getTime() + 1, one.articleId);
    expect(
      (await service.previewComposition(value, 0, at.toISOString())).snapshot.sections[0]!.items,
    ).toEqual([]);
    database.sqlite
      .prepare('UPDATE articles SET published_at=? WHERE id=?')
      .run(at.getTime(), one.articleId);
    value.sections[0]!.filter = {
      match: 'all',
      conditions: [{ field: 'content', operator: 'contains', value: 'forest' }],
    };
    const config = service.createComposition(value);
    expect(await service.runCompositionScheduled(at)).toBe(1);
    expect(service.history(config.id)[0]?.sections[0]?.items.map((item) => item.id)).toEqual([
      one.articleId,
    ]);
    expect(await service.runCompositionScheduled(at)).toBe(0);
  });
  it('rejects malformed or ambiguous selectors through the real API without saving a configuration', async () => {
    const { app, service, draft } = await setup();
    const invalid = [
      { kind: 'newsletters', senderIds: [] },
      { kind: 'newsletters', tagIds: [0] },
      { kind: 'newsletters', senderIds: [1, 1] },
      { kind: 'newsletters', senderIds: ['1'] },
      { kind: 'newsletters', senderIds: [1.5] },
      { kind: 'newsletters', tagIds: null },
      { kind: 'newsletters', id: 1 },
      { kind: 'newsletters', senderId: 1 },
      { kind: 'newsletters', tagId: 1 },
      { kind: 'feed', id: 1, tagIds: [1] },
      { kind: 'newsletters', senderIds: Array.from({ length: 501 }, (_, index) => index + 1) },
    ];
    for (const source of invalid)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/brew-configs/composition',
            payload: draft([source as BrewSourceRef]),
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/brew-configs/composition',
          payload: draft([{ kind: 'newsletters' }, { kind: 'newsletters', tagIds: [1] }]),
        })
      ).statusCode,
    ).toBe(400);
    expect(service.listConfigs()).toEqual([]);
  });
  it('persists selectors losslessly across composition API reads/updates and initializes Grid without resetting later choices', async () => {
    const { app, service, draft, one, tag } = await setup();
    const source: BrewSourceRef = {
      kind: 'newsletters',
      senderIds: [one.feedId],
      tagIds: [tag.id],
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/brew-configs/composition',
      payload: draft([source]),
    });
    expect(created.statusCode).toBe(201);
    const value = created.json();
    expect(value.sections[0]).toMatchObject({ layout: 'grid', sources: [source] });
    const chosen = sectionWithSources({ ...value.sections[0], layout: 'magazine' }, [
      { kind: 'newsletters' },
    ]);
    expect(chosen.layout).toBe('magazine');
    expect(
      sectionWithSources({ ...newBrewSection('custom'), layout: 'lead' }, [source]).layout,
    ).toBe('lead');
    expect(sectionWithSources(newBrewSection('mixed'), [source, { kind: 'today' }]).layout).toBe(
      'magazine',
    );
    const next = { ...value, sections: [chosen] };
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/brew-configs/${value.id}/composition`,
          payload: next,
        })
      ).statusCode,
    ).toBe(200);
    expect(service.composition(value.id)?.sections[0]).toMatchObject({
      layout: 'magazine',
      sources: [{ kind: 'newsletters' }],
    });
    const preview = await app.inject({
      method: 'POST',
      url: `/api/brew-configs/${value.id}/preview`,
      payload: { at: at.toISOString() },
    });
    expect(preview.json().snapshot.sections[0].items).toHaveLength(2);
  });
});
