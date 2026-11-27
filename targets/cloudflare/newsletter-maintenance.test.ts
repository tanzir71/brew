import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { readdir, readFile } from 'node:fs/promises';
import type { D1Database } from '@cloudflare/workers-types';
import { CloudflareStorage } from './src/storage.js';
import { maintainCloudflareNewsletters } from './src/newsletter-maintenance.js';

const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("maintenance fixture"); } };',
  compatibilityDate: '2026-07-01',
  d1Databases: ['DB'],
});
let database: D1Database;
let storage: CloudflareStorage;
const now = new Date('2026-11-27T12:00:00Z');
const day = 86_400_000;
const cursorKey = 'maintenance:newsletter-retention:cursor';

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
      'DROP TRIGGER IF EXISTS maintenance_failure',
      'DELETE FROM feeds',
      'DELETE FROM settings',
      'DELETE FROM tags',
      "DELETE FROM sqlite_sequence WHERE name IN ('articles','feeds')",
    ].map((sql) => storage.statement(sql)),
  );
});
afterAll(async () => runtime.dispose());

async function seed(count: number, publishedAt = now.getTime() - 30 * day) {
  await storage.batch([
    storage.statement(
      `WITH RECURSIVE numbers(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM numbers WHERE id<?)
       INSERT INTO feeds(id,url,title,kind,retention_days,settings_json)
       SELECT id,'mailto:sender'||id||'@example.test','Sender '||id,'newsletter',7,
         json_object('blocked',id%2) FROM numbers`,
      [count],
    ),
    storage.statement(
      `INSERT INTO articles(id,feed_id,guid,title,url,published_at,content_html,raw_html,hash)
       SELECT id,id,'letter-'||id,'Letter '||id,'/a/'||id,?,'<p>Clean.</p>','<p>Original.</p>','hash-'||id
       FROM feeds`,
      [publishedAt],
    ),
  ]);
}
async function cursor() {
  return JSON.parse(
    (await storage.first<{ value: string }>('SELECT value FROM settings WHERE key=?', [cursorKey]))!
      .value,
  ) as { after: number; through: number };
}

it('bounds each page to 500 letters and one native D1 call across 1203 senders, preserving retention exceptions', async () => {
  await seed(1203);
  await storage.batch([
    storage.statement('UPDATE articles SET starred_at=? WHERE id=1', [now.getTime()]),
    storage.statement("INSERT INTO tags(id,name,color) VALUES(1,'Keep','#000000')"),
    storage.statement('INSERT INTO article_tags(article_id,tag_id) VALUES(2,1)'),
    storage.statement('UPDATE articles SET published_at=? WHERE id=3', [now.getTime()]),
    storage.statement('UPDATE articles SET published_at=? WHERE id=4', [now.getTime() - 7 * day]),
    storage.statement(
      "INSERT INTO feeds(id,url,title,kind) VALUES(2000,'https://rss.test/','RSS','rss')",
    ),
    storage.statement(`INSERT INTO articles(id,feed_id,guid,title,url,published_at,raw_html,hash)
      VALUES(2000,2000,'rss','RSS','https://rss.test/old',0,'RSS original','rss-hash')`),
  ]);
  const totals = { scanned: 0, originalsCleared: 0, deleted: 0 };
  for (const count of [500, 500, 203]) {
    // Recreate the adapter as a new invocation would; no in-memory cursor survives.
    const invocation = new CloudflareStorage(database);
    const native = vi.spyOn(invocation, 'batch');
    const result = await maintainCloudflareNewsletters(invocation, now);
    expect(native).toHaveBeenCalledTimes(1);
    native.mockRestore();
    expect(result.scanned).toBe(count);
    totals.scanned += result.scanned;
    totals.originalsCleared += result.originalsCleared;
    totals.deleted += result.deleted;
    expect(await storage.first("SELECT key FROM settings WHERE key LIKE '%:page'")).toBeNull();
  }
  expect(totals).toEqual({ scanned: 1203, originalsCleared: 1201, deleted: 1199 });
  expect(await storage.all('SELECT id,raw_html FROM articles ORDER BY id')).toEqual([
    { id: 1, raw_html: null },
    { id: 2, raw_html: null },
    { id: 3, raw_html: '<p>Original.</p>' },
    { id: 4, raw_html: '<p>Original.</p>' },
    { id: 2000, raw_html: 'RSS original' },
  ]);
  expect(await cursor()).toEqual({ after: 1203, through: 1203 });
  expect(await maintainCloudflareNewsletters(new CloudflareStorage(database), now)).toEqual({
    scanned: 4,
    originalsCleared: 0,
    deleted: 0,
  });
});

