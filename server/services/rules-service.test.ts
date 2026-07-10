import { describe, expect, it, vi } from 'vitest';
import type { RuleAction, RuleCondition } from '../../shared/rules.js';
import { openDatabase, type BrewDatabase } from '../db/database.js';
import { articleTags, articles, feeds, folders, ruleLogs, rules, tags } from '../db/schema.js';
import type { ParsedArticle } from './feed-parser.js';
import { IngestPipeline } from './ingest-pipeline.js';
import { RulesService } from './rules-service.js';
import { safeRegexTest } from './safe-regex.js';

function fixture() {
  const database = openDatabase(':memory:');
  const folder = database.db.insert(folders).values({ title: 'Work' }).returning().get();
  const feed = database.db.insert(feeds).values({ title: 'Design Weekly', url: 'https://feed.test/rss', folderId: folder.id }).returning().get();
  const article = database.db.insert(articles).values({ feedId: feed.id, guid: 'rule-article', url: 'https://example.test/guide', title: 'A calm design reader', author: 'Ada', contentHtml: '<p>Semantic systems for thoughtful tools.</p>', publishedAt: new Date(), hash: 'rule-hash' }).returning().get();
  return { database, folder, feed, article };
}

function addRule(database: BrewDatabase, conditions: RuleCondition[], actions: RuleAction[] = [{ type: 'star' }], values: Partial<typeof rules.$inferInsert> = {}) {
  return database.db.insert(rules).values({ name: 'Fixture rule', enabled: true, position: 0, matchType: 'all', scopeJson: '{}', conditionsJson: JSON.stringify(conditions), actionsJson: JSON.stringify(actions), ...values }).returning().get();
}

