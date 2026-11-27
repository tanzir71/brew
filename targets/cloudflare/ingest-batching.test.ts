import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { D1Database } from '@cloudflare/workers-types';
import { CloudflareStorage } from './src/storage.js';
import { CloudflareIngestStorage } from './src/ingest-storage.js';
import { CloudflareRuleStorage } from './src/rule-storage.js';
import { NodeIngestStorage } from '../node/src/ports/ingest-storage.js';
import { NodeRuleStorage } from '../node/src/ports/rule-storage.js';
import { openDatabase } from '../node/src/db/database.js';
import { nodeRegex } from '../node/src/ports/runtime.js';
import { IngestPipeline } from '../../packages/core/src/ingest-pipeline.js';
import { AsyncRulesService } from '../../packages/core/src/async-rules-service.js';
import { RulesService } from '../../packages/core/src/rules-service.js';
import { PollInterruptedError } from '../../packages/core/src/feed-polling.js';
import { NewsletterInputError } from '../../packages/core/src/newsletter-mime.js';
import type { RuleAction, RuleCondition } from '../../packages/core/src/types/rules.js';

const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ingest batch fixture"); } };',
  compatibilityDate: '2026-07-01',
  d1Databases: ['DB'],
});
let database: D1Database;
let storage: CloudflareStorage;
let node: ReturnType<typeof openDatabase>;
const now = Date.parse('2026-11-27T12:00:00Z');
const cutoff = now - 3 * 86_400_000;
const clock = { now: () => new Date(now), monotonic: () => 0 };
const hash = { sha1: (value: string) => createHash('sha1').update(value).digest('hex') };

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
      'DROP TRIGGER IF EXISTS hide_failure',
      'DELETE FROM feeds',
      'DELETE FROM rules',
      'DELETE FROM settings',
      'DELETE FROM inbound_addresses',
      "DELETE FROM sqlite_sequence WHERE name IN ('feeds','articles','rules')",
    ].map((sql) => storage.statement(sql)),
  );
  node = openDatabase(':memory:');
  await both(
    "INSERT INTO feeds(id,url,title,kind) VALUES(1,'https://one.test/rss','One','rss'),(2,'https://two.test/rss','Two','rss'),(3,'mailto:letters@example.test','Letters','newsletter')",
  );
});
afterEach(() => node.close());
afterAll(() => runtime.dispose());
async function both(sql: string, values: (string | number)[] = []) {
  node.sqlite.prepare(sql).run(...values);
  await storage.run(sql, values);
}
async function seed(count: number, title = 'Unique story ') {
  await both(
    `WITH RECURSIVE numbers(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM numbers WHERE id<?)
    INSERT INTO articles(id,feed_id,guid,hash,url,title,content_html,published_at)
    SELECT id,1,'g-'||id,'h-'||id,'https://one.test/a/'||id,?||id,'<p>Stored content.</p>',? FROM numbers`,
    [count, title, now],
  );
}
async function rule(
  id: number,
  conditions: RuleCondition[],
  actions: RuleAction[],
  stop = false,
  enabled = true,
  scope = {},
) {
  await both(
    `INSERT INTO rules(id,name,position,enabled,match_type,scope_json,conditions_json,actions_json,stop_processing)
    VALUES(?,?,?,?,'all',?,?,?,?)`,
    [
      id,
      `Rule ${id}`,
      id,
      Number(enabled),
      JSON.stringify(scope),
      JSON.stringify(conditions),
      JSON.stringify(actions),
      Number(stop),
    ],
  );
}
const quietNetwork = {
  fetch: async () => {
    throw new Error('Unexpected network request');
  },
};
const quietNotifications = { notify: () => undefined };

