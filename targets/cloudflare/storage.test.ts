import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { CloudflareStorage } from './src/storage.js';
import { upgradeLegacyCompositions } from './src/legacy-composition.js';
import { CloudflareIngestStorage } from './src/ingest-storage.js';
import { CloudflareNewsletterStorage } from './src/newsletter-storage.js';
import { R2ImageCache } from './src/image-cache.js';
import { NewsletterPipeline } from '../../packages/core/src/newsletter-pipeline.js';
import { IngestPipeline } from '../../packages/core/src/ingest-pipeline.js';
import { proxyImage, MAX_IMAGE_BYTES } from '../../packages/api/src/image-proxy.js';
import { openDatabase } from '../node/src/db/database.js';
import { CloudflareQueryBudget } from './src/query-budget.js';

const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("storage fixture"); } };',
  compatibilityDate: '2026-07-01',
  d1Databases: ['DB'],
  r2Buckets: ['IMAGES'],
});
let storage: CloudflareStorage;
let bucket: R2Bucket;
const now = Date.parse('2026-11-27T12:00:00Z');
const clock = { now: () => new Date(now), monotonic: () => 0 };
const hash = { sha1: (value: string) => createHash('sha1').update(value).digest('hex') };

beforeAll(async () => {
  const database = await runtime.getD1Database('DB');
  const directory = new URL('../../packages/db/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    await database.batch(unstable_splitSqlQuery(sql).map((query) => database.prepare(query)));
    if (name === '0001_initial.sql') {
      await database
        .prepare(
          "INSERT INTO brew_configs(name,schedule_cron,sections_json) VALUES('Empty legacy','0 9 * * *','[]')",
        )
        .run();
      await database
        .prepare(
          "INSERT INTO brew_configs(name,schedule_cron,sections_json) VALUES('Legacy weekdays','0 8 * * 1-5',?)",
        )
        .bind(
          JSON.stringify([
            {
              id: 'weekly',
              title: 'Weekly review',
              source: 'weekly_review',
              maxItems: 12,
              layout: 'list',
              sort: 'newest',
              onlyUnread: false,
            },
          ]),
        )
        .run();
    }
  }
  storage = new CloudflareStorage(database as unknown as D1Database);
  await upgradeLegacyCompositions(storage, 'Asia/Dhaka');
  bucket = (await runtime.getR2Bucket('IMAGES')) as unknown as R2Bucket;
}, 30_000);
afterAll(async () => runtime.dispose());

it('shares actual D1 call accounting across adapters, counts a failed atomic batch once and releases phase reservations', async () => {
  const budget = new CloudflareQueryBudget(6);
  const phase = budget.share(4);
  const first = new CloudflareStorage(storage.database, phase);
  const second = new CloudflareStorage(storage.database, budget);
  const release = phase.reserve(3)!;
  expect(budget.reserve(4)).toBeNull();
  await first.batch([first.statement('SELECT 1'), first.statement('SELECT 2')]);
  await expect(
    first.batch([
      first.statement("INSERT INTO tags(name,color) VALUES('query rollback','#000000')"),
      first.statement("INSERT INTO tags(name,color) VALUES('query rollback','#000000')"),
    ]),
  ).rejects.toThrow();
  release();
  release();
  expect(phase.used).toBe(2);
  expect(budget.used).toBe(2);
  expect(await second.first("SELECT id FROM tags WHERE name='query rollback'")).toBeNull();
  await first.batch([]);
  expect(budget.used).toBe(3);
  expect(phase.reserve(3)).toBeNull();
  const next = budget.reserve(3);
  expect(next).not.toBeNull();
  next!();
});

it('upgrades an actual v1 row on D1 without losing schedule, section identity, legacy payload or delivery defaults', async () => {
  const row = await storage.first<{
    schedule_cron: string;
    timezone: string;
    schedule_json: string;
    sections_json: string;
    legacy_sections_json: string;
    delivery_json: string;
  }>(
    "SELECT schedule_cron,timezone,schedule_json,sections_json,legacy_sections_json,delivery_json FROM brew_configs WHERE name='Legacy weekdays'",
  );
  expect(row?.schedule_cron).toBe('0 8 * * 1-5');
  expect(row?.timezone).toBe('Asia/Dhaka');
  expect(JSON.parse(row!.schedule_json)).toMatchObject({ kind: 'weekdays', time: '08:00' });
  expect(JSON.parse(row!.sections_json)).toMatchObject([
    {
      id: 'weekly',
      kind: 'items',
      sources: [{ kind: 'weekly_review' }],
      maxItems: 12,
      layout: 'headlines',
      depth: 'title',
      images: false,
      onlyUnread: false,
    },
  ]);
  expect(JSON.parse(row!.legacy_sections_json)[0].source).toBe('weekly_review');
  expect(JSON.parse(row!.delivery_json)).toEqual({ web: true, feed: false, publicCopy: false });
  await upgradeLegacyCompositions(storage, 'UTC');
  expect(
    await storage.first('SELECT timezone FROM brew_configs WHERE name=?', ['Legacy weekdays']),
  ).toEqual({ timezone: 'Asia/Dhaka' });
  expect(
    await storage.first(
      "SELECT timezone,schedule_json FROM brew_configs WHERE name='Empty legacy'",
    ),
  ).toEqual({
    timezone: 'Asia/Dhaka',
    schedule_json: JSON.stringify({ kind: 'daily', time: '09:00' }),
  });
});

