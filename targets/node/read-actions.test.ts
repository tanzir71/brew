import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { openDatabase } from './src/db/database';
import { schema } from './src/db/schema';
import { ActionsService } from '../../packages/core/src/actions';
import { NodeActionStorage } from './src/ports/action-storage';
import { createApp } from './src/app';
import type { ReadActionTarget } from '../../packages/core/src/read-actions';

const closes: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
function setup() {
  const database = openDatabase(':memory:');
  closes.push(database.close);
  let now = Date.parse('2026-11-26T01:00:00Z');
  const clock = { now: () => new Date(now) };
  const sql = database.sqlite;
  sql.exec(`INSERT INTO folders(id,title) VALUES(1,'Design');
    INSERT INTO feeds(id,title,url,folder_id,kind,muted,settings_json) VALUES
      (1,'Journal','https://rss.test/feed',1,'rss',0,'{}'),
      (2,'Muted','https://muted.test/feed',1,'rss',1,'{}'),
      (3,'Only in Brew','mailto:private@only.test',1,'newsletter',0,'{"onlyInBrew":true}'),
      (4,'Letters','mailto:private@letters.test',NULL,'newsletter',0,'{}');`);
  const add = (
    id: number,
    feed = 1,
    read: number | null = null,
    star: number | null = null,
    hidden = 0,
    at = now,
  ) =>
    sql
      .prepare(
        'INSERT INTO articles(id,feed_id,guid,url,title,hash,published_at,read_at,starred_at,hidden,content_html,raw_html) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        feed,
        `item-${id}`,
        `https://story.test/${id}`,
        `Private title ${id}`,
        `hash-${id}`,
        at,
        read,
        star,
        hidden,
        '<p>Private content token</p>',
        'Private original',
      );
  add(1);
  add(2, 1, null, null, 0, now - 3 * 86_400_000);
  add(3, 1, now - 1000);
  add(4, 1, null, null, 1);
  add(5, 1, null, now);
  add(6, 2);
  add(7, 3, null, now);
  add(8, 4);
  sql.transaction(() => {
    for (let id = 10; id < 511; id++) add(id);
  })();
  const storage = new NodeActionStorage(database, clock, async () => {
    throw new Error('Read actions must not fetch.');
  });
  const actions = new ActionsService(storage);
  const rows = () => sql.prepare('SELECT * FROM articles ORDER BY id').all();
  return {
    database,
    sql,
    clock,
    storage,
    actions,
    add,
    rows,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe('confirmed bulk read actions', () => {
  it('previews exact scopes beyond one page, preserves Reader visibility and never writes', () => {
    const f = setup();
    const before = f.sql.prepare('SELECT total_changes() AS n').get();
    expect(f.actions.previewRead({ kind: 'reader', view: 'all' })).toMatchObject({
      updated: 505,
      unavailable: 0,
    });
    expect(f.actions.previewRead({ kind: 'reader', view: 'today' }).updated).toBe(504);
    expect(f.actions.previewRead({ kind: 'reader', view: 'starred' }).updated).toBe(2);
    expect(f.actions.previewRead({ kind: 'reader', view: 'all', folderId: 1 }).updated).toBe(504);
    expect(f.actions.previewRead({ kind: 'reader', view: 'all', feedId: 3 }).updated).toBe(1);
    expect(
      f.actions.previewRead({ kind: 'items', ids: Array.from({ length: 501 }, (_, i) => i + 10) })
        .updated,
    ).toBe(501);
    const preview = f.actions.previewRead({ kind: 'items', ids: [7, 4, 3, 1, 999999, 1] });
    expect(preview).toMatchObject({ updated: 3, unavailable: 1 });
    expect(preview.revision).toMatch(/^[a-f\d]{64}$/);
    expect(JSON.stringify(preview)).not.toMatch(/Private|mailto|content|story.test/);
    expect(f.sql.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  });
  it('marks only reviewed unread rows atomically and restores actual timestamps after reopening SQLite', async () => {
    const f = setup();
    const target: ReadActionTarget = { kind: 'items', ids: [1, 3, 4, 7, 999999] };
    const before = f.rows();
    const preview = f.actions.previewRead(target);
    const request = {
      kind: 'mark_read',
      target,
      revision: preview.revision,
      requestId: 'bulk-request-replay',
      confirm: true,
    } as const;
    const pending = f.actions.run(request);
    expect(
      f.actions.run({ ...request, target: { kind: 'items', ids: [7, 4, 3, 1, 999999, 1] } }),
    ).toBe(pending);
    const result = await pending;
    expect(result).toMatchObject({
      updated: 3,
      summary: 'Marked 3 read.',
      canUndo: true,
      status: 'complete',
      externalEffects: false,
    });
    expect(
      (f.sql.prepare('SELECT read_at AS read FROM articles WHERE id=3').get() as { read: number })
        .read,
    ).toBe(f.clock.now().getTime() - 1000);
    f.sql.prepare('UPDATE articles SET starred_at=? WHERE id=1').run(f.clock.now().getTime() + 1);
    const copy = new Database(f.sql.serialize());
    closes.push(() => copy.close());
    const reopened = new ActionsService(
      new NodeActionStorage(
        { sqlite: copy, db: drizzle(copy, { schema }), close: () => copy.close() },
        f.clock,
      ),
    );
    expect(reopened.recent()[0]!.id).toBe(result.id);
    expect(reopened.undo(result.id).status).toBe('undone');
    const expected = structuredClone(before) as Array<{ id: number; starred_at: number | null }>;
    expected.find((row) => row.id === 1)!.starred_at = f.clock.now().getTime() + 1;
    expect(copy.prepare('SELECT * FROM articles ORDER BY id').all()).toEqual(expected);
    expect((await reopened.run(request)).status).toBe('undone');
    const args = JSON.parse(
      (copy.prepare('SELECT args_json AS args FROM agent_actions').get() as { args: string }).args,
    );
    expect(Object.keys(args).sort()).toEqual(['revision', 'sha256']);
  });
  it.each(['new unread', 'read state', 'visibility'])(
    'rejects a stale Reader review after changed %s without an action write',
    async (change) => {
      const f = setup();
      const target = { kind: 'reader', view: 'all' } as const;
      const preview = f.actions.previewRead(target);
      if (change === 'new unread') f.add(900);
      if (change === 'read state')
        f.sql.prepare('UPDATE articles SET read_at=? WHERE id=1').run(f.clock.now().getTime());
      if (change === 'visibility') f.sql.prepare('UPDATE feeds SET muted=1 WHERE id=1').run();
      const before = f.rows();
      await expect(
        f.actions.run({ kind: 'mark_read', target, revision: preview.revision, confirm: true }),
      ).rejects.toThrow('review the scope again');
      expect(f.rows()).toEqual(before);
      expect(f.sql.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({ n: 0 });
    },
  );
  it('rolls back the entire batch and audit on a failed row, and refuses conflicting Undo atomically', async () => {
    const f = setup();
    const target = { kind: 'items', ids: [1, 2, 5] } as const;
    const request = {
      kind: 'mark_read',
      target,
      revision: f.actions.previewRead(target).revision,
      confirm: true,
    } as const;
    const before = f.rows();
    f.sql.exec(
      "CREATE TRIGGER fail_read BEFORE UPDATE OF read_at ON articles WHEN NEW.id=2 BEGIN SELECT RAISE(ABORT,'injected write failure'); END",
    );
    await expect(f.actions.run(request)).rejects.toThrow('injected write failure');
    expect(f.rows()).toEqual(before);
    expect(f.sql.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({ n: 0 });
    f.sql.exec('DROP TRIGGER fail_read');
    const result = await f.actions.run(request);
    f.sql.prepare('UPDATE articles SET read_at=? WHERE id=2').run(f.clock.now().getTime() + 5000);
    const changed = f.rows();
    expect(() => f.actions.undo(result.id)).toThrow('changed after the action');
    expect(f.rows()).toEqual(changed);
  });
  it('reports no-op truthfully, expires recovery and keeps legacy HTTP mark-all contracts', async () => {
    const f = setup();
    const target = { kind: 'items', ids: [3] } as const;
    const result = await f.actions.run({
      kind: 'mark_read',
      target,
      revision: f.actions.previewRead(target).revision,
      confirm: true,
    });
    expect(result).toMatchObject({ updated: 0, canUndo: false, expiresAt: null });
    const all = { kind: 'reader', view: 'all' } as const;
    const applied = await f.actions.run({
      kind: 'mark_read',
      target: all,
      revision: f.actions.previewRead(all).revision,
      confirm: true,
    });
    expect(applied.updated).toBe(505);
    f.advance(30_001);
    f.actions.cleanup();
    expect(() => f.actions.undo(applied.id)).toThrow('expired');
    expect(f.sql.prepare('SELECT count(*) AS n FROM agent_action_changes').get()).toEqual({ n: 0 });
    const app = await createApp({
      database: f.database,
      clock: { ...f.clock, monotonic: () => 0 },
    });
    closes.push(() => app.close());
    const legacy = await app.inject({
      method: 'POST',
      url: '/api/articles/mark-all-read',
      payload: { view: 'all' },
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json()).toMatchObject({
      updated: 0,
      undoToken: expect.any(String),
      expiresAt: expect.any(String),
    });
  });
  it('validates private HTTP previews, requires confirmation and rejects malformed scopes without writes', async () => {
    const f = setup();
    const app = await createApp({ database: f.database });
    closes.push(() => app.close());
    const before = f.sql.prepare('SELECT total_changes() AS n').get();
    const target = { kind: 'items', ids: [1, 3] };
    const preview = await app.inject({
      method: 'POST',
      url: '/api/actions/mark-read/preview',
      payload: target,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['cache-control']).toBe('private, no-store');
    expect(preview.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(f.sql.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    const denied = await app.inject({
      method: 'POST',
      url: '/api/actions',
      payload: { kind: 'mark_read', target, revision: preview.json().revision },
    });
    expect(denied.statusCode).toBe(428);
    for (const invalid of [
      null,
      { kind: 'items', ids: [] },
      { kind: 'items', ids: [-1] },
      { kind: 'items', ids: [1.5] },
      { kind: 'reader', view: 'today', feedId: '1' },
      { kind: 'reader', view: 'all', feedId: 1, folderId: 1 },
      { kind: 'reader', view: 'search' },
    ]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/actions/mark-read/preview',
            payload: invalid === null ? 'null' : invalid,
            headers: { 'content-type': 'application/json' },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/actions/mark-read/preview',
          payload: { kind: 'reader', view: 'all', feedId: 99999 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      f.rows().filter((row) => (row as { read_at: number | null }).read_at !== null),
    ).toHaveLength(1);
  });
});