it('finishes a fixed sweep despite new arrivals and revisits lower IDs that later expire', async () => {
  await seed(501, now.getTime());
  expect((await maintainCloudflareNewsletters(storage, now)).scanned).toBe(500);
  expect(await cursor()).toEqual({ after: 500, through: 501 });
  await storage.batch([
    storage.statement(`INSERT INTO articles(id,feed_id,guid,title,url,published_at,raw_html,hash)
      VALUES(600,1,'new-arrival','Arrival','/a/600',0,'New old original','arrival-hash')`),
    storage.statement('UPDATE articles SET published_at=0 WHERE id=1'),
  ]);
  expect(await maintainCloudflareNewsletters(new CloudflareStorage(database), now)).toEqual({
    scanned: 1,
    originalsCleared: 0,
    deleted: 0,
  });
  expect(await cursor()).toEqual({ after: 501, through: 501 });
  expect((await maintainCloudflareNewsletters(new CloudflareStorage(database), now)).deleted).toBe(
    1,
  );
  expect(await cursor()).toEqual({ after: 500, through: 600 });
  expect((await maintainCloudflareNewsletters(new CloudflareStorage(database), now)).deleted).toBe(
    1,
  );
  expect(await storage.first('SELECT id FROM articles WHERE id IN (1,600)')).toBeNull();
});

it('serializes overlapping invocations into distinct durable pages', async () => {
  await seed(503);
  const reports = await Promise.all([
    maintainCloudflareNewsletters(new CloudflareStorage(database), now),
    maintainCloudflareNewsletters(new CloudflareStorage(database), now),
  ]);
  expect(reports.map((report) => report.scanned).sort((a, b) => a - b)).toEqual([3, 500]);
  expect(reports.reduce((count, report) => count + report.deleted, 0)).toBe(503);
  expect(await storage.first('SELECT count(*) AS count FROM articles')).toEqual({ count: 0 });
  expect(await cursor()).toEqual({ after: 503, through: 503 });
});

it('rolls back cursor advancement and original redaction when a page fails, then retries it', async () => {
  await seed(3);
  await storage.run(`CREATE TRIGGER maintenance_failure BEFORE DELETE ON articles
    WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'maintenance test failure'); END`);
  await expect(maintainCloudflareNewsletters(storage, now)).rejects.toThrow();
  expect(
    await storage.first('SELECT count(*) AS count FROM articles WHERE raw_html IS NOT NULL'),
  ).toEqual({ count: 3 });
  expect(await storage.first('SELECT key FROM settings WHERE key=?', [cursorKey])).toBeNull();
  expect(await storage.first("SELECT key FROM settings WHERE key LIKE '%:page'")).toBeNull();
  await storage.run('DROP TRIGGER maintenance_failure');
  expect(await maintainCloudflareNewsletters(new CloudflareStorage(database), now)).toEqual({
    scanned: 3,
    originalsCleared: 3,
    deleted: 3,
  });
});

it.each([
  'broken',
  '{}',
  '{"after":-1,"through":10}',
  '{"after":1.5,"through":10}',
  '{"after":20,"through":10}',
  '{"after":0,"through":"10"}',
])('recovers malformed or invalid maintenance state: %s', async (value) => {
  await seed(1);
  await storage.run('INSERT INTO settings(key,value) VALUES(?,?)', [cursorKey, value]);
  expect((await maintainCloudflareNewsletters(storage, now)).deleted).toBe(1);
  expect(await cursor()).toEqual({ after: 1, through: 1 });
});

it('uses current sender kind/retention and current saved state on each page, including blocked senders', async () => {
  await seed(501);
  await storage.run('UPDATE feeds SET retention_days=60');
  await maintainCloudflareNewsletters(storage, now);
  await storage.batch([
    storage.statement('UPDATE feeds SET retention_days=7 WHERE id IN (500,501)'),
    storage.statement('UPDATE articles SET starred_at=? WHERE id=501', [now.getTime()]),
  ]);
  expect(await maintainCloudflareNewsletters(storage, now)).toEqual({
    scanned: 1,
    originalsCleared: 1,
    deleted: 0,
  });
  // The next sweep revisits sender 500 after their retention was shortened.
  expect((await maintainCloudflareNewsletters(storage, now)).deleted).toBe(1);
  expect(await storage.first('SELECT id FROM articles WHERE id=500')).toBeNull();
  expect(await storage.first('SELECT raw_html FROM articles WHERE id=501')).toEqual({
    raw_html: null,
  });
});
