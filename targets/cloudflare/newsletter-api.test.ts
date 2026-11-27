import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';
import { fileURLToPath } from 'node:url';
import type { ReaderTestEnv } from './test/reader-worker.js';
import type {
  NewsletterOverview,
  NewsletterLetterPage,
  SenderSettingsPreview,
  NewsletterSender,
} from '../../packages/core/src/types/newsletters.js';
import { defaultNewsletterSettings } from '../../packages/core/src/types/newsletters.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';
import { openDatabase } from '../node/src/db/database.js';
import { createApp } from '../node/src/app.js';
import { libraryUpstream } from './test/library-upstream.js';
import { NewsletterLibrary } from '../node/src/services/newsletter-library.js';
import { NewsletterPipeline } from '../../packages/core/src/newsletter-pipeline.js';
import { NodeNewsletterStorage } from '../node/src/ports/newsletter-storage.js';
import { nodeHash } from '../node/src/ports/runtime.js';
import { CloudflareStorage } from './src/storage.js';
import { CloudflareNewsletterLibrary } from './src/newsletter-library.js';
import { CloudflareArticles } from './src/article-service.js';

const now = Date.parse('2026-11-27T12:00:00Z');
const clock = { now: () => new Date(now), monotonic: () => performance.now() };
const server = createTestHarness({
  workers: [
    {
      config: {
        name: 'brew-newsletter-api-test',
        main: fileURLToPath(new URL('./test/library-worker.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        compatibility_flags: ['nodejs_compat'],
        rules: [{ type: 'CompiledWasm', globs: ['**/*.wasm', '**/wasm'], fallthrough: true }],
        workers_dev: false,
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'newsletter-api-test',
            database_id: '00000000-0000-0000-0000-000000000001',
            migrations_dir: fileURLToPath(
              new URL('../../packages/db/migrations/', import.meta.url),
            ),
          },
        ],
        r2_buckets: [{ binding: 'IMAGES', bucket_name: 'newsletter-api-images' }],
        services: [{ binding: 'UPSTREAM', service: 'brew-newsletter-upstream-test' }],
      },
    },
    {
      config: {
        name: 'brew-newsletter-upstream-test',
        main: fileURLToPath(new URL('./test/library-upstream.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        workers_dev: false,
      },
    },
  ],
});
const worker = server.getWorker<ReaderTestEnv>('brew-newsletter-api-test');
let env: ReaderTestEnv;
const database = openDatabase(':memory:');
let node: Awaited<ReturnType<typeof createApp>>;
const nodeLibrary = new NewsletterLibrary(database, clock);
beforeAll(async () => {
  await server.listen();
  await worker.applyD1Migrations('DB');
  env = await worker.getEnv();
  node = await createApp({
    database,
    logger: false,
    clock,
    publicUrl: 'https://brew.example.test',
    fetcher: async (input, init) => libraryUpstream(new Request(input, init)),
  });
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  for (let id = 1; id <= 6; id++) {
    const settings = {
      ...defaultNewsletterSettings(),
      favorite: id === 2,
      skipInbox: id === 3,
      blocked: id === 4,
      ...(id === 5 ? { onlyInBrew: true, brewId: 1 } : {}),
    };
    statements.push({
      sql: "INSERT INTO feeds(id,title,url,kind,settings_json,retention_days) VALUES(?,?,?,'newsletter',?,90)",
      values: [
        id,
        id === 1 ? 'Sender 1 Ω' : `Sender ${id}`,
        `mailto:sender${id}@example.test`,
        JSON.stringify(settings),
      ],
    });
  }
  statements.push({
    sql: "INSERT INTO feeds(id,title,url) VALUES(7,'RSS','https://source.example.test/rss')",
    values: [],
  });
  for (let id = 1; id <= 3; id++) {
    const sections =
      id === 1 ? [{ ...newBrewSection('manual'), sources: [{ kind: 'feed', id: 5 }] }] : [];
    statements.push({
      sql: 'INSERT INTO brew_configs(id,name,enabled,sections_json,timezone,schedule_json,delivery_json,composition_version,created_at) VALUES(?,?,0,?,?,?,?,2,?)',
      values: [
        id,
        `Brew ${id}`,
        JSON.stringify(sections),
        'UTC',
        JSON.stringify({ kind: 'daily', time: '07:00' }),
        JSON.stringify(defaultDelivery()),
        now,
      ],
    });
  }
  statements.push({
    sql: "INSERT INTO tags(id,name,color) VALUES(1,'Keep','#000000')",
    values: [],
  });
  for (let id = 1; id <= 133; id++) {
    const feed = id <= 105 ? 1 : id <= 130 ? 2 + ((id - 106) % 5) : 1;
    statements.push({
      sql: 'INSERT INTO articles(id,feed_id,guid,hash,url,title,author,summary_html,content_html,raw_html,cleaning_json,published_at,read_at,starred_at,hidden) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      values: [
        id,
        feed,
        `g-${id}`,
        `h-${id}`,
        `https://letters.example.test/${id}`,
        `Letter ${id}`,
        'Publisher',
        null,
        `<p>A &amp; B ${id}.</p><script>unsafe()</script>`,
        `<p>Original ${id}</p><script>unsafe()</script>`,
        null,
        id >= 131 ? now - 40 * 86400000 : now - id * 60000,
        id % 4 === 0 ? now : null,
        id === 131 ? now : null,
        id === 1 ? 1 : 0,
      ],
    });
  }
  statements.push({
    sql: "INSERT INTO articles(id,feed_id,guid,hash,url,title,published_at) VALUES(134,7,'rss','rss','https://source.example.test/story','RSS',?)",
    values: [now],
  });
  statements.push({ sql: 'INSERT INTO article_tags(article_id,tag_id) VALUES(132,1)', values: [] });
  database.sqlite.transaction(() => {
    for (const item of statements) database.sqlite.prepare(item.sql).run(...item.values);
  })();
  await env.DB.batch(statements.map((item) => env.DB.prepare(item.sql).bind(...item.values)));
}, 30000);
afterAll(async () => {
  await node?.close();
  await server.close();
});
async function request(path: string, method = 'GET', body?: unknown) {
  return worker.fetch(`https://brew.example.test${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}
async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await request(path, method, body),
    value = await response.json();
  expect(response.status, JSON.stringify(value)).toBeGreaterThanOrEqual(200);
  expect(response.status, JSON.stringify(value)).toBeLessThan(300);
  return value as T;
}
async function both<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const actual = await json<T>(path, method, body);
  const expected = await node.inject({
    url: path,
    method: method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }),
  });
  expect(actual).toEqual(expected.json());
  return actual;
}
async function state() {
  return (
    await env.DB.batch(
      ['feeds', 'articles', 'article_tags', 'brew_configs', 'brews', 'settings'].map((table) =>
        env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`),
      ),
    )
  ).map((result) => result.results);
}
async function patch(id: number, value: unknown) {
  return both<NewsletterSender>(`/api/newsletters/senders/${id}`, 'PATCH', value);
}

