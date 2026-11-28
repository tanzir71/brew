/* global console, process, document */
import { chromium } from '@playwright/test';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const output = 'test-results/website';
await mkdir(output, { recursive: true });
const root = fileURLToPath(new URL('../docs/', import.meta.url));
let server;
let bases;
if (process.env.BREW_SITE_URL) bases = [process.env.BREW_SITE_URL.replace(/\/?$/, '/')];
else {
  server = createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.startsWith('/brew/')) pathname = pathname.slice('/brew'.length);
      let file = path.resolve(root, '.' + pathname);
      if (file !== path.resolve(root) && !file.startsWith(path.resolve(root) + path.sep))
        throw new Error('Invalid path');
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const types = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.svg': 'image/svg+xml',
        '.txt': 'text/plain',
      };
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  bases = [base + '/', base + '/brew/'];
}
const browser = await chromium.launch();
const errors = [];
async function pageAt(viewport, base) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().startsWith(base) && response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  return { context, page };
}
try {
  for (const [index, base] of bases.entries()) {
    const desktop = await pageAt({ width: 1440, height: 1000 }, base);
    await desktop.page.goto(base, { waitUntil: 'networkidle' });
    await desktop.page.getByRole('heading', { name: /Your feeds, brewed daily/ }).waitFor();
    await desktop.page.screenshot({ path: `${output}/home-desktop-${index}.png`, fullPage: true });
    await desktop.page.getByRole('link', { name: /^Open demo/ }).click();
    const demo = new URL('demo/', base);
    await desktop.page.waitForURL(
      (url) =>
        url.origin === demo.origin &&
        url.pathname.replace(/\/$/, '') === demo.pathname.replace(/\/$/, ''),
    );
    await desktop.page.getByText('canned data', { exact: false }).waitFor();
    await desktop.page.getByRole('heading', { name: 'Morning', exact: true }).waitFor();
    await desktop.page.screenshot({ path: `${output}/demo-brew-${index}.png`, fullPage: true });
    await desktop.page.locator('.nav-item[data-filter="today"]').click();
    await desktop.page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
    await desktop.page.locator('.article-row[data-id="quiet-systems"]').click();
    await desktop.page.locator('.article-pane h1').waitFor();
    await desktop.page.screenshot({ path: `${output}/demo-reader-${index}.png`, fullPage: false });
    await desktop.page.locator('.nav-item[data-view="rules"]').click();
    await desktop.page.getByRole('heading', { name: 'Rules', exact: true }).waitFor();
    await desktop.page.getByRole('button', { name: 'Disable rule' }).first().click();
    await desktop.page.getByText('Rule paused', { exact: true }).waitFor();
    await desktop.page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await desktop.page.screenshot({
      path: `${output}/demo-rules-dark-${index}.png`,
      fullPage: true,
    });
    await desktop.context.close();
    const mobile = await pageAt({ width: 390, height: 844 }, base);
    await mobile.page.goto(demo.href, { waitUntil: 'networkidle' });
    await mobile.page.getByRole('button', { name: 'Open navigation' }).click();
    await mobile.page.locator('.sidebar.open').waitFor();
    const overflow = await mobile.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 1) errors.push(`mobile layout overflows by ${overflow}px`);
    await mobile.page.screenshot({ path: `${output}/demo-mobile-${index}.png`, fullPage: false });
    await mobile.context.close();
  }
} finally {
  await browser.close();
  if (server)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
}
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log(
  `Browser verification passed at ${bases.length} site base(s): home, Brew, Reader, Rules, dark theme and mobile navigation; zero failed assets.`,
);
