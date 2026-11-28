/* global document */
import { chromium } from '@playwright/test';
import { serveWebsite } from './lib/website-server.mjs';
const server = await serveWebsite();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    reducedMotion: 'reduce',
  });
  await page.goto(server.origin + '/brew/', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/og.png' });
} finally {
  await browser.close();
  await server.close();
}