it('serves Node-identical sender counts, filtered views and complete numbered letter pages without writes', async () => {
  const before = await state();
  const overview = await both<NewsletterOverview>('/api/newsletters/overview');
  expect(overview.senders).toHaveLength(6);
  expect(overview.senders.find((sender) => sender.id === 1)!.letterCount).toBe(107);
  for (const view of ['inbox', 'favorites', 'skipped', 'blocked'])
    for (const page of [1, 2, 3]) await both(`/api/newsletters/letters?view=${view}&page=${page}`);
  const seen: number[] = [];
  for (const page of [1, 2, 3]) {
    const value = await both<NewsletterLetterPage>(
      `/api/newsletters/letters?sender=1&page=${page}`,
    );
    expect(value.total).toBe(107);
    seen.push(...value.items.map((item) => item.id));
  }
  expect(new Set(seen).size).toBe(107);
  for (const path of [
    '/api/newsletters/letters?page=0',
    '/api/newsletters/letters?view=other',
    '/api/newsletters/letters?sender=0',
  ])
    expect((await request(path)).status).toBe(400);
  expect(await state()).toEqual(before);
});

it('sanitizes cleaned letters and isolates originals while private page twins leave reads and drafts unchanged', async () => {
  const before = await state();
  const letter = await both<{ contentHtml: string; readAt: string | null }>(
    '/api/newsletters/letters/2',
  );
  expect(letter.contentHtml).not.toContain('<script>');
  expect(letter.readAt).toBeNull();
  for (const path of [
    '/api/newsletters/letters/134',
    '/api/newsletters/letters/nope',
    '/api/newsletters/letters/nope/original',
  ])
    expect((await request(path)).status).toBe(404);
  const original = await request('/api/newsletters/letters/2/original');
  expect(original.headers.get('content-security-policy')).toContain('sandbox');
  expect(original.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  expect(await original.text()).toBe(
    (await node.inject('/api/newsletters/letters/2/original')).body,
  );
  for (const path of [
    '/letters.json',
    '/letters/1.json?page=3',
    '/letters/1/2.md',
    '/feeds.json',
    '/rules.json',
    '/b/1/compose.md',
    '/reader.json',
    '/index.json',
  ]) {
    const response = await request(path);
    expect(response.status, path).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text(), path).toBe(
      (await node.inject({ url: path, headers: { host: 'brew.example.test' } })).body,
    );
  }
  expect(await state()).toEqual(before);
});

