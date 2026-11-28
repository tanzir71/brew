import { expect, test } from '@playwright/test';

test('a late preview preserves the rule save confirmation', async ({ page }) => {
  let releasePreview!: () => void;
  let previewStarted!: () => void;
  const blocked = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  const started = new Promise<void>((resolve) => {
    previewStarted = resolve;
  });
  let saved: unknown[] = [];
  await page.route('**/api/reader/navigation', (route) =>
    route.fulfill({
      json: {
        counts: { all: 0, today: 0, starred: 0 },
        folders: [],
        unfiled: [],
      },
    }),
  );
  await page.route('**/api/rules/duplicate-filter', (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.route('**/api/rules', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: saved });
    const rule = { ...route.request().postDataJSON(), id: 1 };
    saved = [rule];
    return route.fulfill({ status: 201, json: rule });
  });
  await page.route('**/api/rules/preview*', async (route) => {
    if (route.request().postDataJSON().conditions[0]?.value !== 'spam')
      return route.fulfill({ json: { items: [], total: 0, limit: 50 } });
    previewStarted();
    await blocked;
    await route.fulfill({
      json: {
        total: 1,
        limit: 50,
        items: [
          {
            id: 1,
            title: 'Late preview result',
            feedTitle: 'Design Notes',
            publishedAt: '2026-11-25T00:00:00.000Z',
          },
        ],
      },
    });
  });
  await page.goto('/?view=rules');
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: 'Mute keyword' }).click();
  await page.getByLabel('Condition 1 value').fill('spam');
  await started;
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByRole('status', { name: 'Rule editor result' })).toHaveText('Rule saved.');
  releasePreview();
  await expect(page.getByRole('heading', { name: 'Late preview result' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Rule editor result' })).toHaveText('Rule saved.');
});
