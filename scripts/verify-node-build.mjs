import assert from 'node:assert/strict';
import { log } from 'node:console';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { createApp } from '../dist/targets/node/src/app.js';
import { openDatabase } from '../dist/targets/node/src/db/database.js';

// A built install must find migrations and the SPA outside the repository cwd.
const previousDirectory = process.cwd();
process.chdir(tmpdir());
let app;
try {
  app = await createApp({ database: openDatabase(':memory:'), serveWeb: true });
  const health = await app.inject('/api/health');
  assert.deepEqual(health.json(), { ok: true });
  const capabilities = await app.inject('/api/capabilities');
  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.json().mode, 'node');
  assert.equal(capabilities.headers['cache-control'], 'no-store');
  const page = await app.inject('/');
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  const script = page.body.match(/src="([^"]+\.js)"/)[1];
  assert.equal((await app.inject(script)).statusCode, 200);
  const route = await app.inject('/reader');
  assert.equal(route.body, page.body);
  assert.equal((await app.inject('/settings/runs')).body, page.body);
  for (const asset of ['/fonts/instrument-sans-latin.woff2', '/figma/runs/7b5f9.svg']) {
    const response = await app.inject(asset);
    assert.equal(response.statusCode, 200);
    assert.ok(response.rawPayload.byteLength > 0);
  }
  assert.equal((await app.inject('/api/missing')).statusCode, 404);
  log(
    'Built Node target: migrations, health, SPA, assets and fallback passed outside the repository cwd.',
  );
} finally {
  if (app) await app.close();
  process.chdir(previousDirectory);
}