it('reviews the exact same canonical sender revision and retention effects as Node without mutating data', async () => {
  const before = await state();
  for (const input of [
    { favorite: true },
    { retentionDays: 7 },
    { brewId: 2, onlyInBrew: true },
    { cleaning: { sponsorSelectors: ['.sponsor'] } },
  ]) {
    const value = await both<SenderSettingsPreview>(
      '/api/newsletters/senders/1/preview',
      'POST',
      input,
    );
    expect(value.revision).toMatch(/^[a-f0-9]{64}$/);
    if ('retentionDays' in input)
      expect(value).toMatchObject({
        lettersRemoved: 1,
        originalsRemoved: 3,
        requiresConfirmation: true,
      });
  }
  for (const input of [
    {},
    { unsupported: true },
    { retentionDays: 0 },
    { onlyInBrew: true },
    { brewId: 9999 },
  ])
    expect((await request('/api/newsletters/senders/1/preview', 'POST', input)).status).toBe(400);
  expect(
    (await request('/api/newsletters/senders/9999/preview', 'POST', { favorite: true })).status,
  ).toBe(404);
  expect(await state()).toEqual(before);
  await patch(1, { retentionDays: 7 });
  expect(await env.DB.prepare('SELECT id FROM articles WHERE id=133').first()).toBeNull();
  expect(
    (
      await env.DB.prepare(
        'SELECT id,raw_html FROM articles WHERE id IN (131,132) ORDER BY id',
      ).all()
    ).results,
  ).toEqual([
    { id: 131, raw_html: null },
    { id: 132, raw_html: null },
  ]);
  expect((await request('/api/newsletters/letters/131/original')).status).toBe(404);
});

it('routes sender preferences into real Brews while preserving manual selections and rejecting missing destinations atomically', async () => {
  await patch(1, { brewId: 2, onlyInBrew: true, favorite: true });
  const config = await both<{
    sections: Array<{ id: string; sources: Array<{ kind: string; id?: number }> }>;
  }>('/api/brew-configs/2/composition');
  expect(
    config.sections.find((section) => section.id === 'brew:newsletter-senders')!.sources,
  ).toContainEqual({ kind: 'feed', id: 1 });
  await patch(5, { brewId: 2 });
  const previous = await both<{ sections: Array<{ sources: unknown[] }> }>(
    '/api/brew-configs/1/composition',
  );
  expect(previous.sections[0]!.sources).toContainEqual({ kind: 'feed', id: 5 });
  const before = await state();
  expect(
    (
      await request('/api/newsletters/senders/1', 'PATCH', {
        brewId: 9999,
        retentionDays: 1,
        favorite: false,
      })
    ).status,
  ).toBe(400);
  expect(await state()).toEqual(before);
  await both('/api/brew-configs/2/preview', 'POST', { at: new Date(now).toISOString() });
  await both('/api/newsletters/overview');
});