describe('RulesService conditions', () => {
  it.each<[string, RuleCondition]>([
    ['contains', { field: 'title', operator: 'contains', value: 'DESIGN' }],
    ['not_contains', { field: 'title', operator: 'not_contains', value: 'finance' }],
    ['equals', { field: 'title', operator: 'equals', value: 'a calm design reader' }],
    ['starts_with', { field: 'title', operator: 'starts_with', value: 'A calm' }],
    ['ends_with', { field: 'title', operator: 'ends_with', value: 'reader' }],
    ['matches_regex', { field: 'title', operator: 'matches_regex', value: '^a calm.+reader$' }],
  ])('matches the %s operator', async (_operator, condition) => {
    const { database, article } = fixture(); addRule(database, [condition]);
    expect(await new RulesService(database).evaluateArticle(article.id)).toBe(1);
    expect(database.db.select().from(articles).get()?.starredAt).not.toBeNull(); database.close();
  });

  it.each<[RuleCondition['field'], string]>([['title', 'calm'], ['content', 'semantic'], ['author', 'ada'], ['url', 'example.test'], ['feed', 'design weekly'], ['folder', 'work']])('reads the %s field', async (field, value) => {
    const { database, article } = fixture(); addRule(database, [{ field, operator: 'contains', value }]);
    expect(await new RulesService(database).evaluateArticle(article.id)).toBe(1); database.close();
  });

  it('honors all/any combinators and feed/folder scope', async () => {
    const { database, article, feed, folder } = fixture();
    addRule(database, [{ field: 'title', operator: 'contains', value: 'calm' }, { field: 'title', operator: 'contains', value: 'missing' }], [{ type: 'star' }], { name: 'All misses', matchType: 'all', scopeJson: JSON.stringify({ feedIds: [feed.id] }), position: 0 });
    addRule(database, [{ field: 'title', operator: 'contains', value: 'calm' }, { field: 'title', operator: 'contains', value: 'missing' }], [{ type: 'mark_read' }], { name: 'Any hits', matchType: 'any', scopeJson: JSON.stringify({ folderIds: [folder.id] }), position: 1 });
    addRule(database, [], [{ type: 'hide' }], { name: 'Wrong scope', scopeJson: JSON.stringify({ feedIds: [999] }), position: 2 });
    expect(await new RulesService(database).evaluateArticle(article.id)).toBe(1);
    expect(database.db.select().from(articles).get()).toMatchObject({ starredAt: null, hidden: false }); expect(database.db.select().from(articles).get()?.readAt).not.toBeNull(); database.close();
  });

  it('times out catastrophic regex execution without blocking the process', async () => {
    const started = performance.now(); const result = await safeRegexTest('(a+)+$', `${'a'.repeat(100_000)}!`, 50);
    expect(result).toMatchObject({ matched: false, timedOut: true }); expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('RulesService actions', () => {
  const cases: Array<[RuleAction['type'], RuleAction]> = [
    ['add_tag', { type: 'add_tag', tag: 'Tools' }], ['remove_tag', { type: 'remove_tag', tag: 'Old' }], ['star', { type: 'star' }], ['mark_read', { type: 'mark_read' }], ['hide', { type: 'hide' }], ['highlight', { type: 'highlight', color: '#f59e0b' }], ['feature_in_brew', { type: 'feature_in_brew' }], ['exclude_from_brew', { type: 'exclude_from_brew' }], ['notify', { type: 'notify' }], ['webhook', { type: 'webhook', url: 'https://hooks.test/rule' }],
  ];
  it.each(cases)('executes and logs %s', async (type, action) => {
    const { database, article } = fixture();
    if (type === 'remove_tag') { const tag = database.db.insert(tags).values({ name: 'Old', color: '#000' }).returning().get(); database.db.insert(articleTags).values({ articleId: article.id, tagId: tag.id }).run(); }
    addRule(database, [], [action]);
    const notify = vi.fn(); const fetcher = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    expect(await new RulesService(database, fetcher, notify).evaluateArticle(article.id)).toBe(1);
    const updated = database.db.select().from(articles).get()!;
    if (type === 'add_tag') expect(database.db.select().from(articleTags).all()).toHaveLength(1);
    if (type === 'remove_tag') expect(database.db.select().from(articleTags).all()).toHaveLength(0);
    if (type === 'star') expect(updated.starredAt).not.toBeNull();
    if (type === 'mark_read') expect(updated.readAt).not.toBeNull();
    if (type === 'hide') expect(updated.hidden).toBe(true);
    if (type === 'highlight') expect(updated.highlightColor).toBe('#f59e0b');
    if (type === 'feature_in_brew') expect(updated.featuredInBrew).toBe(true);
    if (type === 'exclude_from_brew') expect(updated.excludedFromBrew).toBe(true);
    if (type === 'notify') expect(notify).toHaveBeenCalledWith(expect.objectContaining({ id: article.id }));
    if (type === 'webhook') expect(fetcher).toHaveBeenCalledWith('https://hooks.test/rule', expect.objectContaining({ method: 'POST' }));
    const log = database.db.select().from(ruleLogs).get()!; expect(JSON.parse(log.actionsTakenJson)).toEqual([expect.objectContaining({ type, ok: true })]); database.close();
  });

  it('stops lower-priority rules and runs inside ingest before returning', async () => {
    const { database, feed } = fixture(); database.db.delete(articles).run();
    addRule(database, [], [{ type: 'mark_read' }], { name: 'Stop', position: 0, stopProcessing: true });
    addRule(database, [], [{ type: 'hide' }], { name: 'Skipped', position: 1 });
    const service = new RulesService(database); const pipeline = new IngestPipeline(database, service);
    const incoming: ParsedArticle = { guid: 'new', url: 'https://example.test/new', title: 'New article', author: null, summaryHtml: null, contentHtml: '<p>New</p>', publishedAt: new Date() };
    expect(await pipeline.ingest(feed, [incoming])).toBe(1);
    const inserted = database.db.select().from(articles).get()!; expect(inserted.readAt).not.toBeNull(); expect(inserted.hidden).toBe(false); expect(database.db.select().from(ruleLogs).all()).toHaveLength(1); database.close();
  });

  it('retries a failed webhook once and records the final failure', async () => {
    const { database, article } = fixture();
    addRule(database, [], [{ type: 'webhook', url: 'https://hooks.test/failing' }]);
    const fetcher = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    await new RulesService(database, fetcher).evaluateArticle(article.id);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const log = database.db.select().from(ruleLogs).get()!;
    expect(JSON.parse(log.actionsTakenJson)).toEqual([
      { type: 'webhook', ok: false, error: 'HTTP 500' },
    ]);
    database.close();
  });

  it('reports hit counts and reapplies one rule to existing articles with logs', async () => {
    const { database, article } = fixture();
    const rule = addRule(database, [{ field: 'title', operator: 'contains', value: 'calm' }], [{ type: 'star' }]);
    const service = new RulesService(database);
    expect(await service.applyToExisting(rule.id, 30)).toBe(1);
    expect(service.list()[0]).toMatchObject({ hits24h: 1, hits30d: 1 });
    expect(service.logs(rule.id)).toEqual([
      expect.objectContaining({ articleId: article.id, articleTitle: 'A calm design reader', actions: [{ type: 'star', ok: true }] }),
    ]);
    database.close();
  });
});
