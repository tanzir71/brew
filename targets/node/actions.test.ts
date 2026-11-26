import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { openDatabase } from './src/db/database.js';
import {
  articles,
  articleTags,
  feeds,
  folders,
  rules,
  ruleLogs,
  tags,
  schema,
} from './src/db/schema.js';
import { ActionsService } from '../../packages/core/src/actions.js';
import { NodeActionStorage } from './src/ports/action-storage.js';
import { createApp } from './src/app.js';

const closes: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
function setup() {
  const database = openDatabase(':memory:');
  closes.push(database.close);
  let at = Date.parse('2026-11-26T01:00:00Z');
  const clock = { now: () => new Date(at) };
  const folder = database.db.insert(folders).values({ title: 'Design' }).returning().get();
  const feed = database.db
    .insert(feeds)
    .values({ title: 'Notes', url: 'https://journal.test/feed', folderId: folder.id })
    .returning()
    .get();
  const article = database.db
    .insert(articles)
    .values({
      feedId: feed.id,
      title: 'Quiet design',
      guid: 'quiet',
      hash: 'quiet',
      url: 'https://journal.test/quiet',
      publishedAt: clock.now(),
      rawHtml: 'private-original-token',
      contentHtml: '<p>Clean article.</p>',
    })
    .returning()
    .get();
  const tag = database.db
    .insert(tags)
    .values({ name: 'Existing', color: '#a0471d' })
    .returning()
    .get();
  database.db.insert(articleTags).values({ articleId: article.id, tagId: tag.id }).run();
  const rule = database.db
    .insert(rules)
    .values({
      name: 'Mark quiet',
      matchType: 'all',
      scopeJson: '{}',
      conditionsJson: '[]',
      actionsJson: JSON.stringify([
        { type: 'star' },
        { type: 'mark_read' },
        { type: 'highlight', color: '#a0471d' },
        { type: 'add_tag', tag: 'New label' },
      ]),
    })
    .returning()
    .get();
  database.db
    .insert(ruleLogs)
    .values({ ruleId: rule.id, articleId: article.id, actionsTakenJson: '[]' })
    .run();
  const service = new ActionsService(new NodeActionStorage(database, clock));
  const snapshot = () =>
    Object.fromEntries(
      ['folders', 'feeds', 'articles', 'article_tags', 'rules', 'rule_logs'].map((table) => [
        table,
        database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    );
  return {
    database,
    clock,
    folder,
    feed,
    article,
    rule,
    service,
    snapshot,
    advance: (ms: number) => {
      at += ms;
    },
  };
}
describe('confirmed owner actions and durable undo', () => {
  it('rejects missing confirmation and invalid inputs without writes', async () => {
    const f = setup();
    const before = f.snapshot();
    for (const value of [
      { kind: 'delete_feed', id: f.feed.id },
      { kind: 'delete_feed', id: 0, confirm: true },
      { kind: 'drop_table', id: 1, confirm: true },
      { kind: 'apply_rule', id: 1, days: 0, confirm: true },
    ])
      expect(() => f.service.run(value)).toThrow();
    expect(f.snapshot()).toEqual(before);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
  });
  it.each(['delete_feed', 'delete_folder', 'delete_rule'] as const)(
    'restores exact IDs, cascades, settings, tags and logs after %s, including through a new service',
    async (kind) => {
      const f = setup();
      const before = f.snapshot();
      const target =
        kind === 'delete_feed' ? f.feed.id : kind === 'delete_folder' ? f.folder.id : f.rule.id;
      const action = await f.service.run({ kind, id: target, confirm: true });
      expect(action.canUndo).toBe(true);
      const reopened = new ActionsService(new NodeActionStorage(f.database, f.clock));
      expect(reopened.undo(action.id).status).toBe('undone');
      expect(f.snapshot()).toEqual(before);
      expect(
        f.database.sqlite
          .prepare("SELECT rowid AS id FROM articles_fts WHERE articles_fts MATCH 'Quiet'")
          .all(),
      ).toHaveLength(1);
      expect(reopened.undo(action.id).status).toBe('undone');
      expect(
        f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_action_changes').get(),
      ).toEqual({ n: 0 });
      expect(JSON.stringify(reopened.recent())).not.toContain('private-original-token');
    },
  );
  it('reverses every local rule change while retaining reusable tag definitions', async () => {
    const f = setup();
    const before = f.snapshot();
    const action = await f.service.run({
      kind: 'apply_rule',
      id: f.rule.id,
      confirm: true,
      days: 30,
    });
    expect(action).toMatchObject({ matched: 1, status: 'complete', externalEffects: false });
    expect(f.database.db.select().from(articles).get()!.highlightColor).toBe('#a0471d');
    expect(f.database.db.select().from(articleTags).all()).toHaveLength(2);
    expect(f.service.undo(action.id).status).toBe('undone');
    expect(f.snapshot()).toEqual(before);
    expect(
      f.database.db
        .select()
        .from(tags)
        .all()
        .map((tag) => tag.name),
    ).toContain('New label');
  });
  it('preserves unrelated later edits and atomically rejects overlapping changes', async () => {
    const f = setup();
    const folderAction = await f.service.run({
      kind: 'delete_folder',
      id: f.folder.id,
      confirm: true,
    });
    f.database.db
      .update(feeds)
      .set({ title: 'Renamed later', lastStatus: 304 })
      .where(eq(feeds.id, f.feed.id))
      .run();
    f.service.undo(folderAction.id);
    expect(f.database.db.select().from(feeds).get()).toMatchObject({
      title: 'Renamed later',
      lastStatus: 304,
      folderId: f.folder.id,
    });
    const action = await f.service.run({ kind: 'apply_rule', id: f.rule.id, confirm: true });
    f.database.db
      .update(articles)
      .set({ highlightColor: '#123456' })
      .where(eq(articles.id, f.article.id))
      .run();
    const beforeUndo = f.snapshot();
    expect(() => f.service.undo(action.id)).toThrow('changed after');
    expect(f.snapshot()).toEqual(beforeUndo);
  });
  it('prunes expired private undo bodies and refuses expired restoration', async () => {
    const f = setup();
    const action = await f.service.run({ kind: 'delete_feed', id: f.feed.id, confirm: true });
    expect(
      JSON.stringify(
        f.database.sqlite.prepare('SELECT before_json FROM agent_action_changes').all(),
      ),
    ).toContain('private-original-token');
    f.advance(30_001);
    f.service.cleanup();
    expect(
      f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_action_changes').get(),
    ).toEqual({ n: 0 });
    expect(() => f.service.undo(action.id)).toThrow('expired');
    expect(f.service.recent()[0]).toMatchObject({ canUndo: false, expiresAt: null });
  });
  it('replays completed request identities without repeating writes, even after Undo', async () => {
    const f = setup();
    const request = {
      kind: 'delete_feed',
      id: f.feed.id,
      confirm: true,
      requestId: 'repeat-request-0001',
    } as const;
    const action = await f.service.run(request);
    expect((await f.service.run(request)).id).toBe(action.id);
    f.service.undo(action.id);
    const replay = await new ActionsService(new NodeActionStorage(f.database, f.clock)).run(
      request,
    );
    expect(replay).toMatchObject({ id: action.id, status: 'undone' });
    expect(f.database.db.select().from(feeds).get()!.id).toBe(f.feed.id);
    await expect(f.service.run({ ...request, kind: 'delete_rule' })).rejects.toThrow(
      'another action',
    );
    expect(f.service.recent()).toHaveLength(1);
  });
  it('restores durable journal rows on a new SQLite connection without temporary state', async () => {
    const f = setup();
    const before = f.snapshot();
    const action = await f.service.run({ kind: 'delete_feed', id: f.feed.id, confirm: true });
    const sqlite = new Database(f.database.sqlite.serialize());
    sqlite.pragma('foreign_keys=ON');
    closes.push(() => sqlite.close());
    expect(sqlite.prepare('SELECT name FROM sqlite_temp_master').all()).toEqual([]);
    const reopened = new ActionsService(
      new NodeActionStorage(
        { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() },
        f.clock,
      ),
    );
    expect(reopened.recent()[0]).toMatchObject({ id: action.id, canUndo: true });
    reopened.undo(action.id);
    for (const [table, rows] of Object.entries(before))
      expect(sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(rows);
  });
  it('isolates async rule writes, coalesces retries and protects active undo from expiry', async () => {
    const f = setup();
    f.database.db
      .update(rules)
      .set({
        actionsJson: JSON.stringify([
          { type: 'add_tag', tag: 'While waiting' },
          { type: 'webhook', url: 'https://hook.test/' },
          { type: 'star' },
        ]),
      })
      .where(eq(rules.id, f.rule.id))
      .run();
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    const service = new ActionsService(
      new NodeActionStorage(f.database, f.clock, async () => {
        calls++;
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new Response(null, { status: 204 });
      }),
    );
    const request = {
      kind: 'apply_rule',
      id: f.rule.id,
      confirm: true,
      requestId: 'inflight-request-001',
    } as const;
    const task = service.run(request);
    await waiting;
    const retry = service.run(request);
    expect(retry).toBe(task);
    expect(() => service.run({ ...request, days: 15 })).toThrow('another action');
    const pending = service.recent()[0];
    expect(pending).toMatchObject({ status: 'pending', canUndo: false });
    expect(() => service.undo(pending.id)).toThrow('Wait');
    f.advance(31_000);
    service.cleanup();
    expect(
      f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_action_changes').get(),
    ).toEqual({ n: 1 });
    f.database.db
      .update(articles)
      .set({ title: 'Edited while waiting' })
      .where(eq(articles.id, f.article.id))
      .run();
    const folderAction = await service.run({
      kind: 'delete_folder',
      id: f.folder.id,
      confirm: true,
    });
    release();
    const action = await task;
    expect(await retry).toEqual(action);
    expect(action).toMatchObject({ status: 'complete', canUndo: true, externalEffects: true });
    service.undo(action.id);
    expect(f.database.db.select().from(articles).get()).toMatchObject({
      title: 'Edited while waiting',
      starredAt: null,
    });
    expect(f.database.db.select().from(folders).all()).toHaveLength(0);
    service.undo(folderAction.id);
    expect(f.database.db.select().from(feeds).get()!.folderId).toBe(f.folder.id);
    expect(calls).toBe(1);
  });
  it('reports partial rule failures and undoes local changes without resending webhooks', async () => {
    const f = setup();
    const before = f.snapshot();
    f.database.db
      .update(rules)
      .set({
        actionsJson: JSON.stringify([
          { type: 'star' },
          { type: 'webhook', url: 'https://hook.test/' },
        ]),
      })
      .where(eq(rules.id, f.rule.id))
      .run();
    let calls = 0;
    const service = new ActionsService(
      new NodeActionStorage(f.database, f.clock, async () => {
        calls++;
        return new Response(null, { status: 503 });
      }),
    );
    const action = await service.run({ kind: 'apply_rule', id: f.rule.id, confirm: true });
    expect(action).toMatchObject({
      status: 'failed',
      matched: 1,
      failedActions: 1,
      externalEffects: true,
      canUndo: true,
    });
    expect(action.summary).toContain('1 action failed');
    service.undo(action.id);
    expect(f.snapshot().articles).toEqual(before.articles);
    expect(f.snapshot().rule_logs).toEqual(before.rule_logs);
    expect(calls).toBe(2);
  });
  it('rolls back the entire undo when a later subscription owns the deleted feed URL', async () => {
    const f = setup();
    const action = await f.service.run({ kind: 'delete_feed', id: f.feed.id, confirm: true });
    f.database.db.insert(feeds).values({ title: 'Later subscription', url: f.feed.url }).run();
    const before = f.snapshot();
    expect(() => f.service.undo(action.id)).toThrow('changed after');
    expect(f.snapshot()).toEqual(before);
    expect(f.service.recent()[0].status).toBe('complete');
  });
  it('keeps legacy routes compatible while new HTTP actions require confirmation and never expose undo payloads', async () => {
    const f = setup();
    closes.pop();
    const app = await createApp({ database: f.database, clock: f.clock });
    closes.push(() => app.close());
    const missing = await app.inject({
      method: 'POST',
      url: '/api/actions',
      payload: { kind: 'delete_feed', id: f.feed.id },
    });
    expect(missing.statusCode).toBe(428);
    const response = await app.inject({
      method: 'POST',
      url: '/api/actions',
      payload: { kind: 'delete_feed', id: f.feed.id, confirm: true },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect((await app.inject('/api/actions')).body).not.toMatch(
      /private-original-token|before_json|undo_json/,
    );
    const undo = await app.inject({
      method: 'POST',
      url: `/api/actions/${response.json().id}/undo`,
      payload: {},
    });
    expect(undo.json().status).toBe('undone');
    expect(f.database.db.select().from(articles).all()).toHaveLength(1);
  });
});
