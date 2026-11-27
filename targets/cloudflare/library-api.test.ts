import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';
import { fileURLToPath } from 'node:url';
import type { ReaderTestEnv } from './test/reader-worker.js';
import type {
  RuleDraft,
  RuleRecord,
  RuleLogPage,
  RulePreviewItem,
} from '../../packages/core/src/types/rules.js';
import { openDatabase } from '../node/src/db/database.js';
import { createApp } from '../node/src/app.js';
import { libraryUpstream } from './test/library-upstream.js';
import { RulesService } from '../../packages/core/src/rules-service.js';
import { IngestPipeline } from '../../packages/core/src/ingest-pipeline.js';
import { NewsletterPipeline } from '../../packages/core/src/newsletter-pipeline.js';
import { NodeRuleStorage } from '../node/src/ports/rule-storage.js';
import { NodeIngestStorage } from '../node/src/ports/ingest-storage.js';
import { NodeNewsletterStorage } from '../node/src/ports/newsletter-storage.js';
import { nodeHash, nodeRegex } from '../node/src/ports/runtime.js';
import { readNewsletterStream } from './src/ingestion.js';
import { MAX_NEWSLETTER_BYTES } from '../../packages/core/src/newsletter-mime.js';
import { newBrewSection, defaultDelivery } from '../../packages/core/src/composition-model.js';