it('runs the canonical migrations in real D1 with the same tables, indexes, triggers and FTS behavior as Node', async () => {
  const node = openDatabase(':memory:');
  try {
    const query =
      "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ('__brew_migrations','d1_migrations') ORDER BY type,name";
    expect(await storage.all(query)).toEqual(node.sqlite.prepare(query).all());
    await storage.run(
      "INSERT INTO feeds(url,title) VALUES('https://feeds.example.test/one','D1 feed')",
    );
    await storage.run(
      "INSERT INTO articles(feed_id,guid,hash,url,title,content_html,published_at) VALUES(1,'fts','fts','https://example.test/fts','Canonical migration','<p>quartz</p>',?)",
      [now],
    );
    expect(
      await storage.all("SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'quartz'"),
    ).toEqual([{ rowid: 1 }]);
    await storage.run("UPDATE articles SET content_html='<p>cedar</p>' WHERE id=1");
    expect(
      await storage.all("SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'quartz'"),
    ).toEqual([]);
    expect(
      await storage.all("SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'cedar'"),
    ).toEqual([{ rowid: 1 }]);
    await storage.run('DELETE FROM articles WHERE id=1');
    expect(
      await storage.all("SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'cedar'"),
    ).toEqual([]);
    await expect(
      storage.batch([
        storage.statement("INSERT INTO tags(name,color) VALUES('rolled back','#000000')"),
        storage.statement("INSERT INTO tags(name,color) VALUES('rolled back','#000000')"),
      ]),
    ).rejects.toThrow();
    expect(await storage.first("SELECT id FROM tags WHERE name='rolled back'")).toBeNull();
  } finally {
    node.close();
  }
});

it('awaits D1 ingest, atomically deduplicates concurrent deliveries, and preserves starred/tagged retention exceptions', async () => {
  const pipeline = new IngestPipeline(new CloudflareIngestStorage(storage), hash, clock);
  const item = {
    guid: 'one',
    url: 'https://example.test/one',
    title: 'First story',
    author: null,
    summaryHtml: null,
    contentHtml: '<p>Safe.</p><script>bad()</script>',
    publishedAt: new Date(now),
  };
  const results = await Promise.all([
    pipeline.ingest({ id: 1, retentionDays: 90 }, [item]),
    pipeline.ingest({ id: 1, retentionDays: 90 }, [item]),
  ]);
  expect(results.sort()).toEqual([0, 1]);
  const article = await storage.first<{ id: number; content_html: string }>(
    "SELECT id,content_html FROM articles WHERE guid='one'",
  );
  expect(article?.content_html).toBe('<p>Safe.</p>');
  await storage.run('UPDATE articles SET published_at=?,starred_at=?,raw_html=? WHERE id=?', [
    now - 100 * 86_400_000,
    now,
    'original',
    article!.id,
  ]);
  await new CloudflareIngestStorage(storage).prune(1, now - 90 * 86_400_000);
  expect(
    await storage.first('SELECT raw_html,starred_at FROM articles WHERE id=?', [article!.id]),
  ).toEqual({ raw_html: null, starred_at: now });
});

it('awaits the saved duplicate policy and hide before evaluating rules, and rolls back failed batches', async () => {
  const adapter = new CloudflareIngestStorage(storage);
  const item = {
    guid: 'similar-1',
    url: 'https://example.test/similar-1',
    title: 'Clearwater conservation report',
    author: null,
    summaryHtml: null,
    contentHtml: '<p>Clearwater.</p>',
    publishedAt: new Date(now),
  };
  const pipeline = new IngestPipeline(adapter, hash, clock);
  await pipeline.ingest({ id: 1, retentionDays: 90 }, [
    item,
    { ...item, guid: 'similar-2', url: 'https://example.test/similar-2' },
  ]);
  expect(await storage.all("SELECT hidden FROM articles WHERE guid LIKE 'similar-%'")).toEqual([
    { hidden: 0 },
    { hidden: 0 },
  ]);
  await storage.run("INSERT INTO settings(key,value) VALUES('duplicate_filter_enabled','true')");
  let evaluations = 0;
  const ruled = new IngestPipeline(adapter, hash, clock, {
    evaluateArticle: async (id) => {
      expect(await storage.first('SELECT hidden FROM articles WHERE id=?', [id])).toEqual({
        hidden: 1,
      });
      evaluations++;
      return 0;
    },
  });
  await ruled.ingest({ id: 1, retentionDays: 90 }, [
    { ...item, guid: 'similar-3', url: 'https://example.test/similar-3' },
  ]);
  expect(evaluations).toBe(1);
  await storage.run("DELETE FROM settings WHERE key='duplicate_filter_enabled'");
  const prepared = {
    feedId: 1,
    guid: 'rollback-first',
    hash: 'rollback-first',
    prepare: () => ({
      ...item,
      feedId: 1,
      guid: 'rollback-first',
      hash: 'rollback-first',
      imageUrl: null,
      enclosureUrl: null,
      enclosureType: null,
    }),
  };
  await expect(
    adapter.insertBatch([
      prepared,
      {
        feedId: 999999,
        guid: 'rollback-last',
        hash: 'rollback-last',
        prepare: () => ({
          ...prepared.prepare(),
          feedId: 999999,
          guid: 'rollback-last',
          hash: 'rollback-last',
        }),
      },
    ]),
  ).rejects.toThrow();
  expect(await storage.first("SELECT id FROM articles WHERE guid='rollback-first'")).toBeNull();
});

