/* global console, process, document, getComputedStyle, innerWidth */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { serveWebsite } from './lib/website-server.mjs';
import { URL } from 'node:url';
const output = 'test-results/website';
await mkdir(output, { recursive: true });
const server = process.env.BREW_SITE_URL ? null : await serveWebsite();
const bases = server
  ? [server.origin + '/', server.origin + '/brew/']
  : [process.env.BREW_SITE_URL.replace(/\/?$/, '/')];
const browser = await chromium.launch();
const manifest = JSON.parse(await readFile('website/assets.json', 'utf8'));
const slots = JSON.parse(await readFile('website/asset-slots.json', 'utf8')).slots;
const expected = [
  ['navigation', 0, 72],
  ['hero', 72, 1329],
  ['reading', 1401, 721],
  ['compose', 2122, 740],
  ['newsletters', 2862, 720],
  ['run', 3582, 825],
  ['rules', 4407, 640],
  ['agents', 5047, 629],
  ['compare', 5676, 799],
  ['open', 6475, 328],
  ['faq', 6803, 486],
  ['start', 7289, 474],
  ['footer', 7763, 274],
];
const errors = [];
const audits = [];
async function pageAt(base, viewport) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) {
      errors.push('Third-party request: ' + url);
      return route.abort();
    }
    if (!url.pathname.startsWith(new URL(base).pathname)) {
      errors.push('Request escapes site base: ' + url);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(r.status() + ' ' + r.url());
  });
  return { context, page };
}
try {
  for (const [index, base] of bases.entries()) {
    const { context, page } = await pageAt(base, { width: 1440, height: 960 });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Your feeds and newsletters, made into one calm daily paper.',
    );
    const geometry = await page
      .locator('.site-section')
      .evaluateAll((nodes) => nodes.map((n) => [n.id, n.offsetTop, n.offsetHeight]));
    assert.deepEqual(geometry, expected, 'Figma section geometry at 1440');
    const assets = await page.locator('img').evaluateAll((nodes) =>
      nodes.map((n) => ({
        file: n.getAttribute('src').replace(/^\.\//, ''),
        node: n.closest('[data-node-id]')?.getAttribute('data-node-id'),
        section: n.closest('.site-section')?.id,
        width: parseFloat(getComputedStyle(n).width),
        height: parseFloat(getComputedStyle(n).height),
        loaded: n.complete && n.naturalWidth > 0,
      })),
    );
    for (const asset of assets) {
      assert(asset.loaded, 'Unloaded ' + asset.file);
      const reference = manifest.assets.find((value) => value.file === asset.file);
      assert(reference, 'Unregistered asset ' + asset.file);
      assert(asset.node && asset.section, 'Missing design slot ' + asset.file);
      assert(
        slots.some((slot) => slot.node === asset.node && slot.file === asset.file),
        'Incorrect asset in Figma slot ' + JSON.stringify(asset),
      );
      assert(
        Math.abs(asset.width - reference.width) < 0.02 &&
          Math.abs(asset.height - reference.height) < 0.02,
        'Asset dimensions ' + JSON.stringify(asset),
      );
    }
    audits.push({ base, geometry, assets });
    await page.screenshot({ path: output + '/home-desktop-' + index + '.png', fullPage: true });
    for (const width of [1920, 2560]) {
      await page.setViewportSize({ width, height: 1080 });
      const sections = await page.locator('.site-section').evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { id: node.id, center: rect.left + rect.width / 2 };
        }),
      );
      for (const section of sections)
        assert(Math.abs(section.center - width / 2) < 1, section.id + ' is off-center at ' + width);
      await page.screenshot({ path: output + '/home-wide-' + width + '-' + index + '.png', fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert(
      (
        await page
          .getByRole('button', { name: 'Copy command', exact: true })
          .getAttribute('data-copy')
      ).startsWith('git clone https://github.com/tanzir71/brew.git'),
    );
    for (const width of [390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(overflow <= 1, 'Landing overflows ' + overflow + 'px at ' + width);
      await page.screenshot({
        path: output + '/home-' + width + '-' + index + '.png',
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('link', { name: 'Try the live demo', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Morning', exact: true })).toBeVisible();
    const point = page.locator('.brew-wordmark [data-figma-asset]').first();
    assert.deepEqual(
      await point.evaluate((n) => ({
        width: n.getBoundingClientRect().width,
        height: n.getBoundingClientRect().height,
      })),
      { width: 5, height: 10 },
    );
    await expect(page.getByText(/Live demo · canned data/)).toBeVisible();
    await page.screenshot({ path: output + '/demo-brew-' + index + '.png', fullPage: true });
    await page.getByRole('radio', { name: 'Compose', exact: true }).click();
    await expect(
      page.getByRole('complementary', { name: 'Live preview', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[role=alert]')).toHaveCount(0);
    await page.goto(base + 'demo/#/all?density=title', { waitUntil: 'networkidle' });
    await expect(page.getByRole('radio', { name: 'Titles', exact: true })).toBeChecked();
    await page.locator('summary[aria-label="Reader options"]').click();
    await page.getByLabel('Open articles', { exact: true }).selectOption('pane');
    await page.locator('summary[aria-label="Reader options"]').click();
    await page.getByRole('button', { name: /Open article · Figma’s variables panel/ }).click();
    await expect(page.getByRole('dialog', { name: 'Article reader' })).toBeVisible();
    await page.screenshot({ path: output + '/demo-reader-' + index + '.png' });
    await page.goto(base + 'demo/#/letters', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Newsletters', exact: true })).toBeVisible();
    await page.screenshot({ path: output + '/demo-letters-' + index + '.png' });
    await page.goto(base + 'demo/#/rules', { waitUntil: 'networkidle' });
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('Figma mentions');
    const toggle = page.getByRole('switch', { name: 'Enable Figma mentions', exact: true });
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(page.getByRole('heading', { name: 'Would match 1', exact: true })).toBeVisible();
    await page.screenshot({ path: output + '/demo-rules-' + index + '.png' });
    await page.getByRole('button', { name: 'Switch theme', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'dark');
    await page.screenshot({ path: output + '/demo-rules-dark-' + index + '.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Demo navigation').selectOption('/letters');
    await expect(page.getByRole('heading', { name: 'Newsletters', exact: true })).toBeVisible();
    await page.screenshot({ path: output + '/demo-mobile-' + index + '.png' });
    await context.close();
  }
} finally {
  await browser.close();
  if (server) await server.close();
}
await writeFile(output + '/figma-asset-audit.json', JSON.stringify(audits, null, 2));
assert.deepEqual(errors, []);
console.log(
  'Website browser checks passed at ' +
    bases.length +
    ' bases: Figma geometry, ' +
    audits[0].assets.length +
    ' asset callsites, responsive landing, native demo screens, rules toggles and theme; zero third-party requests or page errors.',
);