const now = Date.parse('2026-11-27T12:00:00Z');
const clock = { now: () => new Date(now), monotonic: () => performance.now() };
const server = createTestHarness({
  workers: [
    {
      config: {
        name: 'brew-library-test',
        main: fileURLToPath(new URL('./test/library-worker.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        compatibility_flags: ['nodejs_compat'],
        rules: [{ type: 'CompiledWasm', globs: ['**/*.wasm', '**/wasm'], fallthrough: true }],
        workers_dev: false,
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'library-test',
            database_id: '00000000-0000-0000-0000-000000000001',
            migrations_dir: fileURLToPath(
              new URL('../../packages/db/migrations/', import.meta.url),
            ),
          },
        ],
        r2_buckets: [{ binding: 'IMAGES', bucket_name: 'library-images-test' }],
        services: [{ binding: 'UPSTREAM', service: 'brew-library-upstream' }],
      },
    },
    {
      config: {
        name: 'brew-library-upstream',
        main: fileURLToPath(new URL('./test/library-upstream.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        workers_dev: false,
      },
    },
  ],
});
const worker = server.getWorker<ReaderTestEnv>('brew-library-test');
let env: ReaderTestEnv;
const database = openDatabase(':memory:');
let node: Awaited<ReturnType<typeof createApp>>;
const nodeRules = new RulesService(
  new NodeRuleStorage(database),
  nodeRegex,
  { fetch: async (input, init) => libraryUpstream(new Request(input, init)) },
  { notify: () => {} },
  clock,
);
beforeAll(async () => {
  await server.listen();
  await worker.applyD1Migrations('DB');
  env = await worker.getEnv();
  node = await createApp({
    publicUrl: 'https://brew.example.test',
    database,
    logger: false,
    clock,
    fetcher: async (input, init) => libraryUpstream(new Request(input, init)),
  });
  const sql = [
    "INSERT INTO folders(id,title) VALUES(1,'Research')",
    `INSERT INTO feeds(id,url,title,folder_id,kind,settings_json) VALUES(1,'https://source.example.test/rss','Journal',1,'rss','{}'),(2,'mailto:letter@example.test','Letters',NULL,'newsletter','{"onlyInBrew":true}')`,
    "INSERT INTO tags(id,name,color) VALUES(1,'Old','#000000')",
  ];
  for (let id = 1; id <= 125; id++)
    sql.push(
      `INSERT INTO articles(id,feed_id,guid,hash,url,title,content_html,summary_html,published_at,hidden) VALUES(${id},${id === 125 ? 2 : 1},'g-${id}','h-${id}','https://source.example.test/${id}','Design item ${id}','<p>Careful &amp; considered ${id}.</p>','<p>Excerpt ${id}.</p>',${now - id * 60000},${id === 1 ? 1 : 0})`,
    );
  sql.push('INSERT INTO article_tags(article_id,tag_id) VALUES(2,1)');
  database.sqlite.exec(sql.join(';'));
  await env.DB.batch(sql.map((query) => env.DB.prepare(query)));
}, 30000);
afterAll(async () => {
  await node?.close();
  await server.close();
});
async function request(path: string, method = 'GET', body?: unknown) {
  return worker.fetch(`https://brew.example.test${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await request(path, method, body);
  const result = await response.json();
  expect(response.status, JSON.stringify(result)).toBeGreaterThanOrEqual(200);
  expect(response.status, JSON.stringify(result)).toBeLessThan(300);
  return result as T;
}
async function both<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const actual = await json<T>(path, method, body);
  const expected = await node.inject({
    url: path,
    method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
    ...(body === undefined
      ? {}
      : { payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  const expectedValue = expected.json();
  // Independent database creation timestamps are not one shared wall-clock event.
  if (actual && typeof actual === 'object' && 'createdAt' in actual) {
    expect(Number.isFinite(Date.parse(String(actual.createdAt)))).toBe(true);
    expect({ ...actual, createdAt: '' }).toEqual({ ...expectedValue, createdAt: '' });
  } else expect(actual).toEqual(expectedValue);
  return actual;
}
async function state() {
  return (
    await env.DB.batch(
      [
        'rules',
        'rule_logs',
        'articles',
        'article_tags',
        'tags',
        'saved_source_searches',
        'settings',
        'instance_events',
      ].map((table) => env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`)),
    )
  ).map((result) => result.results);
}
const draft = (name = 'Triage'): RuleDraft => ({
  name,
  enabled: true,
  scope: {},
  matchType: 'all',
  conditions: [],
  actions: [{ type: 'star' }],
  stopProcessing: false,
});
async function rule(value: RuleDraft) {
  return both<RuleRecord>('/api/rules', 'POST', value);
}
async function disableRules() {
  await env.DB.prepare('UPDATE rules SET enabled=0').run();
  database.sqlite.exec('UPDATE rules SET enabled=0');
}
async function notice(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (value: string) => boolean,
) {
  let text = '';
  const timeout = setTimeout(() => {
    void reader.cancel();
  }, 4000);
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) throw new Error('Expected SSE event was not delivered');
      text += new TextDecoder().decode(result.value);
      if (predicate(text)) return text;
    }
  } finally {
    clearTimeout(timeout);
  }
}

it('runs native source discovery, stable saved searches, mailbox setup and Brew source previews with Node parity', async () => {
  const beforeFeeds = (await env.DB.prepare('SELECT * FROM feeds ORDER BY id').all()).results;
  await both('/api/sources/discover', 'POST', { url: 'https://source.example.test/website' });
  await both('/api/sources/discover', 'POST', { url: 'feed://source.example.test/rss' });
  await both('/api/sources/searches', 'POST', {
    clientId: 'design',
    name: ' Saved design ',
    query: ' design ',
  });
  await both('/api/sources/searches', 'POST', {
    clientId: 'design',
    name: 'Updated design',
    query: '"Design item"',
  });
  expect(await both('/api/sources/searches')).toEqual([
    { id: 1, clientId: 'design', name: 'Updated design', query: '"Design item"' },
  ]);
  await both('/api/sources/mailbox');
  const sql =
    "INSERT INTO inbound_addresses(address,mechanism) VALUES('brew@letters.example.test','cloudflare-email')";
  database.sqlite.exec(sql);
  await env.DB.prepare(sql).run();
  expect(await both('/api/sources/mailbox')).toEqual({ address: 'brew@letters.example.test' });
  const value = {
    name: 'Source test',
    enabled: false,
    timezone: 'UTC',
    schedule: { kind: 'daily', time: '07:00' },
    delivery: defaultDelivery(),
    sections: [
      {
        ...newBrewSection('search'),
        sources: [{ kind: 'saved_search', id: 1 }],
        onlyUnread: false,
      },
    ],
  };
  const saved = await both<{ id: number }>('/api/brew-configs/composition', 'POST', value);
  await both(`/api/brew-configs/${saved.id}/preview`, 'POST', { at: new Date(now).toISOString() });
  expect((await env.DB.prepare('SELECT * FROM feeds ORDER BY id').all()).results).toEqual(
    beforeFeeds,
  );
  const before = await state();
  expect(
    (
      await request('/api/sources/searches', 'POST', {
        clientId: 'bad',
        name: ' ',
        query: 'design',
      })
    ).status,
  ).toBe(400);
  expect(
    (await request('/api/sources/discover', 'POST', { url: 'javascript:alert(1)' })).status,
  ).toBe(400);
  expect(await state()).toEqual(before);
});