it('feeds real MIME through the shared cleaner into D1, retains sender policy and handles duplicate redelivery', async () => {
  const pipeline = new NewsletterPipeline(new CloudflareNewsletterStorage(storage), hash, clock);
  const mime =
    'From: Publisher <hello@example.test>\r\nTo: reader@example.test\r\nSubject: D1 letter\r\nMessage-ID: <d1-first@example.test>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>A letter.</p><script>bad()</script><img src="https://tracker.example.test/pixel" width="1" height="1">';
  const first = await pipeline.ingest(mime);
  expect(first.outcome).toBe('inserted');
  expect((await pipeline.ingest(mime)).outcome).toBe('duplicate');
  const article = await storage.first<{
    url: string;
    content_html: string;
    raw_html: string;
    cleaning_json: string;
  }>('SELECT url,content_html,raw_html,cleaning_json FROM articles WHERE id=?', [first.articleId]);
  expect(article?.url).toBe(`/a/${first.articleId}`);
  expect(article?.content_html).not.toContain('script');
  expect(article?.content_html).not.toContain('tracker.example.test');
  expect(JSON.parse(article!.cleaning_json).trackers).toBeGreaterThan(0);
  expect(article?.raw_html).toContain('script');
  await storage.run(
    "UPDATE feeds SET settings_json=json_set(settings_json,'$.blocked',json('true')) WHERE id=?",
    [first.feedId],
  );
  expect((await pipeline.ingest(mime.replace('d1-first', 'd1-next'))).outcome).toBe('blocked');
  await pipeline.prune();
});

it('uses private R2 image objects, keeps signed URLs out of keys, expires stale entries and survives cache failures', async () => {
  let at = now;
  const cache = new R2ImageCache(bucket, () => at);
  let requests = 0;
  const fetcher: typeof fetch = async () => {
    requests++;
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { 'content-type': 'image/png' },
    });
  };
  const source = new URL('https://images.example.test/photo?signature=private');
  expect(new Uint8Array(await (await proxyImage(source, fetcher, cache)).arrayBuffer())).toEqual(
    new Uint8Array([137, 80, 78, 71]),
  );
  expect((await proxyImage(source, fetcher, cache)).headers.get('cache-control')).toBe(
    'private, max-age=86400',
  );
  expect(requests).toBe(1);
  const listed = await bucket.list();
  expect(listed.objects).toHaveLength(1);
  expect(listed.objects[0]!.key).toMatch(/^images\/[a-f\d]{64}$/);
  at += 86_400_001;
  await proxyImage(source, fetcher, cache);
  expect(requests).toBe(2);
  await proxyImage(source, fetcher, {
    get: async () => {
      throw new Error('R2 outage');
    },
    put: async () => {
      throw new Error('R2 outage');
    },
  });
  expect(requests).toBe(3);
});

it('does not cache private/cookie images or non-images, and cancels oversized streams before consuming the body', async () => {
  let puts = 0;
  const cache = {
    get: async () => null,
    put: async () => {
      puts++;
    },
  };
  const source = new URL('https://images.example.test/private');
  await proxyImage(
    source,
    async () =>
      new Response('private', {
        headers: { 'content-type': 'image/png', 'cache-control': 'private' },
      }),
    cache,
  );
  await proxyImage(
    source,
    async () =>
      new Response('private', {
        headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' },
      }),
    cache,
  );
  await proxyImage(
    source,
    async () =>
      new Response('private', {
        headers: { 'content-type': 'image/png', 'set-cookie': 'session=test' },
      }),
    cache,
  );
  await expect(
    proxyImage(
      source,
      async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
      cache,
    ),
  ).rejects.toThrow('Image could not be loaded');
  let cancelled = false;
  await expect(
    proxyImage(
      source,
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES + 1));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': 'image/png' } },
        ),
      cache,
    ),
  ).rejects.toThrow('Image is too large');
  expect(cancelled).toBe(true);
  expect(puts).toBe(0);
});
