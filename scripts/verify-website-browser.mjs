/* global console, process, document */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = process.env.BREW_SITE_URL || 'http://127.0.0.1:4173';
const output = 'test-results/website';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors = [];

async function pageAt(viewport) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, page };
}

const desktop = await pageAt({ width: 1440, height: 1000 });
await desktop.page.goto(base, { waitUntil: 'networkidle' });
await desktop.page.getByRole('heading', { name: /Your feeds, brewed daily/ }).waitFor();
await desktop.page.screenshot({ path: `${output}/home-desktop.png`, fullPage: true });
await desktop.page.goto(`${base}/demo/`, { waitUntil: 'networkidle' });
await desktop.page.getByText('canned data', { exact: false }).waitFor();
await desktop.page.getByRole('heading', { name: 'Morning Brew' }).waitFor();
await desktop.page.screenshot({ path: `${output}/demo-brew.png`, fullPage: true });
await desktop.page.locator('.nav-item[data-filter="today"]').click();
await desktop.page.getByRole('heading', { name: 'Today' }).waitFor();
await desktop.page.locator('.article-row[data-id="quiet-systems"]').click();
await desktop.page.locator('.article-pane h1').waitFor();
await desktop.page.screenshot({ path: `${output}/demo-reader.png`, fullPage: false });
await desktop.page.locator('.nav-item[data-view="rules"]').click();
await desktop.page.getByRole('heading', { name: 'Rules' }).waitFor();
await desktop.page.getByRole('button', { name: 'Disable rule' }).first().click();
await desktop.page.getByText('Rule paused', { exact: true }).waitFor();
await desktop.page.getByRole('button', { name: 'Toggle dark mode' }).click();
await desktop.page.screenshot({ path: `${output}/demo-rules-dark.png`, fullPage: true });
await desktop.context.close();

const mobile = await pageAt({ width: 390, height: 844 });
await mobile.page.goto(`${base}/demo/`, { waitUntil: 'networkidle' });
await mobile.page.getByRole('button', { name: 'Open navigation' }).click();
await mobile.page.locator('.sidebar.open').waitFor();
const overflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 1) errors.push(`mobile layout overflows by ${overflow}px`);
await mobile.page.screenshot({ path: `${output}/demo-mobile.png`, fullPage: false });
await mobile.context.close();
await browser.close();

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log('Browser verification passed: home, Brew, Reader, Rules, dark theme, and mobile navigation.');
