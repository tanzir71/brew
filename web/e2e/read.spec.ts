import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mockRead } from './read-fixture';

for (const theme of ['light', 'dark'])
  test(`Figma Read edition in ${theme}`, async ({ page }) => {
    await mockRead(page, theme);
    const remote: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:4401/')) remote.push(request.url());
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/b/1/214?selected=3');
    await expect(page.getByRole('heading', { name: 'Morning', exact: true })).toBeVisible();
    await expect(page.getByText('5 of 13 read', { exact: true })).toHaveCount(2);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await expect(page.locator('.brew-hero-image')).toHaveCSS('filter', 'none');
    await expect(page.locator('.brew-hero-image')).toHaveJSProperty('naturalWidth', 680);
    expect(
      await page.locator('.brew-hero-image').evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      })),
    ).toEqual({ width: 680, height: 340 });
    expect(
      await page.locator('.brew-magazine-image').evaluateAll((elements) =>
        elements.map((element) => ({
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        })),
      ),
    ).toEqual([
      { width: 120, height: 84 },
      { width: 120, height: 84 },
      { width: 120, height: 84 },
    ]);
    await expect(page.locator('.brew-format-link').first()).toHaveCSS(
      'font-family',
      /Instrument Sans/,
    );
    await expect(page.locator('.brew-format-link').first()).toHaveCSS('font-size', '13px');
    await expect(page.locator('.brew-format-link').first()).toHaveCSS('line-height', '19px');
    const formatGeometry = await page.locator('.brew-format-links > div').evaluateAll((rows) =>
      rows.map((row) => {
        const link = row.querySelector('a')!;
        const icon = link.querySelector('svg')!;
        return {
          height: row.getBoundingClientRect().height,
          padding: getComputedStyle(link).padding,
          icon: {
            width: icon.getBoundingClientRect().width,
            height: icon.getBoundingClientRect().height,
          },
        };
      }),
    );
    expect(formatGeometry).toEqual(
      Array.from({ length: 3 }, () => ({
        height: 29,
        padding: '5px 10px',
        icon: { width: 14, height: 14 },
      })),
    );
    await expect(page).toHaveScreenshot(`read-${theme}.png`, {
      fullPage: true,
      animations: 'disabled',
    });
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ['serious', 'critical'].includes(item.impact ?? ''),
      ),
    ).toEqual([]);
    expect(remote).toEqual([]);
  });