it('matches Node duplicate policy across feeds, Unicode, self exclusion, old subjects and the exact three-day boundary before rules run', async () => {
  const rows = [
    [1, 2, 'River conservation report', cutoff],
    [2, 2, 'Ancient archaeology note', cutoff - 1],
    [3, 2, 'An unrelated candidate', now],
    [4, 1, 'Ｒｉｖｅｒ　conservation report', now],
    [5, 1, 'Ancient archaeology note', now],
    [6, 1, 'Only subject', now],
    [7, 3, 'River conservation report', now],
    [8, 1, 'Twin young', now],
    [9, 1, 'Twin young', now],
    [10, 1, 'River conservation report', now - 10 * 86_400_000],
  ] as const;
  for (const [id, feedId, title, published] of rows)
    await both(
      'INSERT INTO articles(id,feed_id,guid,hash,url,title,published_at) VALUES(?,?,?,?,?,?,?)',
      [id, feedId, `g-${id}`, `h-${id}`, `https://one.test/${id}`, title, published],
    );
  await both(
    `WITH RECURSIVE numbers(id) AS (SELECT 11 UNION ALL SELECT id+1 FROM numbers WHERE id<310)
    INSERT INTO articles(id,feed_id,guid,hash,url,title,published_at)
    SELECT id,2,'window-'||id,'window-'||id,'https://two.test/window/'||id,
      'Window narrative candidate number '||id,? FROM numbers`,
    [now],
  );
  await both("INSERT INTO settings(key,value) VALUES('duplicate_filter_enabled','true')");
  const ids = [4, 5, 6, 8, 9, 10],
    expected = [
      { id: 4, hidden: 1 },
      { id: 5, hidden: 0 },
      { id: 6, hidden: 0 },
      { id: 8, hidden: 1 },
      { id: 9, hidden: 1 },
      { id: 10, hidden: 1 },
    ];
  const query = 'SELECT id,hidden FROM articles WHERE id IN (4,5,6,8,9,10) ORDER BY id';
  const nodeRules = {
    evaluateArticle: async () => 0,
    evaluateArticles: async (actual: number[]) => {
      expect(actual).toEqual(ids);
      expect(node.sqlite.prepare(query).all()).toEqual(expected);
      return 0;
    },
  };
  const cloudRules = {
    evaluateArticle: async () => 0,
    evaluateArticles: async (actual: number[]) => {
      expect(actual).toEqual(ids);
      expect(await storage.all(query)).toEqual(expected);
      return 0;
    },
  };
  await new IngestPipeline(new NodeIngestStorage(node), hash, clock, nodeRules).processInserted(
    { id: 1, retentionDays: 90 },
    ids,
  );
  await new IngestPipeline(
    new CloudflareIngestStorage(storage),
    hash,
    clock,
    cloudRules,
  ).processInserted({ id: 1, retentionDays: 90 }, ids);
  expect(await storage.all('SELECT id,hidden FROM articles ORDER BY id')).toEqual(
    node.sqlite.prepare('SELECT id,hidden FROM articles ORDER BY id').all(),
  );
});

it('reads duplicate titles once, hides all matches once, then prunes without per-article D1 calls', async () => {
  await seed(200);
  await both("UPDATE articles SET title='Identical conservation report'");
  await both("INSERT INTO settings(key,value) VALUES('duplicate_filter_enabled','true')");
  const calls = {
    batch: vi.spyOn(storage, 'batch'),
    first: vi.spyOn(storage, 'first'),
    all: vi.spyOn(storage, 'all'),
    run: vi.spyOn(storage, 'run'),
  };
  await new IngestPipeline(new CloudflareIngestStorage(storage), hash, clock).processInserted(
    { id: 1, retentionDays: 90 },
    Array.from({ length: 200 }, (_, i) => i + 1),
  );
  expect(calls.batch).toHaveBeenCalledTimes(3);
  for (const method of [calls.first, calls.all, calls.run]) expect(method).not.toHaveBeenCalled();
  Object.values(calls).forEach((call) => call.mockRestore());
  expect(await storage.first('SELECT count(*) AS count FROM articles WHERE hidden=1')).toEqual({
    count: 200,
  });
});

it('loads rule definitions once per evaluation and contexts in groups of 40, while later evaluations see saved changes', async () => {
  await seed(83);
  await rule(
    1,
    [{ field: 'title', operator: 'contains', value: 'No match here' }],
    [{ type: 'star' }],
  );
  const adapter = new CloudflareRuleStorage(storage),
    definitions = vi.spyOn(adapter, 'definitions'),
    contexts = vi.spyOn(adapter, 'contexts'),
    single = vi.spyOn(adapter, 'context');
  const service = new AsyncRulesService(
    adapter,
    nodeRegex,
    quietNetwork,
    quietNotifications,
    clock,
  );
  const ids = Array.from({ length: 83 }, (_, id) => id + 1);
  expect(await service.evaluateArticles(ids)).toBe(0);
  expect(definitions).toHaveBeenCalledTimes(1);
  expect(contexts.mock.calls.map(([values]) => values.length)).toEqual([40, 40, 3]);
  expect(single).not.toHaveBeenCalled();
  await storage.run("UPDATE rules SET conditions_json='[]' WHERE id=1");
  expect(await service.evaluateArticles([1])).toBe(1);
  expect(await storage.first('SELECT starred_at FROM articles WHERE id=1')).toEqual({
    starred_at: now,
  });
  expect(await storage.first('SELECT starred_at FROM articles WHERE id=2')).toEqual({
    starred_at: null,
  });
});

