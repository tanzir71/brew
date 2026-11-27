import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { D1Database } from '@cloudflare/workers-types';
import { CloudflareStorage } from './src/storage.js';
import { CloudflareRuleStorage } from './src/rule-storage.js';
import { NodeRuleStorage } from '../node/src/ports/rule-storage.js';
import { openDatabase } from '../node/src/db/database.js';
import { nodeRegex } from '../node/src/ports/runtime.js';
import { AsyncRulesService } from '../../packages/core/src/async-rules-service.js';
import type { AsyncRuleStoragePort } from '../../packages/core/src/ports.js';
import type { RuleAction } from '../../packages/core/src/types/rules.js';

const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("rule effects fixture"); } };',
  compatibilityDate: '2026-07-01',
  d1Databases: ['DB'],
});
let database: D1Database;
let storage: CloudflareStorage;
let node: ReturnType<typeof openDatabase>;
const now = Date.parse('2026-11-27T12:00:00Z');
const clock = { now: () => new Date(now), monotonic: () => 0 };
const unavailableNetwork = {
  fetch: (() => {
    throw new Error('Unexpected network');
  }) as typeof fetch,
};
const unavailableNotifications = {
  notify: () => {
    throw new Error('Unexpected notification');
  },
};

beforeAll(async () => {
  database = (await runtime.getD1Database('DB')) as unknown as D1Database;
  const directory = new URL('../../packages/db/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    await database.batch(
      unstable_splitSqlQuery(await readFile(new URL(name, directory), 'utf8')).map((sql) =>
        database.prepare(sql),
      ),
    );
  }
}, 30_000);
beforeEach(async () => {
  storage = new CloudflareStorage(database);
  await storage.batch(
    [
      'DROP TRIGGER IF EXISTS tag_failure',
      'DROP TRIGGER IF EXISTS remove_failure',
      'DROP TRIGGER IF EXISTS log_failure',
      'DROP TRIGGER IF EXISTS field_failure',
      'DELETE FROM feeds',
      'DELETE FROM rules',
      'DELETE FROM tags',
      'DELETE FROM settings',
    ].map((sql) => storage.statement(sql)),
  );
  node = openDatabase(':memory:');
  await both("INSERT INTO feeds(id,url,title) VALUES(1,'https://feed.test/rss','Feed')");
  await both(
    `INSERT INTO articles(id,feed_id,guid,hash,url,title,published_at)
    VALUES(1,1,'one','one','https://feed.test/one','Story',?)`,
    [now],
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  node.close();
});
afterAll(() => runtime.dispose());
async function both(sql: string, values: (string | number)[] = []) {
  node.sqlite.prepare(sql).run(...values);
  await storage.run(sql, values);
}
async function rule(actions: RuleAction[]) {
  await both(
    `INSERT INTO rules(id,name,position,enabled,match_type,scope_json,conditions_json,actions_json,stop_processing)
    VALUES(1,'Effects',0,1,'all','{}','[]',?,0)`,
    [JSON.stringify(actions)],
  );
}
function engine(adapter: AsyncRuleStoragePort) {
  return new AsyncRulesService(
    adapter,
    nodeRegex,
    unavailableNetwork,
    unavailableNotifications,
    clock,
  );
}
const tagsSql =
  'SELECT t.name FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id=1 ORDER BY t.name';
const fieldsSql =
  'SELECT starred_at,read_at,hidden,highlight_color,featured_in_brew,excluded_from_brew FROM articles WHERE id=1';
const logsSql = 'SELECT rule_id,article_id,actions_taken_json FROM rule_logs ORDER BY id';
async function parity() {
  for (const sql of [tagsSql, fieldsSql, logsSql])
    expect(await storage.all(sql)).toEqual(node.sqlite.prepare(sql).all());
}
function legacy(adapter: NodeRuleStorage): AsyncRuleStoragePort {
  return new Proxy(adapter, {
    get(target, key) {
      if (key === 'applyTagActions' || key === 'commitRule') return undefined;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

it('uses one ordered tag batch and one field/log batch, matching the individual Node path', async () => {
  const actions: RuleAction[] = Array.from({ length: 24 }, (_, index) => ({
    type: 'add_tag',
    tag: `Tag ${index}`,
  }));
  actions.push(
    { type: 'add_tag', tag: 'Tag 0' },
    { type: 'remove_tag', tag: 'Tag 0' },
    { type: 'add_tag', tag: 'Tag 0' },
    { type: 'remove_tag', tag: 'Tag 1' },
    { type: 'remove_tag', tag: 'Absent' },
    { type: 'star' },
    { type: 'mark_read' },
    { type: 'hide' },
    { type: 'highlight', color: '#123456' },
    { type: 'feature_in_brew' },
    { type: 'exclude_from_brew' },
  );
  await rule(actions);
  expect(await engine(legacy(new NodeRuleStorage(node))).evaluateArticle(1)).toBe(1);
  const calls = vi.spyOn(storage, 'batch');
  expect(await engine(new CloudflareRuleStorage(storage)).evaluateArticles([1])).toBe(1);
  expect(calls).toHaveBeenCalledTimes(2);
  calls.mockRestore();
  await parity();
  expect(await storage.first(fieldsSql)).toEqual({
    starred_at: now,
    read_at: now,
    hidden: 1,
    highlight_color: '#123456',
    featured_in_brew: 0,
    excluded_from_brew: 1,
  });
  expect(await storage.first("SELECT value FROM settings WHERE key='library_revision'")).toEqual({
    value: '2',
  });
});

it('flushes tags before real HTTP and notification effects while preserving deferred fields and actual failures', async () => {
  let readState: () => Promise<unknown>;
  const observations: unknown[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    observations.push({
      payload: JSON.parse(Buffer.concat(chunks).toString()),
      state: await readState(),
    });
    response.writeHead(request.url === '/fail' ? 503 : 204);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected local HTTP port');
    await rule([
      { type: 'star' },
      { type: 'add_tag', tag: 'Before' },
      { type: 'webhook', url: `http://127.0.0.1:${address.port}/ok` },
      { type: 'remove_tag', tag: 'Before' },
      { type: 'add_tag', tag: 'During' },
      { type: 'notify' },
      { type: 'webhook', url: `http://127.0.0.1:${address.port}/fail` },
      { type: 'remove_tag', tag: 'During' },
      { type: 'add_tag', tag: 'After' },
      { type: 'mark_read' },
    ]);
    for (const kind of ['node', 'cloud'] as const) {
      observations.length = 0;
      readState = async () =>
        kind === 'node'
          ? {
              tags: node.sqlite.prepare(tagsSql).all(),
              fields: node.sqlite.prepare(fieldsSql).get(),
            }
          : { tags: await storage.all(tagsSql), fields: await storage.first(fieldsSql) };
      const service = new AsyncRulesService(
        kind === 'node' ? legacy(new NodeRuleStorage(node)) : new CloudflareRuleStorage(storage),
        nodeRegex,
        { fetch },
        {
          notify: async () => {
            observations.push({ notification: await readState() });
            throw new Error('Notification refused');
          },
        },
        clock,
      );
      expect(await service.evaluateArticle(1)).toBe(1);
      expect(observations).toHaveLength(4);
      const before = {
        tags: [{ name: 'Before' }],
        fields: {
          starred_at: null,
          read_at: null,
          hidden: 0,
          highlight_color: null,
          featured_in_brew: 0,
          excluded_from_brew: 0,
        },
      };
      expect(observations[0]).toEqual({
        payload: {
          article: { id: 1, title: 'Story', url: 'https://feed.test/one' },
          rule: { id: 1, name: 'Effects' },
        },
        state: before,
      });
      const during = { ...before, tags: [{ name: 'During' }] };
      expect(observations[1]).toEqual({ notification: during });
      expect(observations[2]).toMatchObject({ state: during });
      expect(observations[3]).toEqual(observations[2]);
    }
    await parity();
    const results = JSON.parse(
      (await storage.first<{ actions_taken_json: string }>(logsSql))!.actions_taken_json,
    );
    expect(results[2]).toEqual({ type: 'webhook', ok: true });
    expect(results[5]).toEqual({ type: 'notify', ok: false, error: 'Notification refused' });
    expect(results[6]).toEqual({ type: 'webhook', ok: false, error: 'HTTP 503' });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it('falls back only after confirmed SQL constraint rollback and logs each real local result', async () => {
  await both("INSERT INTO tags(id,name,color) VALUES(1,'Keep','#123456')");
  await both('INSERT INTO article_tags(article_id,tag_id) VALUES(1,1)');
  await both(`CREATE TRIGGER tag_failure BEFORE INSERT ON tags WHEN NEW.name='Refused'
    BEGIN SELECT RAISE(ABORT,'tag fixture refusal'); END`);
  await both(`CREATE TRIGGER remove_failure BEFORE DELETE ON article_tags WHEN OLD.tag_id=1
    BEGIN SELECT RAISE(ABORT,'remove fixture refusal'); END`);
  await rule([
    { type: 'add_tag', tag: 'First' },
    { type: 'add_tag', tag: 'Refused' },
    { type: 'remove_tag', tag: 'Keep' },
    { type: 'add_tag', tag: 'Last' },
    { type: 'star' },
  ]);
  for (const adapter of [new NodeRuleStorage(node), new CloudflareRuleStorage(storage)]) {
    expect(await engine(adapter).evaluateArticle(1)).toBe(1);
    const results = (await adapter.logs(1))[0]!.actions;
    expect(results.map(({ type, ok }) => ({ type, ok }))).toEqual([
      { type: 'add_tag', ok: true },
      { type: 'add_tag', ok: false },
      { type: 'remove_tag', ok: false },
      { type: 'add_tag', ok: true },
      { type: 'star', ok: true },
    ]);
    expect(results[1]!.error).toContain('tag fixture refusal');
    expect(results[2]!.error).toContain('remove fixture refusal');
  }
  expect(await storage.all(tagsSql)).toEqual([
    { name: 'First' },
    { name: 'Keep' },
    { name: 'Last' },
  ]);
  expect(node.sqlite.prepare(tagsSql).all()).toEqual(await storage.all(tagsSql));
  expect(await storage.first("SELECT count(*) AS n FROM tags WHERE name='Refused'")).toEqual({
    n: 0,
  });
});

it('records malformed tag failures without dropping the other saved actions', async () => {
  await rule([
    { type: 'add_tag', tag: 'First' },
    { type: 'add_tag', tag: null },
    { type: 'add_tag', tag: 'Last' },
    { type: 'mark_read' },
  ] as unknown as RuleAction[]);
  for (const adapter of [new NodeRuleStorage(node), new CloudflareRuleStorage(storage)]) {
    expect(await engine(adapter).evaluateArticle(1)).toBe(1);
    expect((await adapter.logs(1))[0]!.actions[1]).toEqual({
      type: 'add_tag',
      ok: false,
      error: 'A tag name must be a string',
    });
  }
  await parity();
});

it.each(['log', 'field'] as const)(
  'rolls back the final fields and log together on %s failure, then permits an explicit retry',
  async (failure) => {
    const value = {
      ruleId: 1,
      articleId: 1,
      changes: { starredAt: new Date(now), hidden: true },
      results: [
        { type: 'star' as const, ok: true },
        { type: 'hide' as const, ok: true },
      ],
    };
    await rule([]);
    await both(
      failure === 'log'
        ? "CREATE TRIGGER log_failure BEFORE INSERT ON rule_logs BEGIN SELECT RAISE(ABORT,'log fixture refusal'); END"
        : "CREATE TRIGGER field_failure BEFORE UPDATE OF hidden ON articles BEGIN SELECT RAISE(ABORT,'field fixture refusal'); END",
    );
    const nodeAdapter = new NodeRuleStorage(node),
      cloudAdapter = new CloudflareRuleStorage(storage);
    expect(() => nodeAdapter.commitRule(value)).toThrow(`${failure} fixture refusal`);
    await expect(cloudAdapter.commitRule(value)).rejects.toThrow(`${failure} fixture refusal`);
    expect(await storage.first('SELECT starred_at,hidden FROM articles WHERE id=1')).toEqual({
      starred_at: null,
      hidden: 0,
    });
    expect(node.sqlite.prepare('SELECT starred_at,hidden FROM articles WHERE id=1').get()).toEqual({
      starred_at: null,
      hidden: 0,
    });
    expect(await storage.all(logsSql)).toEqual([]);
    expect(
      await storage.first("SELECT value FROM settings WHERE key='library_revision'"),
    ).toBeNull();
    await both(`DROP TRIGGER ${failure}_failure`);
    nodeAdapter.commitRule(value);
    await cloudAdapter.commitRule(value);
    await parity();
    expect(await storage.all(logsSql)).toHaveLength(1);
  },
);

it('does not replay an uncertain tag write or report it as a provider failure', async () => {
  await rule([{ type: 'add_tag', tag: 'Once' }, { type: 'notify' }]);
  const original = storage.batch.bind(storage);
  const calls = vi.spyOn(storage, 'batch').mockImplementation(async (statements) => {
    await original(statements);
    throw new Error('D1_ERROR: Network connection lost.');
  });
  const adapter = new CloudflareRuleStorage(storage),
    single = vi.spyOn(adapter, 'addTag');
  await expect(engine(adapter).evaluateArticle(1)).rejects.toThrow('Network connection lost');
  expect(calls).toHaveBeenCalledTimes(1);
  expect(single).not.toHaveBeenCalled();
  calls.mockRestore();
  expect(await storage.all(tagsSql)).toEqual([{ name: 'Once' }]);
  expect(await storage.all(logsSql)).toEqual([]);
});

it('does not retry an uncertain final commit or duplicate a durable log', async () => {
  await rule([{ type: 'star' }]);
  const original = storage.batch.bind(storage);
  const calls = vi.spyOn(storage, 'batch').mockImplementation(async (statements) => {
    await original(statements);
    throw new Error('D1_ERROR: Network connection lost.');
  });
  await expect(engine(new CloudflareRuleStorage(storage)).evaluateArticles([1])).rejects.toThrow(
    'Network connection lost',
  );
  expect(calls).toHaveBeenCalledTimes(1);
  calls.mockRestore();
  expect(await storage.first('SELECT starred_at FROM articles WHERE id=1')).toEqual({
    starred_at: now,
  });
  expect(await storage.all(logsSql)).toHaveLength(1);
});

it('uses the same commit path for manual apply and records empty action lists once', async () => {
  await rule([]);
  const calls = vi.spyOn(storage, 'batch');
  expect(await engine(new NodeRuleStorage(node)).applyToExisting(1, 30)).toBe(1);
  expect(await engine(new CloudflareRuleStorage(storage)).applyToExisting(1, 30)).toBe(1);
  expect(calls).toHaveBeenCalledTimes(1);
  calls.mockRestore();
  await parity();
  expect(await storage.first(logsSql)).toMatchObject({ actions_taken_json: '[]' });
});
