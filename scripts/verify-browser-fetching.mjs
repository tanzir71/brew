/* global window */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import path from 'node:path';
import { chromium, firefox } from '@playwright/test';
import { Miniflare, Response as BindingResponse } from 'miniflare';

const root = fileURLToPath(new URL('../targets/browser/dist/', import.meta.url));
const failures = [],
  reports = [],
  requests = [];
let passed = false;
const token = 'browser-verifier-only-token-32-characters';
let version = 1;
const published = new Date().toISOString();
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      return response.end(
        '<!doctype html><html lang="en"><title>Browser fetching verification</title><body></body></html>',
      );
    }
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root)) throw new Error('Invalid path');
    response.writeHead(200, {
      'Content-Type': filename.endsWith('.wasm') ? 'application/wasm' : 'application/javascript',
    });
    response.end(await readFile(filename));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const relay = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL('../targets/browser/relay/worker.js', import.meta.url)),
  compatibilityDate: '2026-07-01',
  bindings: {
    APP_ORIGIN: origin,
    ALLOWED_HOSTS: 'feeds.example.test,cdn.example.test',
    RELAY_TOKEN: token,
  },
  outboundService: async (request) => {
    const url = new URL(request.url);
    requests.push({ url: request.url, headers: Object.fromEntries(request.headers) });
    assert.equal(request.headers.get('authorization'), null);
    assert.equal(request.headers.get('cookie'), null);
    if (url.pathname === '/redirect')
      return new BindingResponse(null, {
        status: 302,
        headers: { Location: 'https://cdn.example.test/rss' },
      });
    if (url.pathname === '/denied-redirect')
      return new BindingResponse(null, {
        status: 302,
        headers: { Location: 'https://unlisted.example.test/rss' },
      });
    if (url.pathname === '/loop')
      return new BindingResponse(null, { status: 302, headers: { Location: '/loop' } });
    if (url.pathname === '/error') return new BindingResponse('Unavailable', { status: 503 });
    const etag = '"' + url.pathname + '-' + version + '"';
    if (request.headers.get('if-none-match') === etag)
      return new BindingResponse(null, { status: 304, headers: { ETag: etag } });
    const headers = { ETag: etag, 'Last-Modified': 'Wed, 25 Nov 2026 07:00:00 GMT' };
    const body =
      '<p>Quiet body <img src="https://images.example.test/art.png"><script>alert(1)</script></p>';
    if (url.pathname === '/json')
      return new BindingResponse(
        JSON.stringify({
          version: 'https://jsonfeed.org/version/1.1',
          title: 'JSON notes',
          items: [
            {
              id: 'json-' + version,
              url: 'https://example.test/json-' + version,
              title: version === 1 ? 'Quiet interfaces' : 'Notify me',
              content_html: body,
              date_published: published,
            },
          ],
        }),
        { headers: { ...headers, 'Content-Type': 'application/feed+json' } },
      );
    if (url.pathname === '/atom')
      return new BindingResponse(
        `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom notes</title><link href="https://example.test"/><entry><id>atom-one</id><title>Quiet interfaces</title><link href="https://example.test/atom-one"/><updated>${published}</updated><content type="html">&lt;p&gt;Quiet body&lt;/p&gt;</content></entry></feed>`,
        { headers: { ...headers, 'Content-Type': 'application/atom+xml' } },
      );
    return new BindingResponse(
      `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>RSS notes</title><link>https://example.test</link><description>Notes</description><item><guid>rss-one</guid><link>https://example.test/rss-one</link><title>Quiet interfaces</title><pubDate>${new Date(published).toUTCString()}</pubDate><content:encoded><![CDATA[${body}]]></content:encoded></item><item><guid>rss-duplicate</guid><link>https://example.test/rss-one</link><title>Quiet interfaces</title></item></channel></rss>`,
      { headers: { ...headers, 'Content-Type': 'application/rss+xml' } },
    );
  },
});
try {
  const endpoint = (await relay.ready).href;
  for (const [browserName, browserType] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ]) {
    const browser = await browserType.launch();
    try {
      for (const persistence of ['auto', 'indexeddb']) {
        version = 1;
        process.stdout.write(
          `${browserName} ${persistence}: built relay, SQLite ingestion and lifecycle\n`,
        );
        const context = await browser.newContext();
        try {
          context.on('page', (page) =>
            page.on('pageerror', (error) => failures.push(error.message)),
          );
          await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if ([origin, new URL(endpoint).origin].includes(url.origin)) return route.continue();
            failures.push('Unexpected third-party browser request: ' + url.origin);
            return route.abort();
          });
          let page = await context.newPage();
          await page.goto(origin);
          await page.clock.install();
          const name = `fetch-${browserName}-${persistence}`;
          const first = await page.evaluate(
            async ({ name, persistence, endpoint, token }) => {
              window.runtime = await import('/index.js');
              window.cycles = [];
              window.errors = [];
              window.library = await window.runtime.openBrowserLibrary({
                name,
                persistence,
                onCycle: (result) => window.cycles.push(result),
                onError: (error) => window.errors.push(error),
              });
              const setup = await window.library.refreshDue();
              const status = await window.library.configureRelay({ endpoint, token });
              const storage = window.library.storage;
              for (const source of ['rss', 'atom', 'json'])
                await storage.db.insert(window.runtime.schema.feeds).values({
                  title: source,
                  url: `https://feeds.example.test/${source}?private=fixture-only`,
                });
              await storage.db.insert(window.runtime.schema.feeds).values({
                title: 'Private sender',
                url: 'https://feeds.example.test/letter',
                kind: 'newsletter',
              });
              await storage.run(
                "CREATE TRIGGER reject_tag BEFORE INSERT ON tags WHEN NEW.name='Reject' BEGIN SELECT RAISE(ABORT,'Rejected tag'); END",
              );
              await storage.run(
                "INSERT INTO rules(name,match_type,scope_json,conditions_json,actions_json) VALUES(?,'all','{}',?,?)",
                [
                  'Quiet',
                  JSON.stringify([
                    { field: 'title', operator: 'matches_regex', value: '(?<=Quiet )interfaces' },
                  ]),
                  JSON.stringify([
                    { type: 'star' },
                    { type: 'add_tag', tag: 'Reject' },
                    { type: 'add_tag', tag: 'Keep' },
                  ]),
                ],
              );
              const cycle = await window.library.refreshDue();
              return {
                setup,
                status,
                cycle,
                articles: await storage.all(
                  'SELECT title,content_html AS content,starred_at AS star FROM articles',
                ),
                tags: await storage.first('SELECT count(*) AS total FROM article_tags'),
                logs: await storage.first('SELECT count(*) AS total FROM rule_logs'),
                logFailures: await storage.all(
                  'SELECT actions_taken_json AS actions FROM rule_logs',
                ),
                fts: await storage.first(
                  "SELECT count(*) AS total FROM articles_fts WHERE articles_fts MATCH 'Quiet'",
                ),
                feeds: await storage.all(
                  "SELECT title,last_status,etag FROM feeds WHERE kind='rss'",
                ),
              };
            },
            { name, persistence, endpoint, token },
          );
          assert.equal(first.setup.state, 'needs-relay');
          assert.deepEqual(first.status, { configured: true, endpoint });
          assert.equal(JSON.stringify(first.status).includes(token), false);
          assert.equal(first.cycle.state, 'ready');
          assert.equal(first.cycle.pending, 0);
          assert.equal(first.cycle.results.length, 3);
          assert(
            first.cycle.results.every(
              (result) => result.outcome === 'success' && result.newItems === 1,
            ),
            JSON.stringify(first.cycle),
          );
          assert.equal(first.articles.length, 3);
          assert(
            first.articles.every((article) => article.star && !article.content.includes('<script')),
          );
          assert(
            first.logFailures.every((log) =>
              JSON.parse(log.actions).some((action) => action.type === 'add_tag' && !action.ok),
            ),
          );
          assert.equal(first.tags.total, 3);
          assert.equal(first.logs.total, 3);
          assert.equal(first.fts.total, 3);
          assert(first.feeds.every((feed) => feed.last_status === 200 && feed.etag));
          const second = await page.evaluate(async () => {
            const storage = window.library.storage;
            const results = await Promise.all(
              [1, 2, 3].map((id) => window.library.refreshFeed(id)),
            );
            return {
              results,
              articles: await storage.first('SELECT count(*) AS total FROM articles'),
              logs: await storage.first('SELECT count(*) AS total FROM rule_logs'),
            };
          });
          assert(second.results.every((cycle) => cycle.results[0].outcome === 'not-modified'));
          assert.equal(second.articles.total, 3);
          assert.equal(second.logs.total, 3);
          assert(
            requests.some(
              (request) => request.headers['if-modified-since'] && request.headers['if-none-match'],
            ),
          );
          const beforeTimer = await page.evaluate(async () => {
            await window.library.storage.run('UPDATE feeds SET last_fetched_at=0');
            return window.cycles.length;
          });
          await page.clock.fastForward(60_000);
          await page.waitForFunction((before) => window.cycles.length > before, beforeTimer);
          assert.equal(await page.evaluate(() => window.cycles.at(-1).results.length), 3);
          const invalid = await page.evaluate(
            async ({ endpoint, token }) => {
              await window.library.configureRelay({ endpoint, token: token + '-wrong' });
              const cycle = await window.library.refreshFeed(1);
              const feed = await window.library.storage.first(
                'SELECT consecutive_failures AS failures FROM feeds WHERE id=1',
              );
              await window.library.configureRelay({ endpoint, token });
              return { cycle, feed };
            },
            { endpoint, token },
          );
          assert.equal(invalid.cycle.results[0].outcome, 'error');
          assert.equal(invalid.feed.failures, 0);
          const upstreamFailure = await page.evaluate(async () => {
            await window.library.storage.run(
              "UPDATE feeds SET url='https://feeds.example.test/error' WHERE id=1",
            );
            const cycle = await window.library.refreshFeed(1);
            const feed = await window.library.storage.first(
              'SELECT consecutive_failures AS failures,last_status AS status FROM feeds WHERE id=1',
            );
            await window.library.storage.run(
              "UPDATE feeds SET url='https://feeds.example.test/rss',last_fetched_at=0 WHERE id=1",
            );
            return { cycle, feed };
          });
          assert.equal(upstreamFailure.feed.status, 503);
          assert.equal(upstreamFailure.feed.failures, 1);
          await page.evaluate(() => window.library.close());
          const requestsBeforeOpen = requests.length;
          await page.reload();
          await page.evaluate(
            async ({ name, persistence }) => {
              window.runtime = await import('/index.js');
              window.cycles = [];
              window.errors = [];
              window.library = await window.runtime.openBrowserLibrary({
                name,
                persistence,
                onCycle: (result) => window.cycles.push(result),
                onError: (error) => window.errors.push(error),
              });
              await window.library.refreshDue();
            },
            { name, persistence },
          );
          assert(
            requests.length > requestsBeforeOpen,
            'Opening the saved library must catch up due feeds.',
          );
          assert.equal(
            await page.evaluate(
              async () =>
                (await window.library.storage.first('SELECT count(*) AS total FROM articles'))
                  .total,
            ),
            3,
          );
          version = 2;
          await page.evaluate(async () => {
            await window.library.close();
          });
          await page.evaluate(
            async ({ name, persistence }) => {
              window.library = await window.runtime.openBrowserLibrary({
                name,
                persistence,
                notifications: {
                  notify: (article) => {
                    window.notification = article;
                    return new Promise(() => {});
                  },
                },
                onError: (error) => window.errors.push(error),
              });
              await window.library.refreshDue();
              await window.library.storage.run(
                "INSERT INTO rules(name,match_type,scope_json,conditions_json,actions_json) VALUES(?,'all','{}',?,?)",
                [
                  'Notify',
                  JSON.stringify([{ field: 'title', operator: 'equals', value: 'Notify me' }]),
                  JSON.stringify([{ type: 'notify' }, { type: 'star' }]),
                ],
              );
              void window.library.refreshFeed(3).catch(() => {});
            },
            { name, persistence },
          );
          await page.waitForFunction(() => window.notification, undefined, { polling: 10 });
          const beforeCrash = await page.evaluate(async () => ({
            articles: await window.library.storage.all(
              'SELECT id,title,published_at FROM articles',
            ),
            jobs: await window.library.storage.all('SELECT id,state_json FROM ingest_jobs'),
            rules: await window.library.storage.all('SELECT id,name FROM rules'),
          }));
          assert.equal(
            beforeCrash.jobs.length,
            1,
            'Terminate while processing is durably pending.',
          );
          assert.equal(JSON.parse(beforeCrash.jobs[0].state_json).actions.externalStarted, true);
          assert(beforeCrash.articles.some((article) => article.title === 'Notify me'));
          await page.close();
          page = await context.newPage();
          await page.goto(origin);
          await page.waitForFunction(
            async ({ name, persistence }) => {
              if (window.library) return true;
              try {
                window.runtime = await import('/index.js');
                window.deliveries = 0;
                window.errors = [];
                window.library = await window.runtime.openBrowserLibrary({
                  name,
                  persistence,
                  notifications: {
                    notify: () => {
                      window.deliveries++;
                    },
                  },
                  onError: (error) => window.errors.push(error),
                });
                return true;
              } catch {
                return false;
              }
            },
            { name, persistence },
          );
          const recovered = await page.evaluate(async () => {
            const cycle = await window.library.refreshDue();
            const log = await window.library.storage.first(
              'SELECT actions_taken_json AS actions FROM rule_logs WHERE rule_id=2 ORDER BY id DESC LIMIT 1',
            );
            const article = await window.library.storage.first(
              "SELECT starred_at AS star FROM articles WHERE title='Notify me'",
            );
            const result = {
              cycle,
              log,
              article,
              deliveries: window.deliveries,
              errors: window.errors,
              articles: await window.library.storage.all('SELECT id,title FROM articles'),
              rules: await window.library.storage.all('SELECT id,name FROM rules'),
            };
            await window.library.close();
            return result;
          });
          assert.equal(recovered.cycle.pending, 0);
          assert.equal(recovered.deliveries, 0);
          assert(recovered.article?.star, JSON.stringify({ beforeCrash, recovered }));
          assert.match(recovered.log.actions, /not replayed/);
          assert.deepEqual(recovered.errors, []);
          reports.push({
            browserName,
            persistence,
            passed: true,
            conditional: true,
            scheduled: true,
            catchUp: true,
            interruptedActionNotReplayed: true,
          });
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(failures, []);
  passed = true;
} finally {
  await relay.dispose();
  await new Promise((resolve) => server.close(resolve));
  await mkdir('test-results/browser-fetching', { recursive: true });
  await writeFile(
    'test-results/browser-fetching/report.json',
    JSON.stringify({ passed, reports, failures }, null, 2),
  );
}
process.stdout.write(
  'Built browser fetching passed in Chromium and Firefox with both persistence backends.\n',
);
