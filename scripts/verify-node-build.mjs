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
  assert.equal((await app.inject('/b/1/compose')).body, page.body);
  const fonts = ['instrument-sans', 'newsreader', 'geist-mono'].flatMap((name) =>
    ['latin', 'latin-ext'].map((subset) => `/fonts/${name}-${subset}.woff2`),
  );
  for (const asset of [
    ...fonts,
    '/figma/runs/7b5f9.svg',
    '/figma/icons/brew.svg',
    '/figma/components/82232.svg',
    '/figma/components/872aa.svg',
    '/figma/components/291ba.svg',
    '/figma/components/fb52b.svg',
    '/figma/compose/lead.svg',
    '/figma/compose/variables.svg',
    '/figma/compose/lines.png',
  ]) {
    const response = await app.inject(asset);
    assert.equal(response.statusCode, 200);
    assert.ok(response.rawPayload.byteLength > 0);
    if (asset.endsWith('.woff2')) {
      assert.equal(response.rawPayload.subarray(0, 4).toString(), 'wOF2');
      assert.match(response.headers['content-type'], /font\/woff2/);
    }
  }
  const composed = await app.inject({
    method: 'POST',
    url: '/api/brew-configs/composition',
    payload: {
      name: 'Build check',
      enabled: true,
      timezone: 'Asia/Dhaka',
      schedule: { kind: 'daily', time: '07:00' },
      delivery: { web: true, feed: false, publicCopy: false },
      sections: [],
    },
  });
  assert.equal(composed.statusCode, 201);
  const preview = await app.inject({
    method: 'POST',
    url: `/api/brew-configs/${composed.json().id}/preview`,
    payload: { draft: composed.json(), at: '2026-11-25T01:00:00Z' },
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().snapshot.version, 2);
  assert.match(preview.json().outputs.feed, /<feed xmlns=/);
  assert.equal((await app.inject('/api/missing')).statusCode, 404);
  log(
    'Built Node target: migrations, health, SPA, assets and fallback passed outside the repository cwd.',
  );
} finally {
  if (app) await app.close();
  process.chdir(previousDirectory);
}