it('preserves rule CRUD, position, scope and validation through the shared HTTP routes', async () => {
  const first = await rule({ ...draft(' First '), position: 4 });
  expect(first).toMatchObject({ name: 'First', position: 4 });
  const second = await rule(draft('Second'));
  expect(second.position).toBe(5);
  await both(`/api/rules/${first.id}`, 'PUT', {
    ...draft('Updated'),
    scope: { feedIds: [1], folderIds: [1] },
    stopProcessing: true,
  });
  await both('/api/rules');
  const before = await state();
  for (const value of [
    { ...draft(), name: ' ' },
    { ...draft(), actions: [] },
    { ...draft(), conditions: [{ field: 'title', operator: 'matches_regex', value: '[' }] },
  ]) {
    const actual = await request('/api/rules', 'POST', value);
    const expected = await node.inject({ url: '/api/rules', method: 'POST', payload: value });
    expect(actual.status).toBe(400);
    expect(await actual.json()).toEqual(expected.json());
  }
  expect(await state()).toEqual(before);
  expect((await request(`/api/rules/${second.id}`, 'DELETE')).status).toBe(204);
  expect((await node.inject({ url: `/api/rules/${second.id}`, method: 'DELETE' })).statusCode).toBe(
    204,
  );
  expect((await request(`/api/rules/${second.id}`, 'DELETE')).status).toBe(404);
});

it('previews all visible matches across context batches without writes or silent regex substitution', async () => {
  const input = {
    scope: {},
    matchType: 'all',
    conditions: [{ field: 'content', operator: 'contains', value: 'considered' }],
  };
  const before = await state();
  const value = await both<{ items: RulePreviewItem[]; total: number; limit: number }>(
    '/api/rules/preview?includeTotal=true',
    'POST',
    input,
  );
  expect(value.total).toBe(124);
  expect(value.items).toHaveLength(50);
  expect(value.items[0]!.id).toBe(2);
  await both('/api/rules/preview', 'POST', input);
  await both('/api/rules/preview?includeTotal=true', 'POST', {
    ...input,
    scope: { folderIds: [1] },
  });
  await both('/api/rules/preview?includeTotal=true', 'POST', {
    ...input,
    conditions: [{ field: 'title', operator: 'matches_regex', value: 'Design' }],
  });
  expect(await state()).toEqual(before);
});

