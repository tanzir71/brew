/* global window, fetch */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { URL } from 'node:url';
import process from 'node:process';
import { chromium, firefox } from '@playwright/test';
import { browserLaunchOptions } from './lib/browser-launch.mjs';
import { openDatabase } from '../dist/targets/node/src/db/database.js';
import {
  inspectNodeArchive,
  importNodeArchive,
  exportNodeArchive,
} from '../dist/targets/node/src/ports/archive.js';
const output = process.env.BREW_ARCHIVE_REPORT_DIR ?? 'test-results/browser-archives';
const root = path.resolve('targets/browser/dist');
const archives = new Map();
const returned = new Map();
const failures = [];
const reports = [];
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><html lang="en"><title>Brew archive verification</title><body></body></html>',
      );
      return;
    }
    if (url.pathname.startsWith('/archive/')) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      archives.set(url.pathname.slice(9), Buffer.concat(chunks));
      response.end('saved');
      return;
    }
    if (url.pathname.startsWith('/returned/')) {
      response.setHeader('Content-Type', 'application/octet-stream');
      response.end(returned.get(url.pathname.slice(10)));
      return;
    }
    assert(url.pathname.startsWith('/runtime/'));
    const file = path.resolve(root, '.' + url.pathname.slice(8));
    assert(file.startsWith(root + path.sep));
    response.setHeader(
      'Content-Type',
      file.endsWith('.wasm') ? 'application/wasm' : 'application/javascript',
    );
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end('missing');
  }
});
await mkdir(output, { recursive: true });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const directory = await mkdtemp(path.join(tmpdir(), 'brew-archive-'));
try {
  for (const [name, type] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ]) {
    const browser = await type.launch(browserLaunchOptions(name));
    try {
      for (const persistence of ['opfs', 'indexeddb']) {
        const key = name + '-' + persistence;
        const context = await browser.newContext();
        const page = await context.newPage();
        page.on('pageerror', (error) => failures.push(key + ': ' + error.message));
        try {
          await page.goto(origin);
          const initial = await page.evaluate(
            async ({ persistence, key }) => {
              const runtime = await import('/runtime/index.js');
              window.runtime = runtime;
              const library = (window.library = await runtime.openBrowserLibrary({
                name: 'archive-' + key,
                persistence,
              }));
              const response = await library.fetch('/api/browser/start', { method: 'POST' });
              if (!response.ok) throw new Error('Could not seed the actual library.');
              await library.storage.execute([
                {
                  sql: "INSERT INTO feeds(id,url,title,kind) VALUES(90,'mailto:private@example.test','Private newsletter','newsletter')",
                },
                {
                  sql: "INSERT INTO articles(id,feed_id,guid,url,title,content_html,raw_html,published_at,hash,read_at,starred_at) VALUES(90,90,'private','https://example.test/private','Café private letter','<p>Private archive text</p>','<p>Original HTML</p>',1000,'private-archive',2000,3000)",
                },
                { sql: "INSERT INTO tags(id,name,color) VALUES(90,'Archived','#123456')" },
                { sql: 'INSERT INTO article_tags(article_id,tag_id) VALUES(90,90)' },
                { sql: "UPDATE sqlite_sequence SET seq=200 WHERE name='articles'" },
              ]);
              const rows = await library.storage.archiveRows();
              const bytes = (window.archive = await runtime.createBrowserArchive(rows, {
                createdAt: '2026-11-28T12:00:00.000Z',
                source: 'browser',
                preferences: { theme: 'dark', landing: 'brew' },
              }));
              const inspected = await runtime.inspectBrowserArchive(bytes);
              window.originalRows = inspected.rows;
              const saved = await fetch('/archive/' + key, { method: 'POST', body: bytes });
              if (!saved.ok) throw new Error('Could not retain the fixture archive.');
              return {
                counts: inspected.counts,
                source: inspected.manifest.source,
                header: inspected.manifest.database.file,
              };
            },
            { persistence, key },
          );
          assert.equal(initial.counts.articles, 14);
          assert.equal(initial.counts.feeds, 4);
          assert.equal(initial.source, 'browser');
          const bytes = archives.get(key);
          assert(bytes);
          await writeFile(path.join(output, key + '.brew'), bytes);
          const inspected = await inspectNodeArchive(bytes);
          const filename = path.join(directory, key + '.db');
          let native = openDatabase(filename);
          try {
            native.sqlite.exec(
              "INSERT INTO feeds(url,title) VALUES('https://old.test','Old target')",
            );
            importNodeArchive(native, inspected);
            assert.throws(
              () => native.sqlite.prepare('SELECT title FROM articles').all(),
              /Reopen/,
            );
            native.close();
            native = openDatabase(filename);
            assert.deepEqual(
              native.sqlite
                .prepare('SELECT read_at,starred_at,raw_html FROM articles WHERE id=90')
                .get(),
              { read_at: 2000, starred_at: 3000, raw_html: '<p>Original HTML</p>' },
            );
            assert.equal(
              native.sqlite
                .prepare("SELECT count(*) AS total FROM feeds WHERE url='https://old.test'")
                .get().total,
              0,
            );
            assert.equal(
              native.sqlite
                .prepare(
                  "SELECT count(*) AS total FROM articles_fts WHERE articles_fts MATCH 'Café'",
                )
                .get().total,
              1,
            );
            assert.equal(
              native.sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name='articles'").get()
                .seq,
              200,
            );
          } finally {
            native.close();
          }
          native = openDatabase(filename);
          try {
            returned.set(
              key,
              await exportNodeArchive(native, {
                createdAt: '2026-11-28T12:00:00.000Z',
                preferences: inspected.manifest.preferences,
              }),
            );
          } finally {
            native.close();
          }
          const roundtrip = await page.evaluate(async (key) => {
            const bytes = new Uint8Array(await (await fetch('/returned/' + key)).arrayBuffer());
            const result = await window.runtime.inspectBrowserArchive(bytes);
            const same = JSON.stringify(result.rows) === JSON.stringify(window.originalRows);
            const damaged = bytes.slice();
            damaged[64] ^= 1;
            let rejected = false;
            try {
              await window.runtime.inspectBrowserArchive(damaged);
            } catch {
              rejected = true;
            }
            const total = await window.library.storage.first(
              'SELECT count(*) AS total FROM articles',
            );
            const persistence = window.library.storage.persistence;
            await window.library.close();
            const target = await window.runtime.BrowserDatabase.open({
              name: 'archive-' + key,
              persistence,
            });
            await target.replaceArchive(result.rows);
            let fenced = false;
            try {
              await target.first('SELECT title FROM articles');
            } catch (error) {
              fenced = /Reopen/.test(error.message);
            }
            await target.close();
            const reopened = await window.runtime.BrowserDatabase.open({
              name: 'archive-' + key,
              persistence,
            });
            let restored, search;
            try {
              restored =
                JSON.stringify(await reopened.archiveRows()) === JSON.stringify(result.rows);
              search = (
                await reopened.first(
                  "SELECT count(*) AS total FROM articles_fts WHERE articles_fts MATCH 'Café'",
                )
              ).total;
            } finally {
              await reopened.close();
            }
            return {
              same,
              rejected,
              fenced,
              restored,
              search,
              total: total.total,
              source: result.manifest.source,
            };
          }, key);
          assert(roundtrip.same);
          assert(roundtrip.rejected);
          assert(roundtrip.fenced);
          assert(roundtrip.restored);
          assert.equal(roundtrip.search, 1);
          assert.equal(roundtrip.total, 14);
          assert.equal(roundtrip.source, 'node');
          reports.push({
            name,
            persistence,
            articles: 14,
            checks: [
              'persistent browser export',
              'native SQLite import and reopened file',
              'FTS and original private content',
              'read/star/tags/settings/sequence preservation',
              'Node archive validated again by WASM',
              'corruption leaves the live library unchanged',
              'actual browser replacement and old-scope rejection',
              'exact rows and search after persistent browser reopen',
            ],
          });
          process.stdout.write(key + ' archive round-trip passed\n');
        } catch (error) {
          failures.push(key + ': ' + error.stack);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(failures, []);
} finally {
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify({ reports, failures, directory }, null, 2),
  );
  await new Promise((resolve) => server.close(resolve));
}
