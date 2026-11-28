import { expect, test } from '@playwright/test';

test('discovers and adds a feed into a folder', async ({ page }) => {
  let folders: Array<{ id: number; title: string; position: number }> = [];
  let feeds: Array<{
    id: number;
    folderId: number | null;
    url: string;
    siteUrl: string | null;
    title: string;
    description: string | null;
    fetchIntervalMinutes: number;
    retentionDays: number;
    lastFetchedAt: string | null;
    lastStatus: number | null;
    consecutiveFailures: number;
    failingSince: string | null;
    healthWarning: boolean;
  }> = [];
  await page.route('**/api/folders', async (route) => {
    if (route.request().method() === 'POST') {
      folders = [{ id: 1, title: 'Design', position: 0 }];
      await route.fulfill({ status: 201, json: folders[0] });
    } else await route.fulfill({ json: folders });
  });
  await page.route('**/api/feeds/discover', (route) =>
    route.fulfill({
      json: {
        candidates: [{ url: 'https://example.test/feed.xml', title: 'Design Notes', type: 'rss' }],
      },
    }),
  );
  await page.route('**/api/feeds', async (route) => {
    if (route.request().method() === 'POST') {
      feeds = [
        {
          id: 1,
          folderId: 1,
          url: 'https://example.test/feed.xml',
          siteUrl: 'https://example.test',
          title: 'Design Notes',
          description: null,
          fetchIntervalMinutes: 30,
          retentionDays: 90,
          lastFetchedAt: null,
          lastStatus: null,
          consecutiveFailures: 0,
          failingSince: null,
          healthWarning: false,
        },
      ];
      await route.fulfill({ status: 201, json: feeds[0] });
    } else await route.fulfill({ json: feeds });
  });
  await page.route('**/api/opml/preview', (route) =>
    route.fulfill({
      json: {
        imported: 1,
        skipped: 0,
        foldersCreated: 0,
        outlines: [
          {
            title: 'Imported Journal',
            source: 'https://imported.test/feed.xml',
            folder: 'Design',
            status: 'add',
          },
        ],
      },
    }),
  );
  await page.route('**/api/actions', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    expect(route.request().postDataJSON()).toMatchObject({ kind: 'import_opml', confirm: true });
    feeds.push({
      id: 2,
      folderId: 1,
      url: 'https://imported.test/feed.xml',
      siteUrl: null,
      title: 'Imported Journal',
      description: null,
      fetchIntervalMinutes: 30,
      retentionDays: 90,
      lastFetchedAt: '2026-07-10T03:00:00.000Z',
      lastStatus: 410,
      consecutiveFailures: 12,
      failingSince: '2026-07-01T03:00:00.000Z',
      healthWarning: true,
    });
    await route.fulfill({
      json: {
        id: 1,
        kind: 'import_opml',
        targetId: null,
        imported: 1,
        skipped: 0,
        foldersCreated: 0,
        summary: 'Imported 1 feed; skipped 0 existing or duplicate feeds; created 0 folders.',
        status: 'complete',
        externalEffects: false,
        canUndo: true,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        undoneAt: null,
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('link', { name: 'Manage feeds' }).click();
  await page.getByLabel('New folder name').fill('Design');
  await page.getByRole('button', { name: 'Create folder' }).click();
  await expect(page.getByText('Design', { exact: true })).toBeVisible();
  await page.getByLabel('Feed or website URL').fill('https://example.test');
  await page.getByRole('button', { name: 'Find feed' }).click();
  await expect(page.getByText('Design Notes')).toBeVisible();
  await page.getByLabel('Save in').selectOption('1');
  await page.getByRole('button', { name: /Design Notes/ }).click();
  await expect(page.getByRole('heading', { name: 'Design Notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import OPML', exact: true })).toBeEnabled();
  await page.getByLabel('Import OPML', { exact: true }).setInputFiles({
    name: 'subscriptions.opml',
    mimeType: 'text/x-opml',
    buffer: Buffer.from(
      '<opml><body><outline text="Design"><outline text="Imported Journal" xmlUrl="https://imported.test/feed.xml"/></outline></body></opml>',
    ),
  });
  await page
    .getByRole('dialog', { name: 'Import OPML?', exact: true })
    .getByRole('button', { name: 'Import', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Action result', exact: true })).toContainText(
    'Imported 1 feed',
  );
  await expect(page.getByRole('heading', { name: 'Imported Journal' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export OPML' })).toHaveAttribute(
    'href',
    '/api/opml/export',
  );
  await page.getByRole('link', { name: 'Feed health' }).click();
  await expect(page.getByRole('heading', { name: 'Feed health' })).toBeVisible();
  await expect(page.getByText('Failing over 7 days')).toBeVisible();
  await expect(
    page
      .locator('article')
      .filter({ hasText: 'Imported Journal' })
      .getByRole('button', { name: 'Fetch now' }),
  ).toBeVisible();
});