it('awaits every rule action, publishes a live notification across invocations and persists retries and failed actions', async () => {
  const saved = await rule({
    ...draft(),
    conditions: [{ field: 'title', operator: 'equals', value: 'Design item 2' }],
    actions: [
      { type: 'add_tag', tag: 'Tools' },
      { type: 'remove_tag', tag: 'Old' },
      { type: 'star' },
      { type: 'mark_read' },
      { type: 'hide' },
      { type: 'highlight', color: '#f59e0b' },
      { type: 'feature_in_brew' },
      { type: 'exclude_from_brew' },
      { type: 'notify' },
      { type: 'webhook', url: 'https://hooks.example.test/retry' },
    ],
  });
  const stream = await request('/api/events');
  const reader = stream.body!.getReader();
  try {
    await notice(reader, (text) => text.includes('event: reader:sync'));
    expect(await both(`/api/rules/${saved.id}/apply`, 'POST', { days: 30 })).toEqual({
      matched: 1,
    });
    const event = await notice(reader, (text) => text.includes('event: notification'));
    expect(event).toContain('Design item 2');
    await both('/api/articles/2');
    const row = await env.DB.prepare(
      'SELECT hidden,featured_in_brew AS featured,excluded_from_brew AS excluded FROM articles WHERE id=2',
    ).first();
    expect(row).toEqual({ hidden: 1, featured: 0, excluded: 1 });
    const logs = await json<Array<{ actions: Array<{ ok: boolean }> }>>(
      `/api/rules/${saved.id}/logs`,
    );
    expect(logs[0]!.actions).toHaveLength(10);
    expect(logs[0]!.actions.every((action) => action.ok)).toBe(true);
    const calls = (await (
      await env.UPSTREAM.fetch('https://hooks.example.test/stats')
    ).json()) as Array<{ path: string }>;
    expect(calls.filter((call) => call.path === '/retry')).toHaveLength(2);
  } finally {
    await reader.cancel();
  }
  const failing = await rule({
    ...draft('Failed tag'),
    conditions: [{ field: 'title', operator: 'equals', value: 'Design item 3' }],
    actions: [{ type: 'add_tag', tag: 'Rollback tag' }, { type: 'star' }],
  });
  await env.DB.prepare(
    "CREATE TRIGGER reject_rule_tag BEFORE INSERT ON article_tags WHEN NEW.article_id=3 BEGIN SELECT RAISE(ABORT,'test tag failure'); END",
  ).run();
  try {
    expect(await json(`/api/rules/${failing.id}/apply`, 'POST', {})).toEqual({ matched: 1 });
    expect(
      await env.DB.prepare("SELECT id FROM tags WHERE name='Rollback tag'").first(),
    ).toBeNull();
    expect(await json(`/api/rules/${failing.id}/logs`)).toMatchObject([
      {
        actions: [
          { type: 'add_tag', ok: false },
          { type: 'star', ok: true },
        ],
      },
    ]);
  } finally {
    await env.DB.prepare('DROP TRIGGER reject_rule_tag').run();
  }
  // Keep the remaining comparison fixture aligned after this intentional D1-only failure.
  await node.inject({ url: `/api/rules/${failing.id}/apply`, method: 'POST', payload: {} });
});

it('pages the complete retained execution history and preserves exact hit counts without read-side writes', async () => {
  const saved = await rule(draft('History'));
  const sql = Array.from(
    { length: 151 },
    (_, index) =>
      `INSERT INTO rule_logs(rule_id,article_id,executed_at,actions_taken_json) VALUES(${saved.id},${(index % 125) + 1},${now - index * 60000},'[{"type":"star","ok":true}]')`,
  );
  database.sqlite.exec(sql.join(';'));
  await env.DB.batch(sql.map((query) => env.DB.prepare(query)));
  const before = await state();
  const seen: number[] = [];
  for (let page = 1; page <= 4; page++) {
    const value = await both<RuleLogPage>(`/api/rules/${saved.id}/executions?page=${page}`);
    expect(value.total).toBe(151);
    seen.push(...value.items.map((item) => item.id));
  }
  expect(new Set(seen).size).toBe(151);
  expect(await json(`/api/rules/${saved.id}/logs`)).toHaveLength(100);
  expect(
    (await json<RuleRecord[]>('/api/rules')).find((item) => item.id === saved.id),
  ).toMatchObject({ hits24h: 151, hits30d: 151 });
  expect((await request(`/api/rules/${saved.id}/executions?page=0`)).status).toBe(400);
  expect((await request('/api/rules/99999/executions')).status).toBe(404);
  expect(await state()).toEqual(before);
});

