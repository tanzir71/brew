import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Capabilities } from '../../shared/capabilities';

const cloud: Capabilities = {
  mode: 'cloudflare',
  fetch: 'direct',
  backgroundFetch: { kind: 'cron', everyMinutes: 15 },
  inboundMail: 'cloudflare-email',
  emailDelivery: null,
  readerApi: true,
  mcp: 'http',
  webmcp: false,
  ai: { available: ['workers-ai', 'byo'], configured: false },
  readState: 'server',
  publicCopy: true,
  limits: { maxFetchesPerRun: 40 },
};
async function library(page: Page) {
  await page.route('**/api/brew-configs', (route) =>
    route.fulfill({
      json: [
        { id: 1, name: 'Morning' },
        { id: 2, name: 'Weekend' },
      ],
    }),
  );
  await page.route('**/api/reader/navigation', (route) =>
    route.fulfill({
      json: {
        counts: { today: 34, all: 312, starred: 9 },
        folders: [
          { id: 1, title: 'Design', unreadCount: 18, feeds: [] },
          { id: 2, title: 'Engineering', unreadCount: 41, feeds: [] },
          { id: 3, title: 'Independent', unreadCount: 7, feeds: [] },
          { id: 4, title: 'Video', unreadCount: 5, feeds: [] },
        ],
        unfiled: [],
      },
    }),
  );
  await page.addInitScript(() =>
    localStorage.setItem(
      'brew:saved-searches',
      JSON.stringify([{ id: 'figma', name: 'Figma mentions', query: 'figma' }]),
    ),
  );
}

for (const theme of ['light', 'dark'] as const)
  test(`Where Brew runs matches the Figma layout in ${theme}`, async ({ page }) => {
    await library(page);
    await page.route('**/api/capabilities', (route) => route.fulfill({ json: cloud }));
    await page.addInitScript((value) => localStorage.setItem('brew:theme', value), theme);
    await page.setViewportSize({ width: 1440, height: 1080 });
    const remote: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== 'http://127.0.0.1:4401') remote.push(request.url());
    });
    await page.goto('/settings/runs');
    await expect(page.getByRole('heading', { name: 'Cloudflare Workers' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cloudflare · Where Brew runs' })).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Capabilities' }).locator('[data-brew-kind="capability"]'),
    ).toHaveCount(7);
    await expect(page.getByRole('link', { name: 'Set up Emailing your Brew' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export .brew file' })).toBeDisabled();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`where-brew-runs-${theme}.png`, {
      fullPage: true,
      animations: 'disabled',
    });
    const assets = await page.locator('.runs-app img').evaluateAll((images) =>
      images.map((image) => {
        const element = image as HTMLImageElement;
        const rect = element.getBoundingClientRect();
        return {
          loaded: element.complete && element.naturalWidth > 0,
          native:
            element.naturalWidth === Math.round(rect.width) &&
            element.naturalHeight === Math.round(rect.height),
        };
      }),
    );
    expect(assets.every((asset) => asset.loaded && asset.native)).toBe(true);
    expect(remote).toEqual([]);
    const audit = await new AxeBuilder({ page }).analyze();
    expect(
      audit.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
    ).toEqual([]);
  });

test('the real Node Mode chip opens URL-addressable settings and keyboard setup guidance', async ({
  page,
}) => {
  await page.goto('/?view=reader');
  await page.getByRole('link', { name: 'Node · Where Brew runs' }).click();
  await expect(page).toHaveURL(/\/settings\/runs$/);
  await expect(page.getByRole('heading', { name: 'Node / Docker' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Newsletters/ })).toBeDisabled();
  const setup = page.getByRole('link', { name: 'Set up Emailing your Brew' });
  await setup.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#setup-delivery$/);
  await expect(page.getByRole('dialog', { name: 'Emailing your Brew' })).toBeVisible();
  const audit = await new AxeBuilder({ page }).analyze();
  expect(
    audit.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/settings\/runs$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Where Brew runs' })).toBeVisible();
});

test('browser limits stay visible and failed capability loads recover without enabling stale controls', async ({
  page,
}) => {
  let failing = true;
  await page.route('**/api/capabilities', (route) =>
    failing
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: {
            ...cloud,
            mode: 'browser',
            fetch: 'relay',
            backgroundFetch: { kind: 'while-open' },
            inboundMail: 'email-to-feed',
            emailDelivery: null,
            readerApi: false,
            mcp: null,
            readState: 'local',
            publicCopy: false,
          },
        }),
  );
  await page.goto('/settings/runs');
  await expect(page.getByRole('alert')).toContainText('Could not check where Brew runs');
  await expect(
    page.getByRole('region', { name: 'Capabilities' }).getByText('Unavailable', { exact: true }),
  ).toHaveCount(7);
  failing = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'This browser' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Capabilities' }).getByText('Server modes', { exact: true }),
  ).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Set up Emailing your Brew' })).toBeVisible();
});
