/* global window, document, fetch */
import { URL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, expect } from '@playwright/test';

const root = path.resolve('docs/browser');
const output = process.env.BREW_BROWSER_APP_REPORT_DIR ?? 'test-results/browser-app';
const prefix = '/brew/browser/';
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};
const misses = [];
const reports = [];
const failures = [];
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    assert(url.pathname.startsWith(prefix));
    const file = path.resolve(root, url.pathname.slice(prefix.length) || 'index.html');
    assert(file.startsWith(root + path.sep));
    response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch {
    misses.push(request.url);
    response.writeHead(404);
    response.end('Missing static asset');
  }
});
await mkdir(output, { recursive: true });
const design = JSON.parse(await readFile('design/first-run-assets.json', 'utf8'));
for (const asset of design.assets) {
  const bytes = await readFile(path.join('packages/web/public', asset.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.file);
  assert.deepEqual(
    await readFile(path.join(root, asset.file)),
    bytes,
    'Built original Figma export ' + asset.file,
  );
  const svg = bytes.toString('utf8').match(/<svg\b[^>]*>/)?.[0];
  for (const dimension of ['width', 'height'])
    assert.equal(
      Number(svg?.match(new RegExp(dimension + '="([\\d.]+)"'))?.[1]),
      asset[dimension],
      asset.file + ' ' + dimension,
    );
}
assert.equal(
  createHash('sha256')
    .update(await readFile('packages/web/public/figma/components/fb52b.svg'))
    .digest('hex'),
  design.assets.find((asset) => asset.export === 'fb52b.svg').sha256,
  'Reuse the original shared wordmark point',
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
async function api(page, url, method = 'GET', value) {
  return page.evaluate(
    async ({ url, method, value }) => {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: value === undefined ? undefined : JSON.stringify(value),
      });
      return { status: response.status, value: await response.json() };
    },
    { url, method, value },
  );
}
async function imagesLoaded(page) {
  assert((await page.locator('.brew-edition img').count()) >= 4);
  await expect
    .poll(() =>
      page
        .locator('.brew-edition img')
        .evaluateAll((images) =>
          images
            .filter((image) => !image.complete || !image.naturalWidth)
            .map((image) => image.getAttribute('src')),
        ),
    )
    .toEqual([]);
}
try {
  for (const [name, type] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ]) {
    if (process.env.BREW_BROWSER_TEST_BROWSER && process.env.BREW_BROWSER_TEST_BROWSER !== name)
      continue;
    // The local Firefox build intermittently starts with neither WASM compiler enabled.
    // Explicitly enable the engines required by SQLite; these preferences do not change the app.
    const browser = await type.launch(
      name === 'firefox'
        ? {
            firefoxUserPrefs: {
              'javascript.options.wasm_baselinejit': true,
              'javascript.options.wasm_optimizingjit': true,
            },
          }
        : {},
    );
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    const remote = new Set();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    context.on('request', (request) => {
      if (!request.url().startsWith(origin) && /^https?:/.test(request.url()))
        remote.add(request.url());
    });
    const report = { name, checks: [] };
    reports.push(report);
    try {
      const started = Date.now();
      await page.goto(origin + prefix);
      await page
        .getByRole('heading', { name: 'Where should Brew run?' })
        .waitFor({ timeout: 10000 });
      await page.evaluate(() => document.fonts.ready);
      const actions = await page
        .locator('.first-run-cta')
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().bottom),
        );
      assert(
        Math.max(...actions) - Math.min(...actions) < 1,
        'Mode card actions must be bottom aligned',
      );
      await page.screenshot({
        path: path.join(output, `${name}-first-run-light.png`),
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Start here', exact: true }).click();
      await page.getByRole('heading', { name: 'Morning', exact: true }).waitFor({ timeout: 10000 });
      report.coldStartMs = Date.now() - started;
      assert(
        report.coldStartMs < 10000,
        'Cold first-run navigation and Start here exceed ten seconds',
      );
      await imagesLoaded(page);
      const initial = await api(page, '/api/browser/start');
      assert.equal(initial.status, 200);
      assert(initial.value.ready);
      const caps = await api(page, '/api/capabilities');
      assert.equal(caps.value.mode, 'browser');
      assert.equal(caps.value.backgroundFetch.kind, 'while-open');
      assert.equal(caps.value.inboundMail, 'email-to-feed');
      assert.equal(caps.value.emailDelivery, null);
      assert.equal(caps.value.fetchConfigured, false);
      assert.equal(caps.value.readerApi, false);
      assert.equal(caps.value.mcp, null);
      assert.equal(caps.value.webmcp, false);
      const articles = await api(page, '/api/articles?limit=50');
      assert.equal(articles.value.items.length, 13);
      assert.equal((await api(page, '/api/feeds')).value.length, 3);
      assert.deepEqual((await api(page, '/api/browser/start', 'POST')).value, initial.value);
      assert.equal((await api(page, '/api/articles?limit=50')).value.items.length, 13);
      report.checks.push('cold start, real samples, original images, capabilities and idempotence');
      for (const theme of ['light', 'dark']) {
        await page.evaluate(
          (theme) => (document.documentElement.dataset.resolvedTheme = theme),
          theme,
        );
        await page.screenshot({
          path: path.join(output, `${name}-brew-${theme}.png`),
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          'Phone Brew overflows the viewport',
        );
        await page.screenshot({
          path: path.join(output, `${name}-phone-${theme}.png`),
          fullPage: true,
        });
        await page.setViewportSize({ width: 1440, height: 960 });
      }
      await page.evaluate(() => (document.documentElement.dataset.resolvedTheme = 'light'));
      const markdown = page.getByRole('link', { name: 'Markdown', exact: true }).first();
      assert((await markdown.getAttribute('href')).includes(prefix + '__local/'));
      const twin = await context.newPage();
      await twin.goto(await markdown.getAttribute('href'));
      assert(
        (await twin.locator('body').innerText()).includes(
          'The quiet structure behind interfaces that feel inevitable',
        ),
      );
      await twin.close();
      assert(
        (await page.locator('link[rel="alternate"]').first().getAttribute('href')).includes(
          prefix + '__local/',
        ),
      );
      await page.getByRole('radio', { name: 'Compose', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Compose', exact: true })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expect(page.locator('.compose-paper')).toBeVisible();
      await page.getByRole('radio', { name: 'Email', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Email', exact: true })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expect
        .poll(() =>
          page
            .frameLocator('iframe[title="Email preview"]')
            .locator('img')
            .evaluateAll((images) =>
              images.every((image) => image.complete && image.naturalWidth > 0),
            ),
        )
        .toBe(true);
      await page.getByRole('radio', { name: 'Read', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Morning', exact: true })).toBeVisible({
        timeout: 10000,
      });
      report.checks.push('portable text links and real Compose/Email preview');
      const id = articles.value.items[0].id;
      const target = { kind: 'items', ids: [id] };
      const preview = await api(page, '/api/actions/mark-read/preview', 'POST', target);
      assert.equal(preview.status, 200);
      const receipt = await api(page, '/api/actions', 'POST', {
        kind: 'mark_read',
        target,
        revision: preview.value.revision,
        confirm: true,
        requestId: name + '-mark-read',
      });
      assert.equal(receipt.status, 200);
      assert.equal(receipt.value.status, 'complete');
      assert((await api(page, '/api/articles/' + id)).value.readAt);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Morning', exact: true })).toBeVisible();
      assert((await api(page, '/api/articles/' + id)).value.readAt);
      assert.equal(
        (await api(page, '/api/actions/' + receipt.value.id + '/undo', 'POST')).status,
        200,
      );
      assert.equal((await api(page, '/api/articles/' + id)).value.readAt, null);
      report.checks.push('persistent SQL writes, action journal and Undo after reload');
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByRole('heading', { name: 'Where Brew runs', exact: true }).waitFor();
      const row = page.locator('[data-capability="fetch"]');
      await row.getByRole('link', { name: 'Set up Feeds and full text', exact: true }).click();
      await page
        .getByRole('textbox', { name: 'Relay URL', exact: true })
        .fill('https://relay.example.test/');
      await page
        .getByLabel('Relay token', { exact: true })
        .fill('browser-app-test-token-1234567890123456');
      await page.getByRole('button', { name: 'Save relay', exact: true }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Relay settings saved.' }),
      ).toBeVisible();
      const relay = await api(page, '/api/browser/relay');
      assert.deepEqual(relay.value, { endpoint: 'https://relay.example.test/', configured: true });
      assert.equal((await api(page, '/api/capabilities')).value.fetchConfigured, true);
      await page.getByRole('button', { name: 'Save relay', exact: true }).click();
      assert.deepEqual((await api(page, '/api/browser/relay')).value, relay.value);
      await page.getByRole('button', { name: 'Disconnect relay', exact: true }).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'Relay disconnected.' }),
      ).toBeVisible();
      assert.equal((await api(page, '/api/feeds')).value.length, 3);
      assert.equal((await api(page, '/api/capabilities')).value.fetchConfigured, false);
      report.checks.push('accessible relay setup, redaction, saved-token retention and disconnect');
      if (name === 'chromium') {
        const cdp = await context.newCDPSession(page);
        await cdp.send('ServiceWorker.enable');
        await cdp.send('ServiceWorker.stopAllWorkers');
        assert.equal((await api(page, '/api/health')).status, 200);
        await cdp.detach();
        report.checks.push('service worker owner recovery after idle termination');
      }
      assert.deepEqual(errors, []);
      assert.deepEqual([...remote], []);
      await context.close();
      const firstRunContext = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        reducedMotion: 'reduce',
      });
      const firstRun = await firstRunContext.newPage();
      await firstRun.goto(origin + prefix);
      await firstRun.getByRole('heading', { name: 'Where should Brew run?' }).waitFor();
      await firstRun.evaluate(() => document.fonts.ready);
      for (const theme of ['light', 'dark']) {
        await firstRun.evaluate(
          (theme) => (document.documentElement.dataset.resolvedTheme = theme),
          theme,
        );
        await firstRun.screenshot({
          path: path.join(output, `${name}-first-run-${theme}.png`),
          fullPage: true,
        });
        await firstRun.setViewportSize({ width: 390, height: 844 });
        assert(
          await firstRun.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        );
        await firstRun.screenshot({
          path: path.join(output, `${name}-first-run-phone-${theme}.png`),
          fullPage: true,
        });
        await firstRun.setViewportSize({ width: 1440, height: 960 });
      }
      await firstRunContext.close();
      report.checks.push(
        'original Figma vectors, shared wordmark, first-run light/dark and phone geometry',
      );
    } catch (error) {
      report.error = error.stack;
      report.debug = await page.evaluate(() => ({
        url: window.location.href,
        controller: window.navigator.serviceWorker.controller?.scriptURL ?? null,
        text: document.body.innerText.slice(0, 500),
        marks: window.performance
          .getEntriesByType('mark')
          .map((entry) => ({ name: entry.name, at: entry.startTime })),
      }));
      report.errors = errors;
      report.remote = [...remote];
      failures.push(name + ': ' + error.message);
      await page
        .screenshot({ path: path.join(output, name + '-failure.png'), fullPage: true })
        .catch(() => {});
    } finally {
      await browser.close();
    }
    process.stdout.write(JSON.stringify(report) + '\n');
  }
  assert.deepEqual(
    misses,
    [],
    'Every API request must use the live library, every static asset must exist',
  );
  assert.deepEqual(failures, []);
} finally {
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify({ reports, misses, failures }, null, 2),
  );
  await new Promise((resolve) => server.close(resolve));
}