it('bounds the notification journal and delivers only future notices to a reconnecting subscriber', async () => {
  await env.DB.batch(
    Array.from({ length: 300 }, () =>
      env.DB.prepare('INSERT INTO instance_events(type,data_json) VALUES(?,?)').bind(
        'notification',
        JSON.stringify({ id: 999, title: 'Old notification', url: 'https://old.example.test' }),
      ),
    ),
  );
  const saved = await rule({
    ...draft('New notice'),
    conditions: [{ field: 'title', operator: 'equals', value: 'Design item 4' }],
    actions: [{ type: 'notify' }],
  });
  const reader = (await request('/api/events')).body!.getReader();
  try {
    await notice(reader, (text) => text.includes('event: reader:sync'));
    await both(`/api/rules/${saved.id}/apply`, 'POST', {});
    const event = await notice(reader, (text) => text.includes('event: notification'));
    expect(event).toContain('Design item 4');
    expect(event).not.toContain('Old notification');
    expect(await env.DB.prepare('SELECT count(*) AS n FROM instance_events').first('n')).toBe(256);
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM instance_events WHERE article_id=4').first(
        'n',
      ),
    ).toBe(1);
    await env.DB.prepare('DELETE FROM articles WHERE id=4').run();
    database.sqlite.exec('DELETE FROM articles WHERE id=4');
    expect(
      await env.DB.prepare('SELECT id FROM instance_events WHERE article_id=4').first(),
    ).toBeNull();
  } finally {
    await reader.cancel();
  }
});

it('uses actual Worker Web Crypto and shared ingest to sanitize, deduplicate and run enabled rules in order', async () => {
  await disableRules();
  const first = await rule({
    ...draft('Imported first'),
    conditions: [{ field: 'title', operator: 'matches_regex', value: '^Imported(?= )' }],
    stopProcessing: true,
  });
  await rule({ ...draft('Imported lower'), conditions: [], actions: [{ type: 'hide' }] });
  const item = {
    guid: 'worker-import',
    url: 'https://source.example.test/imported?utm_source=mail',
    title: 'Imported story',
    author: null,
    summaryHtml: '<p>Summary</p>',
    contentHtml: '<p>Safe story</p><script>unsafe()</script>',
    publishedAt: new Date(now).toISOString(),
  };
  const input = { feed: { id: 1, retentionDays: 90 }, items: [item] };
  const pipeline = new IngestPipeline(new NodeIngestStorage(database), nodeHash, clock, nodeRules);
  for (const inserted of [1, 0]) {
    expect(await json('/__review/ingest', 'POST', input)).toEqual({ inserted });
    expect(await pipeline.ingest(input.feed, [{ ...item, publishedAt: new Date(now) }])).toBe(
      inserted,
    );
  }
  const actual = await env.DB.prepare('SELECT * FROM articles WHERE guid=?')
    .bind(item.guid)
    .first<Record<string, unknown>>();
  const expected = database.sqlite
    .prepare('SELECT * FROM articles WHERE guid=?')
    .get(item.guid) as Record<string, unknown>;
  expect({ ...actual, fetched_at: 0 }).toEqual({ ...expected, fetched_at: 0 });
  expect(actual).toMatchObject({ hidden: 0, starred_at: now, content_html: '<p>Safe story</p>' });
  expect(
    await env.DB.prepare('SELECT rule_id FROM rule_logs WHERE article_id=?').bind(actual!.id).all(),
  ).toMatchObject({ results: [{ rule_id: first.id }] });
});