it('merges concurrent independent sender edits and concurrent routing into the same Brew', async () => {
  const requests: [number, Record<string, unknown>][] = [
    [1, { skipInbox: true }],
    [1, { cleaning: { footerSelectors: ['.footer'] } }],
  ];
  await Promise.all(
    requests.map(([id, value]) => json(`/api/newsletters/senders/${id}`, 'PATCH', value)),
  );
  for (const [id, value] of requests) nodeLibrary.updateSender(id, value);
  await Promise.all([
    json('/api/newsletters/senders/5', 'PATCH', { brewId: 3 }),
    json('/api/newsletters/senders/6', 'PATCH', { brewId: 3 }),
  ]);
  const config = await json<{ sections: Array<{ sources: Array<{ kind: string; id: number }> }> }>(
    '/api/brew-configs/3/composition',
  );
  expect(config.sections[0]!.sources).toEqual(
    expect.arrayContaining([
      { kind: 'feed', id: 5 },
      { kind: 'feed', id: 6 },
    ]),
  );
  expect(config.sections[0]!.sources).toHaveLength(2);
  // Either concurrent request can commit first. Compare with Node's equivalent
  // serial history rather than imposing a different order on those requests.
  for (const source of config.sections[0]!.sources)
    nodeLibrary.updateSender(source.id, { brewId: 3 });
  await both('/api/newsletters/overview');
  await both('/api/brew-configs/3/composition');
  expect(
    (await env.DB.prepare("SELECT key FROM settings WHERE key GLOB 'newsletter_update:*'").all())
      .results,
  ).toEqual([]);
});

it('rolls back routing, preferences, original pruning and deletion when any write in the D1 batch fails', async () => {
  const sql =
    "INSERT INTO articles(id,feed_id,guid,hash,url,title,content_html,raw_html,published_at) VALUES(200,1,'late','late','https://letters.example.test/late','Late letter','<p>Clean</p>','<p>Original</p>',?)";
  database.sqlite.prepare(sql).run(now - 20 * 86400000);
  await env.DB.prepare(sql)
    .bind(now - 20 * 86400000)
    .run();
  const before = await state();
  await env.DB.prepare(
    "CREATE TRIGGER reject_retention BEFORE DELETE ON articles WHEN OLD.id=200 BEGIN SELECT RAISE(ABORT,'test retention failure'); END",
  ).run();
  try {
    expect(
      (
        await request('/api/newsletters/senders/1', 'PATCH', {
          brewId: 1,
          retentionDays: 1,
          favorite: false,
        })
      ).status,
    ).toBe(400);
    expect(await state()).toEqual(before);
  } finally {
    await env.DB.prepare('DROP TRIGGER reject_retention').run();
  }
  await patch(1, { brewId: 1, retentionDays: 1, favorite: false });
  expect(await env.DB.prepare('SELECT id FROM articles WHERE id=200').first()).toBeNull();
});