it.each(['poll', 'mail'] as const)(
  'fences a duplicate hide after %s admission is revoked',
  async (kind) => {
    await seed(2);
    await both("UPDATE articles SET title='Same story'");
    await both("INSERT INTO settings(key,value) VALUES('duplicate_filter_enabled','true')");
    if (kind === 'poll')
      await storage.run('INSERT INTO feed_poll_leases(feed_id,runner,expires_at) VALUES(1,?,?)', [
        'owner',
        now + 60_000,
      ]);
    else
      await storage.run(
        "INSERT INTO inbound_addresses(address,mechanism,active) VALUES('batch@example.test','cloudflare-email',1)",
      );
    const adapter = new CloudflareIngestStorage(storage, () => ({
      predicate:
        kind === 'poll'
          ? "EXISTS(SELECT 1 FROM feed_poll_leases l JOIN feeds f ON f.id=l.feed_id WHERE l.feed_id=? AND l.runner=? AND l.expires_at>? AND f.url=? AND f.kind='rss')"
          : "EXISTS(SELECT 1 FROM inbound_addresses WHERE address=? AND active=1 AND mechanism='cloudflare-email')",
      values: kind === 'poll' ? [1, 'owner', now, 'https://one.test/rss'] : ['batch@example.test'],
      ...(kind === 'mail'
        ? { error: () => new NewsletterInputError('This receiving address is not active.') }
        : {}),
    }));
    expect((await adapter.duplicateTitles([1, 2], cutoff))!.subjects).toHaveLength(2);
    if (kind === 'poll')
      await storage.run("UPDATE feed_poll_leases SET runner='replacement' WHERE feed_id=1");
    else
      await storage.run("UPDATE inbound_addresses SET active=0 WHERE address='batch@example.test'");
    await expect(adapter.hideMany([1, 2])).rejects.toBeInstanceOf(
      kind === 'poll' ? PollInterruptedError : NewsletterInputError,
    );
    expect(await storage.all('SELECT hidden FROM articles ORDER BY id')).toEqual([
      { hidden: 0 },
      { hidden: 0 },
    ]);
  },
);

it('rolls back all duplicate hides on a failed update in both Node and native D1', async () => {
  await seed(3);
  await both(`CREATE TRIGGER hide_failure BEFORE UPDATE OF hidden ON articles WHEN OLD.id=2 AND NEW.hidden=1
    BEGIN SELECT RAISE(ABORT,'hide test failure'); END`);
  expect(() => new NodeIngestStorage(node).hideMany([1, 2, 3])).toThrow();
  await expect(new CloudflareIngestStorage(storage).hideMany([1, 2, 3])).rejects.toThrow();
  const expected = [{ hidden: 0 }, { hidden: 0 }, { hidden: 0 }];
  expect(node.sqlite.prepare('SELECT hidden FROM articles ORDER BY id').all()).toEqual(expected);
  expect(await storage.all('SELECT hidden FROM articles ORDER BY id')).toEqual(expected);
});

it('preserves input/rule/action order, stop-processing, real failed webhooks and notifications compared with Node single-item evaluation', async () => {
  const requests: unknown[] = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    requests.push(JSON.parse(raw));
    response.writeHead(500);
    response.end('controlled failure');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected local HTTP port');
    await seed(2);
    await both("UPDATE articles SET title='Keep story' WHERE id=1");
    await rule(
      1,
      [],
      [{ type: 'add_tag', tag: 'Batch' }, { type: 'mark_read' }, { type: 'feature_in_brew' }],
    );
    await rule(
      2,
      [{ field: 'title', operator: 'contains', value: 'Keep' }],
      [{ type: 'webhook', url: `http://127.0.0.1:${address.port}/failure` }, { type: 'notify' }],
      true,
    );
    await rule(
      3,
      [],
      [
        { type: 'remove_tag', tag: 'Batch' },
        { type: 'exclude_from_brew' },
        { type: 'highlight', color: '#5E86A8' },
      ],
    );
    await rule(4, [], [{ type: 'hide' }], false, false);
    await rule(
      5,
      Array.from({ length: 11 }, () => ({
        field: 'title' as const,
        operator: 'contains' as const,
        value: 'story',
      })),
      [{ type: 'hide' }],
    );
    await rule(6, [], [{ type: 'hide' }], false, true, { feedIds: [999] });
    const nodeNotices: number[] = [],
      cloudNotices: number[] = [];
    const nodeRules = new RulesService(
      new NodeRuleStorage(node),
      nodeRegex,
      { fetch },
      {
        notify: ({ id }) => {
          nodeNotices.push(id);
        },
      },
      clock,
    );
    const cloudRules = new AsyncRulesService(
      new CloudflareRuleStorage(storage),
      nodeRegex,
      { fetch },
      {
        notify: ({ id }) => {
          cloudNotices.push(id);
        },
      },
      clock,
    );
    let expected = 0;
    for (const id of [2, 1]) expected += await nodeRules.evaluateArticle(id);
    expect(await cloudRules.evaluateArticles([2, 1])).toBe(expected);
    expect(expected).toBe(4);
    for (const sql of [
      'SELECT id,read_at,starred_at,hidden,highlight_color,featured_in_brew,excluded_from_brew FROM articles ORDER BY id',
      'SELECT rule_id,article_id,actions_taken_json FROM rule_logs ORDER BY id',
      'SELECT * FROM article_tags ORDER BY article_id,tag_id',
    ]) {
      expect(await storage.all(sql)).toEqual(node.sqlite.prepare(sql).all());
    }
    expect(nodeNotices).toEqual([1]);
    expect(cloudNotices).toEqual([1]);
    expect(requests).toHaveLength(4);
    expect(
      requests.every((request) => JSON.stringify(request) === JSON.stringify(requests[0])),
    ).toBe(true);
    expect(await storage.first('SELECT actions_taken_json FROM rule_logs WHERE rule_id=2')).toEqual(
      {
        actions_taken_json: JSON.stringify([
          { type: 'webhook', ok: false, error: 'HTTP 500' },
          { type: 'notify', ok: true },
        ]),
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
