/* global window, indexedDB */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { tmpdir } from 'node:os';
import { setTimeout, clearTimeout } from 'node:timers';
import path from 'node:path';
import { chromium, firefox } from '@playwright/test';
import { browserLaunchOptions } from './lib/browser-launch.mjs';
import NativeSqlite from 'better-sqlite3';
import { migrateDatabase } from '../dist/targets/node/src/db/database.js';

const root = path.resolve(fileURLToPath(new URL('../targets/browser/dist/', import.meta.url)));
const reports = [];
const failures = [];
async function bounded(label, work) {
  let timer;
  process.stdout.write(label + '\n');
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' exceeded 30 seconds.')), 30_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const types = { '.js': 'application/javascript', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/' || pathname === '/second') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(
        '<!doctype html><html lang="en"><title>Brew storage verification</title><body></body></html>',
      );
      return;
    }
    if (!pathname.startsWith('/runtime/')) throw new Error('Unknown resource');
    const filename = path.resolve(root, '.' + pathname.slice('/runtime'.length));
    if (!filename.startsWith(root + path.sep)) throw new Error('Invalid path');
    response.writeHead(200, {
      'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream',
    });
    response.end(await readFile(filename));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
await mkdir('test-results/browser-storage', { recursive: true });

try {
  for (const [browserName, browserType] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ]) {
    const browser = await browserType.launch(browserLaunchOptions(browserName));
    try {
      for (const persistence of ['auto', 'indexeddb']) {
        process.stdout.write(browserName + ' ' + persistence + '\n');
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          context.on('page', (page) =>
            page.on('pageerror', (error) => failures.push(error.message)),
          );
          page.on('pageerror', (error) => failures.push(error.message));
          await context.route('**/*', async (route) => {
            if (new URL(route.request().url()).origin !== origin) {
              failures.push('Unexpected remote request: ' + route.request().url());
              return route.abort();
            }
            return route.continue();
          });
          await page.goto(origin);
          const name = 'test-' + browserName + '-' + persistence;
          const initial = await page.evaluate(
            async ({ name, persistence }) => {
              const runtime = await import('/runtime/index.js');
              window.runtime = runtime;
              window.storage = await runtime.openBrowserDatabase({ name, persistence });
              const storage = window.storage;
              const { schema } = runtime;
              const [folder] = await storage.db
                .insert(schema.folders)
                .values({ title: 'Design' })
                .returning();
              const [feed] = await storage.db
                .insert(schema.feeds)
                .values({ folderId: folder.id, title: 'Notes', url: 'https://example.test/feed' })
                .returning();
              let release;
              const held = new Promise((resolve) => {
                release = resolve;
              });
              let entered;
              const ready = new Promise((resolve) => {
                entered = resolve;
              });
              const transaction = storage.transaction(async (tx) => {
                await tx.insert(schema.articles).values({
                  feedId: feed.id,
                  guid: 'one',
                  url: 'https://example.test/one',
                  title: 'Café typography',
                  contentHtml: '<p>Quiet interfaces</p>',
                  publishedAt: new Date('2026-11-25T07:00:00Z'),
                  hash: 'one',
                });
                entered();
                await held;
                await tx.insert(schema.articles).values({
                  feedId: feed.id,
                  guid: 'two',
                  url: 'https://example.test/two',
                  title: 'Second story',
                  publishedAt: new Date('2026-11-25T06:00:00Z'),
                  hash: 'two',
                });
              });
              await Promise.race([ready, transaction]);
              const concurrent = storage.db.query.articles.findMany().then((items) => items.length);
              release();
              await transaction;
              const visibleAfterTransaction = await concurrent;
              let escaped;
              await storage.transaction(async (tx) => {
                escaped = tx;
              });
              let escapedRejected = false;
              try {
                await escaped.query.folders.findMany();
              } catch (error) {
                escapedRejected = (error.message + ' ' + error.cause?.message).includes(
                  'transaction scope is closed',
                );
              }
              let rollback = false;
              try {
                await storage.transaction(async (tx) => {
                  await tx.update(schema.folders).set({ title: 'Abandoned edit' });
                  throw new Error('Cancel the edit');
                });
              } catch (error) {
                rollback = error.message === 'Cancel the edit';
              }
              const search = await storage.all(
                'SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?',
                ['cafe'],
              );
              const missing = await storage.db.query.feeds.findFirst({
                where: (feeds, { eq }) => eq(feeds.id, 999),
              });
              const folders = await storage.db.query.folders.findMany();
              return {
                persistence: storage.persistence,
                sqliteVersion: storage.sqliteVersion,
                migrations: storage.migrations,
                folder: folders[0].title,
                dateMapped: feed.createdAt instanceof Date,
                visibleAfterTransaction,
                escapedRejected,
                rollback,
                missing: missing === undefined,
                search,
              };
            },
            { name, persistence },
          );
          assert.equal(initial.persistence, persistence === 'auto' ? 'opfs' : 'indexeddb');
          assert.equal(initial.migrations, 20);
          assert.equal(initial.folder, 'Design');
          assert.equal(initial.dateMapped, true);
          assert.equal(initial.visibleAfterTransaction, 2);
          assert.equal(initial.escapedRejected, true);
          assert.equal(initial.rollback, true);
          assert.equal(initial.missing, true);
          assert.deepEqual(initial.search, [{ rowid: 1 }]);

          const second = await context.newPage();
          await second.goto(origin + '/second');
          const busy = await second.evaluate(
            async ({ name }) => {
              try {
                await (await import('/runtime/index.js')).openBrowserDatabase({ name });
                return '';
              } catch (error) {
                return error.message;
              }
            },
            { name },
          );
          assert.match(busy, /already open in another tab/);
          await second.close();

          await page.evaluate(() => window.storage.close());
          const flipped = await page.evaluate(
            async ({ name, persistence }) => {
              try {
                await window.runtime.openBrowserDatabase({
                  name,
                  persistence: persistence === 'auto' ? 'indexeddb' : 'opfs',
                });
                return '';
              } catch (error) {
                return error.message;
              }
            },
            { name, persistence },
          );
          assert.match(flipped, /explicit migration/);
          // Navigation terminates the old worker. The same origin must reopen its committed data.
          await page.reload();
          const reopened = await page.evaluate(
            async ({ name }) => {
              window.storage = await (
                await import('/runtime/index.js')
              ).openBrowserDatabase({ name });
              const storage = window.storage;
              const articles = await storage.db.query.articles.findMany();
              const image = await storage.exportBytes();
              return {
                persistence: storage.persistence,
                titles: articles.map((item) => item.title),
                image: Array.from(image),
              };
            },
            { name },
          );
          assert.equal(reopened.persistence, initial.persistence);
          assert.deepEqual(reopened.titles, ['Café typography', 'Second story']);
          const sqlite = new NativeSqlite(Buffer.from(reopened.image));
          try {
            migrateDatabase(sqlite);
            assert.equal(sqlite.pragma('integrity_check', { simple: true }), 'ok');
            assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
            assert.equal(sqlite.prepare('SELECT count(*) AS n FROM __brew_migrations').get().n, 20);
            assert.deepEqual(
              sqlite
                .prepare("SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'quiet'")
                .all(),
              [{ rowid: 1 }],
            );
          } finally {
            sqlite.close();
          }
          await page.reload();
          const afterTermination = await page.evaluate(
            async ({ name }) => {
              const storage = await (
                await import('/runtime/index.js')
              ).openBrowserDatabase({ name });
              const count = (await storage.first('SELECT count(*) AS n FROM articles')).n;
              await storage.close();
              return count;
            },
            { name },
          );
          assert.equal(afterTermination, 2);
          if (initial.persistence === 'indexeddb') {
            const corruption = await bounded(
              'Reject and recover a corrupted IndexedDB image',
              page.evaluate(
                async ({ name }) => {
                  const database = await new Promise((resolve, reject) => {
                    const request = indexedDB.open('brew-browser-storage-v1', 1);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                  });
                  const read = () =>
                    new Promise((resolve, reject) => {
                      const request = database
                        .transaction('databases')
                        .objectStore('databases')
                        .get(name);
                      request.onsuccess = () => resolve(request.result);
                      request.onerror = () => reject(request.error);
                    });
                  const write = (record) =>
                    new Promise((resolve, reject) => {
                      const transaction = database.transaction('databases', 'readwrite');
                      transaction.objectStore('databases').put(record, name);
                      transaction.oncomplete = () => resolve();
                      transaction.onabort = () => reject(transaction.error);
                    });
                  const saved = await read();
                  try {
                    const rejected = [];
                    for (const bytes of [[], [1, 2, 3]]) {
                      await write({ ...saved, image: new Uint8Array(bytes) });
                      let error = '';
                      try {
                        await (await import('/runtime/index.js')).openBrowserDatabase({ name });
                      } catch (failure) {
                        error = failure.message;
                      }
                      rejected.push({ error, unchanged: Array.from((await read()).image), bytes });
                    }
                    await write(saved);
                    const storage = await (
                      await import('/runtime/index.js')
                    ).openBrowserDatabase({ name });
                    const restored = (await storage.first('SELECT count(*) AS n FROM articles')).n;
                    await storage.close();
                    return { rejected, restored };
                  } finally {
                    await write(saved);
                    database.close();
                  }
                },
                { name },
              ),
            );
            assert.equal(corruption.rejected.length, 2);
            for (const { error, unchanged, bytes } of corruption.rejected) {
              assert(error.length > 0);
              assert.deepEqual(unchanged, bytes);
            }
            assert.equal(corruption.restored, 2);
          }
          reports.push({
            browser: browserName,
            ...initial,
            reopen: true,
            workerTermination: true,
            secondWriterRejected: true,
            nodeRoundTrip: true,
          });
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  const profile = await mkdtemp(path.join(tmpdir(), 'brew-browser-storage-'));
  try {
    let context = await bounded(
      'Chromium persistent profile',
      chromium.launchPersistentContext(profile, { headless: true, timeout: 20_000 }),
    );
    try {
      const page = await context.newPage();
      await page.goto(origin);
      assert.equal(
        await bounded(
          'Seed persistent OPFS',
          page.evaluate(async () => {
            const storage = await (
              await import('/runtime/index.js')
            ).openBrowserDatabase({ name: 'preserved' });
            await storage.run('INSERT INTO folders(title) VALUES(?)', ['Preserved OPFS']);
            const persistence = storage.persistence;
            await storage.close();
            return persistence;
          }),
        ),
        'opfs',
      );
    } finally {
      await context.close();
    }
    context = await bounded(
      'Chromium reopened profile',
      chromium.launchPersistentContext(profile, { headless: true, timeout: 20_000 }),
    );
    try {
      const workerScript = /\/database\.worker-[^/]+\.js(?:\?|$)/;
      let intercepted = 0;
      await context.route(workerScript, async (route) => {
        const response = await route.fetch();
        intercepted++;
        await route.fulfill({
          response,
          body:
            'Object.defineProperty(globalThis, "FileSystemFileHandle", {value: undefined});\n' +
            (await response.text()),
        });
      });
      const page = await context.newPage();
      await page.goto(origin);
      const unavailable = await bounded(
        'Open unavailable OPFS and fresh fallback',
        page.evaluate(async () => {
          const { openBrowserDatabase } = await import('/runtime/index.js');
          let existingError = '';
          try {
            await openBrowserDatabase({ name: 'preserved' });
          } catch (error) {
            existingError = error.message;
          }
          const storage = await openBrowserDatabase({ name: 'fallback' });
          await storage.run('INSERT INTO folders(title) VALUES(?)', ['Fallback library']);
          const persistence = storage.persistence;
          await storage.close();
          return { existingError, persistence };
        }),
      );
      assert.match(unavailable.existingError, /OPFS library is unavailable/);
      assert.equal(unavailable.persistence, 'indexeddb');
      assert(intercepted >= 2, 'The unavailable-API environment must reach both storage workers.');
      await context.unroute(workerScript);
      const recovered = await bounded(
        'Recover both persistent libraries',
        page.evaluate(async () => {
          const { openBrowserDatabase } = await import('/runtime/index.js');
          const results = [];
          for (const name of ['preserved', 'fallback']) {
            const storage = await openBrowserDatabase({ name });
            results.push({
              persistence: storage.persistence,
              title: (await storage.first('SELECT title FROM folders')).title,
            });
            await storage.close();
          }
          return results;
        }),
      );
      assert.deepEqual(recovered, [
        { persistence: 'opfs', title: 'Preserved OPFS' },
        { persistence: 'indexeddb', title: 'Fallback library' },
      ]);
      reports.push({
        browser: 'chromium',
        automaticFallback: true,
        pinnedUnavailableBackendRejected: true,
        restoredOpfsAndIndexedDbData: true,
      });
    } finally {
      await context.close();
    }
  } finally {
    const absolute = path.resolve(profile);
    assert.equal(path.dirname(absolute), path.resolve(tmpdir()));
    assert(path.basename(absolute).startsWith('brew-browser-storage-'));
    await rm(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
assert.deepEqual(failures, []);
await writeFile('test-results/browser-storage/report.json', JSON.stringify(reports, null, 2));
process.stdout.write(
  'Built browser storage: Chromium and Firefox OPFS/IndexedDB, canonical migrations, Drizzle, FTS5, transactions, reopen/worker termination, writer locking, corruption rejection, automatic fallback/recovery and Node SQLite round-trip pass.\n',
);