it('retries a stale retention plan and protects an article starred by a concurrent invocation', async () => {
  const sql =
    "INSERT INTO articles(id,feed_id,guid,hash,url,title,content_html,raw_html,published_at) VALUES(201,2,'race-retain','race-retain','https://letters.example.test/race','Race letter','<p>Clean</p>','<p>Original</p>',?)";
  database.sqlite.prepare(sql).run(now - 40 * 86400000);
  await env.DB.prepare(sql)
    .bind(now - 40 * 86400000)
    .run();
  class RacingStorage extends CloudflareStorage {
    snapshots = 0;
    override async batch<T = Record<string, unknown>>(
      statements: Parameters<CloudflareStorage['batch']>[0],
    ) {
      const result = await super.batch<T>(statements);
      if (this.snapshots++ === 0)
        await env.DB.prepare('UPDATE articles SET starred_at=? WHERE id=201').bind(now).run();
      return result;
    }
  }
  const storage = new RacingStorage(env.DB);
  const library = new CloudflareNewsletterLibrary(
    storage,
    new CloudflareArticles(storage, fetch, () => new Date(now)),
    () => new Date(now),
  );
  expect(await library.updateSender(2, { retentionDays: 7 })).toMatchObject({
    settings: { retentionDays: 7 },
  });
  expect(storage.snapshots).toBeGreaterThan(2);
  expect(
    await env.DB.prepare('SELECT starred_at,raw_html FROM articles WHERE id=201').first(),
  ).toEqual({ starred_at: now, raw_html: null });
  database.sqlite.prepare('UPDATE articles SET starred_at=? WHERE id=201').run(now);
  nodeLibrary.updateSender(2, { retentionDays: 7 });
  await both('/api/newsletters/overview');
});

it('makes a native email visible through the newsletter API and private twins without duplicate delivery or read mutation', async () => {
  const raw =
    'From: Publisher <sender2@example.test>\r\nTo: brew@letters.example.test\r\nSubject: Native inbox proof\r\nMessage-ID: <newsletter-api-proof@example.test>\r\nDate: Fri, 27 Nov 2026 12:00:00 +0000\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Native reader proof.</p><img src="https://tracker.example.test/pixel" width="1" height="1"><script>unsafe()</script>';
  const pipeline = new NewsletterPipeline(new NodeNewsletterStorage(database), nodeHash, clock);
  for (const outcome of ['inserted', 'duplicate']) {
    await worker.email({ from: 'sender2@example.test', to: 'brew@letters.example.test', raw });
    expect((await pipeline.ingest(raw)).outcome).toBe(outcome);
  }
  const row = await env.DB.prepare(
    "SELECT id FROM articles WHERE title='Native inbox proof'",
  ).first<{ id: number }>();
  const before = await state();
  const letter = await both<{ contentHtml: string; readAt: string | null }>(
    `/api/newsletters/letters/${row!.id}`,
  );
  expect(letter.contentHtml).toBe('<p>Native reader proof.</p>');
  expect(letter.readAt).toBeNull();
  await both('/api/newsletters/overview');
  const page = await both<NewsletterLetterPage>('/api/newsletters/letters?view=favorites&sender=2');
  expect(page.items[0]!.id).toBe(row!.id);
  const twin = await request(`/letters/2/${row!.id}.json`);
  expect(twin.status).toBe(200);
  expect(await twin.text()).not.toContain('rawHtml');
  expect(await state()).toEqual(before);
});

it('rechecks blocking at the atomic insert so mail already in flight cannot store content after the sender is blocked', async () => {
  const raw =
    'From: Publisher <sender6@example.test>\r\nSubject: Blocked in flight\r\nMessage-ID: <block-race@example.test>\r\nContent-Type: text/html\r\n\r\n<p>Do not store.</p>';
  const response = await worker.fetch('https://brew.example.test/__review/newsletter-block-race', {
    method: 'POST',
    headers: { 'x-review-sender': '6' },
    body: raw,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ feedId: 6, articleId: null, outcome: 'blocked' });
  const pipeline = new NewsletterPipeline(
    new NodeNewsletterStorage(database),
    {
      sha1: async (value) => {
        nodeLibrary.updateSender(6, { blocked: true });
        return nodeHash.sha1(value);
      },
    },
    clock,
  );
  expect(await pipeline.ingest(raw)).toEqual({ feedId: 6, articleId: null, outcome: 'blocked' });
  expect(
    await env.DB.prepare("SELECT id FROM articles WHERE title='Blocked in flight'").first(),
  ).toBeNull();
  await both('/api/newsletters/overview');
});
