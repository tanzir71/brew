import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { URL } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { CloudflareStorage } from '../dist/targets/cloudflare/src/storage.js';
import { CloudflareNewsletterStorage } from '../dist/targets/cloudflare/src/newsletter-storage.js';
import { R2ImageCache } from '../dist/targets/cloudflare/src/image-cache.js';
import { NewsletterPipeline } from '../dist/packages/core/src/newsletter-pipeline.js';
import { proxyImage } from '../dist/packages/api/src/image-proxy.js';
import {
  cloudflareLibraryServices,
  createCloudflareLibraryApi,
} from '../dist/targets/cloudflare/src/library-api.js';
import { cloudflareIngestion } from '../dist/targets/cloudflare/src/ingestion.js';
import { newBrewSection } from '../dist/packages/core/src/composition-model.js';
import { renderBrewMarkdown } from '../dist/packages/core/src/brew-outputs.js';

const originalDirectory = process.cwd();
process.chdir(tmpdir());
const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("compiled port verification"); } };',
  compatibilityDate: '2026-07-01',
  d1Databases: ['DB'],
  r2Buckets: ['IMAGES'],
});
try {
  const database = await runtime.getD1Database('DB');
  const directory = new URL('../dist/packages/db/migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(file, directory), 'utf8');
    await database.batch(unstable_splitSqlQuery(sql).map((query) => database.prepare(query)));
  }
  const storage = new CloudflareStorage(database);
  const pipeline = new NewsletterPipeline(
    new CloudflareNewsletterStorage(storage),
    { sha1: (value) => createHash('sha1').update(value).digest('hex') },
    { now: () => new Date(), monotonic: () => globalThis.performance.now() },
  );
  const result = await pipeline.ingest(
    'From: Publisher <publisher@example.test>\r\nSubject: Compiled D1 letter\r\nMessage-ID: <compiled-d1@example.test>\r\nContent-Type: text/html\r\n\r\n<p>Compiled migration proof.</p><script>unsafe()</script>',
  );
  assert.equal(result.outcome, 'inserted');
  assert.equal(
    (await storage.first('SELECT content_html FROM articles WHERE id=?', [result.articleId]))
      .content_html,
    '<p>Compiled migration proof.</p>',
  );
  const cache = new R2ImageCache(await runtime.getR2Bucket('IMAGES'));
  const url = new URL('https://images.example.test/compiled.png');
  let requests = 0;
  const fetcher = async () => {
    requests++;
    return new globalThis.Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { 'content-type': 'image/png' },
    });
  };
  await (await proxyImage(url, fetcher, cache)).arrayBuffer();
  assert.deepEqual(
    new Uint8Array(await (await proxyImage(url, fetcher, cache)).arrayBuffer()),
    new Uint8Array([137, 80, 78, 71]),
  );
  assert.equal(requests, 1);
  const services = cloudflareLibraryServices(
    { DB: database, IMAGES: await runtime.getR2Bucket('IMAGES') },
    {
      capabilities: () => ({
        mode: 'cloudflare',
        fetch: 'direct',
        backgroundFetch: { kind: 'cron' },
        inboundMail: null,
        emailDelivery: null,
        readerApi: false,
        mcp: null,
        webmcp: false,
        ai: { available: [], configured: false },
        readState: 'server',
        publicCopy: false,
        outputs: { twins: true, feed: false, webhook: false },
      }),
    },
  );
  const reader = createCloudflareLibraryApi(services);
  const page = await reader.request('https://build.example.test/api/articles?includeTotal=true');
  assert.equal(page.status, 200);
  assert.equal((await page.json()).total, 1);
  const marked = await reader.request(
    `https://build.example.test/api/articles/${result.articleId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ read: true }),
    },
  );
  assert.equal(marked.status, 200);
  assert.ok((await marked.json()).readAt);
  assert.equal(
    (await reader.request(`https://build.example.test/a/${result.articleId}.md`)).status,
    200,
  );
  const saved = await reader.request('https://build.example.test/api/brew-configs/composition', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Compiled issue',
      enabled: false,
      timezone: 'UTC',
      schedule: { kind: 'daily', time: '07:00' },
      delivery: { web: true, feed: false, publicCopy: false },
      sections: [
        { ...newBrewSection('letters'), sources: [{ kind: 'newsletters' }], onlyUnread: false },
      ],
    }),
  });
  assert.equal(saved.status, 201);
  const config = await saved.json();
  const generated = await reader.request(
    `https://build.example.test/api/brew-configs/${config.id}/generate`,
    { method: 'POST' },
  );
  assert.equal(generated.status, 200);
  const issue = await generated.json();
  assert.equal(issue.issueNumber, 1);
  assert.equal(issue.sections[0].items[0].id, result.articleId);
  assert.equal(
    (await storage.first('SELECT rendered_md FROM brews WHERE id=?', [issue.id])).rendered_md,
    renderBrewMarkdown(issue),
  );
  assert.equal(
    (await reader.request(`https://build.example.test/b/${config.id}/${issue.id}.json`)).status,
    200,
  );
  const source = await reader.request('https://build.example.test/api/sources/searches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: 'compiled', name: 'Compiled sources', query: 'compiled' }),
  });
  assert.equal(source.status, 200);
  const rule = await reader.request('https://build.example.test/api/rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Compiled triage',
      enabled: true,
      scope: {},
      matchType: 'all',
      conditions: [{ field: 'title', operator: 'contains', value: 'Compiled' }],
      actions: [{ type: 'star' }],
      stopProcessing: false,
    }),
  });
  assert.equal(rule.status, 201);
  const imported = await cloudflareIngestion(
    database,
    { now: () => new Date(), monotonic: () => globalThis.performance.now() },
    services.rules,
  ).newsletters.ingest(
    'From: Publisher <publisher@example.test>\r\nSubject: Compiled async letter\r\nContent-Type: text/html\r\n\r\n<p>Native Web Crypto identity and shared rule execution.</p>',
  );
  assert.equal(imported.outcome, 'inserted');
  assert.ok(
    (await storage.first('SELECT starred_at FROM articles WHERE id=?', [imported.articleId]))
      .starred_at,
  );
  assert.equal(
    (
      await storage.first('SELECT count(*) AS n FROM rule_logs WHERE article_id=?', [
        imported.articleId,
      ])
    ).n,
    1,
  );
  process.stdout.write(
    'Built Cloudflare ports: shared D1 migrations, MIME cleaning/storage, private R2 images, compiled Reader/Brew/rules/source HTTP, frozen caches and async Web Crypto ingestion with real rule execution passed outside the repository cwd. Full Worker handler integration remains pending.\n',
  );
} finally {
  await runtime.dispose();
  process.chdir(originalDirectory);
}