test('Read actions, scoped bulk undo, contents and archived editions work by keyboard', async ({
  page,
}) => {
  const fixture = await mockRead(page);
  await page.addInitScript(() => localStorage.setItem('brew:landing', 'reader'));
  await page.goto('/b/1/214');
  await expect(page.getByRole('heading', { name: 'Morning', exact: true })).toBeVisible();
  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: 'Search library' })).toBeFocused();
  const selected = page.getByRole('article', {
    name: 'Figma’s variables panel, a month in',
    exact: true,
  });
  await selected.getByRole('button', { name: fixture.items[2]!.title, exact: true }).focus();
  await expect(selected).toHaveAttribute('data-selected', 'true');
  await expect(selected.getByRole('button', { name: 'Star', exact: true })).toBeVisible();
  await selected.getByRole('button', { name: 'Star', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(selected.getByRole('button', { name: 'Starred', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await selected.getByRole('button', { name: 'Mark read', exact: true }).click();
  await expect(selected).toHaveAttribute('data-brew-state', 'read starred highlighted');
  await expect(page.getByRole('progressbar', { name: 'Brew reading progress' })).toHaveAttribute(
    'value',
    '6',
  );
  await page
    .getByRole('region', { name: 'Design & craft' })
    .getByRole('button', { name: 'Mark section read' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Mark Design & craft read?' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark 2 read', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Bulk read result', exact: true })).toContainText(
    'Marked 2 read.',
  );
  expect(fixture.state.articles.filter((item) => item.readAt)).toHaveLength(8);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '6');
  await page
    .getByRole('navigation', { name: 'Brew contents' })
    .getByRole('link', { name: /^Engineering/ })
    .click();
  await expect(page).toHaveURL(/#section-engineering$/);
  await page.getByRole('button', { name: 'Read yesterday’s' }).click();
  await expect(page).toHaveURL('/b/1/213');
  await page.reload();
  await expect(page.getByText(/No\. 213$/)).toBeVisible();
  await page.getByRole('button', { name: 'Next Brew', exact: true }).click();
  await expect(page).toHaveURL('/b/1/214');
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '6');
});

test('failed mutations keep read state, retry recovers, and unavailable formats stay visible', async ({
  page,
}) => {
  const fixture = await mockRead(page);
  await page.goto('/b/1/214?selected=3');
  const item = page.getByRole('article', { name: fixture.items[2]!.title });
  fixture.failUpdates(true);
  await item.getByRole('button', { name: 'Mark read', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Could not update article. Try again.' }),
  ).toBeVisible();
  await expect(item).toHaveAttribute('data-brew-state', 'unread highlighted');
  fixture.failUpdates(false);
  await item.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Article reader' })).toBeVisible();
  await page.getByRole('button', { name: 'Close article' }).click();
  await expect(item).toHaveAttribute('data-brew-state', 'read highlighted');
  for (const name of ['Markdown', 'JSON', 'Atom feed'])
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await page.route('**/api/brews/*/state', (route) => route.fulfill({ status: 503 }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Live article state is unavailable.');
  await expect(item.getByRole('button', { name: 'Star', exact: true })).toBeDisabled();
  await page.unroute('**/api/brews/*/state');
  await page.route('**/api/brews/*/state', (route) => route.fulfill({ json: fixture.state }));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(item.getByRole('button', { name: 'Star', exact: true })).toBeEnabled();
  const readsBeforeBulk = fixture.state.articles.map((article) => ({
    id: article.id,
    readAt: article.readAt,
  }));
  await page
    .getByRole('region', { name: 'Design & craft' })
    .getByRole('button', { name: 'Mark section read' })
    .click();
  await page.getByRole('button', { name: 'Mark 2 read', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await item.getByRole('button', { name: 'Star', exact: true }).click();
  await expect(item.getByRole('button', { name: 'Starred', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Bulk read result', exact: true })).toContainText(
    'Undid local changes.',
  );
  expect(
    fixture.state.articles.map((article) => ({ id: article.id, readAt: article.readAt })),
  ).toEqual(readsBeforeBulk);
  await expect(item.getByRole('button', { name: 'Starred', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('image privacy handles stored proxy URLs and requires explicit direct-image opt-in', async ({
  page,
}) => {
  const fixture = await mockRead(page);
  // Ingestion already proxies thumbnail URLs. Direct images require an explicit choice.
  const original = 'https://images.example.test/story.svg';
  const proxy = `/api/img?src=${encodeURIComponent(original)}`;
  fixture.items[0]!.imageUrl = proxy;
  const artwork = await readFile(
    new URL('../../packages/web/public/figma/read/lead-light.svg', import.meta.url),
  );
  const originalRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url() === original) originalRequests.push(request.url());
  });
  await page.route('**/api/img?src=**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: artwork }),
  );
  await page.route(original, (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: artwork }),
  );
  await page.goto('/b/1/214');
  await expect(page.locator('.brew-hero-image')).toHaveAttribute('src', proxy);
  expect(originalRequests).toEqual([]);
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('combobox', { name: 'Image privacy', exact: true }).selectOption('direct');
  await expect(page.locator('.brew-hero-image')).toHaveAttribute('src', original);
  await expect.poll(() => originalRequests.length).toBe(1);
  await page.getByRole('combobox', { name: 'Image privacy', exact: true }).selectOption('proxy');
  await expect(page.locator('.brew-hero-image')).toHaveAttribute('src', proxy);
  expect(originalRequests).toHaveLength(1);
});