it('executes real MIME ingestion from workerd email streams, stable identities and duplicate-safe rule execution', async () => {
  const raw =
    'From: Publisher <publisher@example.test>\r\nTo: brew@letters.example.test\r\nSubject: Imported letter\r\nMessage-ID: <worker-letter@example.test>\r\nDate: Fri, 27 Nov 2026 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>A careful letter.</p><img src="https://track.example.test/pixel" width="1" height="1"><script>unsafe()</script>';
  const pipeline = new NewsletterPipeline(
    new NodeNewsletterStorage(database),
    nodeHash,
    clock,
    nodeRules,
  );
  for (const outcome of ['inserted', 'duplicate']) {
    await worker.email({ from: 'publisher@example.test', to: 'brew@letters.example.test', raw });
    expect((await pipeline.ingest(raw)).outcome).toBe(outcome);
  }
  const actual = await env.DB.prepare("SELECT * FROM articles WHERE title='Imported letter'").first<
    Record<string, unknown>
  >();
  const expected = database.sqlite
    .prepare("SELECT * FROM articles WHERE title='Imported letter'")
    .get() as Record<string, unknown>;
  expect({ ...actual, fetched_at: 0 }).toEqual({ ...expected, fetched_at: 0 });
  expect(actual).toMatchObject({ starred_at: now, content_html: '<p>A careful letter.</p>' });
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM rule_logs WHERE article_id=?')
      .bind(actual!.id)
      .first('n'),
  ).toBe(1);
  const fallback = raw
    .replace('Message-ID: <worker-letter@example.test>\r\n', '')
    .replace('Subject: Imported letter', 'Subject: Imported fallback');
  for (const outcome of ['inserted', 'duplicate']) {
    const response = await worker.fetch('https://brew.example.test/__review/newsletter', {
      method: 'POST',
      body: fallback,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome });
    expect((await pipeline.ingest(fallback)).outcome).toBe(outcome);
  }
  const fallbackActual = await env.DB.prepare(
    "SELECT hash,guid FROM articles WHERE title='Imported fallback'",
  ).first();
  expect(fallbackActual).toEqual(
    database.sqlite.prepare("SELECT hash,guid FROM articles WHERE title='Imported fallback'").get(),
  );
  let cancelled = false;
  await expect(
    readNewsletterStream(
      new ReadableStream({
        cancel: () => {
          cancelled = true;
        },
      }),
      MAX_NEWSLETTER_BYTES + 1,
    ),
  ).rejects.toThrow('10 MiB');
  expect(cancelled).toBe(true);
  cancelled = false;
  await expect(
    readNewsletterStream(
      new ReadableStream({
        start: (controller) => controller.enqueue(new Uint8Array(MAX_NEWSLETTER_BYTES + 1)),
        cancel: () => {
          cancelled = true;
        },
      }),
    ),
  ).rejects.toThrow('10 MiB');
  expect(cancelled).toBe(true);
});

it('records a rejected asynchronous notification as a failed action and still commits the following article change', async () => {
  const saved = await rule({
    ...draft('Rejected notification'),
    conditions: [{ field: 'title', operator: 'equals', value: 'Design item 6' }],
    actions: [{ type: 'notify' }, { type: 'star' }],
  });
  const before = await env.DB.prepare('SELECT count(*) AS n FROM instance_events').first('n');
  await env.DB.prepare(
    "CREATE TRIGGER reject_notification BEFORE INSERT ON instance_events BEGIN SELECT RAISE(ABORT,'test notification failure'); END",
  ).run();
  try {
    expect(await json(`/api/rules/${saved.id}/apply`, 'POST', {})).toEqual({ matched: 1 });
    expect(await json(`/api/rules/${saved.id}/logs`)).toMatchObject([
      {
        actions: [
          { type: 'notify', ok: false },
          { type: 'star', ok: true },
        ],
      },
    ]);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM instance_events').first('n')).toBe(
      before,
    );
    expect(
      await env.DB.prepare('SELECT starred_at FROM articles WHERE id=6').first('starred_at'),
    ).toBe(now);
  } finally {
    await env.DB.prepare('DROP TRIGGER reject_notification').run();
  }
});
