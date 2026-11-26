import { afterEach, describe, expect, it } from 'vitest';
import { ruleCopySource } from '../../packages/core/src/rule-copy.js';
import { NodeRuleStorage } from './src/ports/rule-storage.js';
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
import { OpmlService } from './src/services/opml-service.js';
import { opmlDocumentLimit } from '../../packages/core/src/opml.js';

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
  const copyRequest = (f: ReturnType<typeof setup>) =>
    ({
      kind: 'copy_rule',
      id: f.rule.id,
      confirm: true,
      requestId: 'copy-saved-rule-001',
      definition: ruleCopySource(new NodeRuleStorage(f.database).definitions()[0]!),
    }) as const;
  it('copies exactly the saved definition as disabled, journals only the new row and replays before source lookup', async () => {
    const f = setup();
    f.database.db
      .update(rules)
      .set({
        scopeJson: JSON.stringify({ feedIds: [f.feed.id] }),
        actionsJson: JSON.stringify([
          { type: 'webhook', url: 'https://private.test/secret' },
          { type: 'notify' },
        ]),
      })
      .where(eq(rules.id, f.rule.id))
      .run();
    const before = f.snapshot();
    let calls = 0;
    const service = new ActionsService(
      new NodeActionStorage(
        f.database,
        f.clock,
        async () => {
          calls++;
          return new Response();
        },
        () => {
          calls++;
        },
      ),
    );
    const request = copyRequest(f);
    const [receipt, replay] = await Promise.all([service.run(request), service.run(request)]);
    expect(replay).toEqual(receipt);
    expect(receipt).toMatchObject({
      kind: 'copy_rule',
      status: 'complete',
      canUndo: true,
      externalEffects: false,
    });
    expect(receipt.targetId).not.toBe(f.rule.id);
    const definitions = new NodeRuleStorage(f.database).definitions();
    const copy = definitions.find((rule) => rule.id === receipt.targetId)!;
    expect(copy).toEqual({
      ...definitions[0],
      id: copy.id,
      name: `${f.rule.name} copy`,
      enabled: false,
      position: definitions[0]!.position + 1,
    });
    for (const [table, rows] of Object.entries(before))
      if (table !== 'rules') expect(f.snapshot()[table]).toEqual(rows);
    expect(calls).toBe(0);
    const audit = f.database.sqlite.prepare('SELECT args_json FROM agent_actions').get();
    expect(JSON.stringify(audit)).not.toContain('private.test');
    expect(f.database.sqlite.prepare('SELECT table_name FROM agent_action_changes').all()).toEqual([
      { table_name: 'rules' },
    ]);
    const sqlite = new Database(f.database.sqlite.serialize());
    sqlite.pragma('foreign_keys=ON');
    closes.push(() => sqlite.close());
    const reopened = new ActionsService(
      new NodeActionStorage(
        { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() },
        f.clock,
      ),
    );
    expect(await reopened.run(request)).toMatchObject({ id: receipt.id, canUndo: true });
    reopened.undo(receipt.id);
    for (const [table, rows] of Object.entries(before))
      expect(sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).toEqual(rows);
    service.undo(receipt.id);
    expect(f.snapshot()).toEqual(before);
    expect(await service.run(request)).toMatchObject({
      id: receipt.id,
      undoneAt: expect.any(String),
    });
    f.database.db.delete(rules).where(eq(rules.id, f.rule.id)).run();
    expect(
      await new ActionsService(new NodeActionStorage(f.database, f.clock)).run(request),
    ).toMatchObject({ id: receipt.id, undoneAt: expect.any(String) });
    expect(new NodeRuleStorage(f.database).definitions()).toHaveLength(0);
  });
  it('rejects stale copies without writes and ignores execution counters and object-key order in revisions', async () => {
    const f = setup();
    const request = copyRequest(f);
    const source = new NodeRuleStorage(f.database).definitions()[0]!;
    expect(ruleCopySource({ ...source, scope: {}, hits24h: 99, hits30d: 100 })).toBe(
      ruleCopySource(source),
    );
    expect(ruleCopySource({ ...source, scope: { feedIds: [1, 2], folderIds: [3] } })).toBe(
      ruleCopySource({ ...source, scope: { folderIds: [3], feedIds: [1, 2] } }),
    );
    expect(ruleCopySource({ ...source, scope: { feedIds: [1, 2] } })).not.toBe(
      ruleCopySource({ ...source, scope: { feedIds: [2, 1] } }),
    );
    f.database.db
      .update(rules)
      .set({ name: 'Changed independently' })
      .where(eq(rules.id, f.rule.id))
      .run();
    const before = f.snapshot();
    const changes = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    await expect(f.service.run(request)).rejects.toThrow('saved rule changed');
    expect(f.snapshot()).toEqual(before);
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
    expect(f.service.recent()).toEqual([]);
  });
  it('refuses copy Undo after a saved edit or later execution without deleting any later work', async () => {
    const f = setup();
    const receipt = await f.service.run(copyRequest(f));
    f.database.db
      .update(rules)
      .set({ name: 'My changed copy' })
      .where(eq(rules.id, receipt.targetId!))
      .run();
    expect(() => f.service.undo(receipt.id)).toThrow('changed after');
    f.database.db
      .update(rules)
      .set({ name: `${f.rule.name} copy` })
      .where(eq(rules.id, receipt.targetId!))
      .run();
    f.database.db
      .insert(ruleLogs)
      .values({ ruleId: receipt.targetId!, articleId: f.article.id, actionsTakenJson: '[]' })
      .run();
    const before = f.snapshot();
    expect(() => f.service.undo(receipt.id)).toThrow('execution history');
    expect(f.snapshot()).toEqual(before);
  });
  it('rolls back a failed rule insertion and validates private HTTP copy requests and replay identity', async () => {
    const f = setup();
    const app = await createApp({ database: f.database, clock: f.clock });
    closes.push(() => app.close());
    const request = copyRequest(f);
    for (const [patch, status] of [
      [{ confirm: false }, 428],
      [{ definition: 'bad' }, 400],
      [{ id: -1 }, 400],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/actions',
        payload: { ...request, ...patch },
      });
      expect(response.statusCode).toBe(status);
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
    f.database.sqlite.exec(
      "CREATE TRIGGER fail_copy BEFORE INSERT ON rules BEGIN SELECT RAISE(ABORT,'forced failure'); END;",
    );
    const before = f.snapshot();
    await expect(f.service.run(request)).rejects.toThrow('Could not copy');
    expect(f.snapshot()).toEqual(before);
    expect(f.service.recent()).toEqual([]);
    f.database.sqlite.exec('DROP TRIGGER fail_copy');
    const response = await app.inject({ method: 'POST', url: '/api/actions', payload: request });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ kind: 'copy_rule', canUndo: true });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/actions',
          payload: {
            ...request,
            definition: JSON.stringify({
              ...JSON.parse(request.definition),
              name: 'Another source version',
            }),
          },
        })
      ).statusCode,
    ).toBe(409);
    f.advance(31_000);
    expect(() => f.service.undo(response.json().id)).toThrow('expired');
  });
  const opml =
    '<opml version="2.0"><body><outline text="New folder"><outline text="First new" xmlUrl="https://private-user:secret@import.test/a?token=private-token"/><outline text="Duplicate" xmlUrl="https://private-user:secret@import.test/a?token=private-token"/></outline><outline text="Design"><outline text="Keep existing" xmlUrl="https://journal.test/feed"/><outline text="Second new" xmlUrl="https://import.test/b"/></outline></body></opml>';
  it('previews exact import/duplicate/folder counts without writes or fetches and validates confirmed input', async () => {
    const f = setup();
    const before = f.snapshot();
    const changes = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    const preview = new OpmlService(f.database).preview(opml);
    expect(preview).toMatchObject({ imported: 2, skipped: 2, foldersCreated: 1 });
    expect(preview.outlines.map((item) => item.status)).toEqual([
      'add',
      'duplicate',
      'subscribed',
      'add',
    ]);
    expect(preview.outlines[0]).toMatchObject({
      title: 'First new',
      source: 'https://import.test/a',
      folder: 'New folder',
    });
    expect(JSON.stringify(preview)).not.toMatch(/private-user|secret|private-token/);
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
    expect(() => f.service.run({ kind: 'import_opml', opml })).toThrow('Confirm');
    expect(() =>
      f.service.run({ kind: 'import_opml', opml: 'é'.repeat(opmlDocumentLimit), confirm: true }),
    ).toThrow('1 MB');
    await expect(
      f.service.run({ kind: 'import_opml', opml: '<wrong/>', confirm: true }),
    ).rejects.toThrow('Invalid OPML');
    await expect(
      f.service.run({
        kind: 'import_opml',
        opml: '<opml><body><outline xmlUrl="javascript:bad"/></body></opml>',
        confirm: true,
      }),
    ).rejects.toThrow('Invalid OPML');
    expect(f.snapshot()).toEqual(before);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
  });
  it('journals the actual import, hashes private documents, replays safely and restores from a new connection', async () => {
    const f = setup();
    const before = f.snapshot();
    let fetched = 0;
    const service = new ActionsService(
      new NodeActionStorage(f.database, f.clock, async () => {
        fetched++;
        throw new Error('No import fetch is allowed.');
      }),
    );
    const request = {
      kind: 'import_opml',
      opml,
      confirm: true,
      requestId: 'opml-durable-request-001',
    } as const;
    const task = service.run(request);
    expect(service.run(request)).toBe(task);
    const action = await task;
    expect(action).toMatchObject({
      kind: 'import_opml',
      targetId: null,
      status: 'complete',
      imported: 2,
      skipped: 2,
      foldersCreated: 1,
      canUndo: true,
      externalEffects: false,
    });
    expect(fetched).toBe(0);
    expect(
      f.database.sqlite
        .prepare('SELECT title,folder_id AS folderId FROM feeds WHERE id=?')
        .get(f.feed.id),
    ).toEqual({ title: 'Notes', folderId: f.folder.id });
    const stored = f.database.sqlite
      .prepare('SELECT args_json,result_json,undo_json FROM agent_actions WHERE id=?')
      .get(action.id) as { args_json: string; result_json: string; undo_json: string };
    expect(Object.keys(JSON.parse(stored.args_json))).toEqual(['sha256']);
    expect(JSON.parse(stored.args_json).sha256).toHaveLength(64);
    expect(JSON.stringify(stored)).not.toMatch(/private-user|secret|private-token|<opml/);
    expect((await service.run(request)).id).toBe(action.id);
    await expect(service.run({ ...request, opml: opml + ' ' })).rejects.toThrow('another action');
    const sqlite = new Database(f.database.sqlite.serialize());
    sqlite.pragma('foreign_keys=ON');
    closes.push(() => sqlite.close());
    const reopened = new ActionsService(
      new NodeActionStorage(
        { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() },
        f.clock,
      ),
    );
    sqlite.prepare("INSERT INTO folders(title,position) VALUES('Unrelated later folder',99)").run();
    const later = sqlite
      .prepare("SELECT * FROM folders WHERE title='Unrelated later folder'")
      .get();
    expect(reopened.undo(action.id).status).toBe('undone');
    for (const [table, rows] of Object.entries(before))
      expect(
        sqlite
          .prepare(
            `SELECT * FROM ${table} ${table === 'folders' ? "WHERE title!='Unrelated later folder'" : ''} ORDER BY rowid`,
          )
          .all(),
      ).toEqual(rows);
    expect(
      sqlite.prepare("SELECT * FROM folders WHERE title='Unrelated later folder'").get(),
    ).toEqual(later);
    expect((await reopened.run(request)).status).toBe('undone');
  });
  it.each(['article', 'folder child', 'rule', 'composition', 'legacy composition'])(
    'refuses atomic import Undo when later %s data uses a new resource',
    async (dependency) => {
      const f = setup();
      const action = await f.service.run({ kind: 'import_opml', opml, confirm: true });
      const added = f.database.sqlite
        .prepare("SELECT id,folder_id AS folderId FROM feeds WHERE title='First new'")
        .get() as { id: number; folderId: number };
      if (dependency === 'article')
        f.database.db
          .insert(articles)
          .values({
            feedId: added.id,
            title: 'Later article',
            guid: 'later',
            hash: 'later',
            url: 'https://import.test/later',
            publishedAt: f.clock.now(),
          })
          .run();
      if (dependency === 'folder child')
        f.database.db
          .insert(feeds)
          .values({
            title: 'Later subscription',
            url: 'https://later.test/feed',
            folderId: added.folderId,
          })
          .run();
      if (dependency === 'rule')
        f.database.db
          .update(rules)
          .set({ scopeJson: JSON.stringify({ feedIds: [added.id] }) })
          .where(eq(rules.id, f.rule.id))
          .run();
      if (dependency === 'composition' || dependency === 'legacy composition')
        f.database.sqlite
          .prepare('INSERT INTO brew_configs(name,sections_json) VALUES(?,?)')
          .run(
            'Later Brew',
            JSON.stringify(
              dependency === 'composition'
                ? [{ sources: [{ kind: 'folder', id: added.folderId }] }]
                : [{ source: 'feed', sourceId: added.id }],
            ),
          );
      const before = f.snapshot();
      const configs = f.database.sqlite.prepare('SELECT * FROM brew_configs').all();
      expect(() => f.service.undo(action.id)).toThrow('now in use');
      expect(f.snapshot()).toEqual(before);
      expect(f.database.sqlite.prepare('SELECT * FROM brew_configs').all()).toEqual(configs);
      expect(f.service.recent()[0]).toMatchObject({ status: 'complete', canUndo: true });
    },
  );
  it('gives no-op imports truthful receipts and prunes expired private import recovery', async () => {
    const f = setup();
    const first = await f.service.run({ kind: 'import_opml', opml, confirm: true });
    const duplicate = await f.service.run({ kind: 'import_opml', opml, confirm: true });
    expect(duplicate).toMatchObject({
      imported: 0,
      skipped: 4,
      foldersCreated: 0,
      canUndo: false,
      expiresAt: null,
    });
    f.advance(30_001);
    f.service.cleanup();
    expect(
      f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_action_changes').get(),
    ).toEqual({ n: 0 });
    expect(() => f.service.undo(first.id)).toThrow('expired');
  });
  it('accepts bounded JSON import envelopes, keeps preview private/read-only and preserves legacy import', async () => {
    const f = setup();
    closes.pop();
    const app = await createApp({ database: f.database, clock: f.clock });
    closes.push(() => app.close());
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    const preview = await app.inject({
      method: 'POST',
      url: '/api/opml/preview',
      headers: { 'content-type': 'text/x-opml' },
      payload: opml,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.headers['cache-control']).toBe('private, no-store');
    expect(preview.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(preview.body).not.toMatch(/private-user|secret|private-token/);
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/actions',
          payload: { kind: 'import_opml', opml },
        })
      ).statusCode,
    ).toBe(428);
    const large =
      '<opml><body><!--' + String.fromCharCode(34).repeat(800_000) + '--></body></opml>';
    const response = await app.inject({
      method: 'POST',
      url: '/api/actions',
      payload: {
        kind: 'import_opml',
        opml: large,
        confirm: true,
        requestId: 'large-opml-envelope-001',
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ imported: 0, canUndo: false });
    const legacy = await app.inject({
      method: 'POST',
      url: '/api/opml/import',
      headers: { 'content-type': 'text/x-opml' },
      payload: opml,
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json()).toEqual({ imported: 2, skipped: 2, foldersCreated: 1 });
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 1,
    });
  });
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
