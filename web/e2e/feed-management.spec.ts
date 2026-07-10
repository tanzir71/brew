import { expect, test } from '@playwright/test';

test('discovers and adds a feed into a folder', async ({ page }) => {
  let folders: Array<{ id: number; title: string; position: number }> = [];
  let feeds: Array<{ id: number; folderId: number | null; url: string; siteUrl: string | null; title: string; description: string | null }> = [];
  await page.route('**/api/folders', async (route) => {
    if (route.request().method() === 'POST') { folders = [{ id: 1, title: 'Design', position: 0 }]; await route.fulfill({ status: 201, json: folders[0] }); }
    else await route.fulfill({ json: folders });
  });
  await page.route('**/api/feeds/discover', (route) => route.fulfill({ json: { candidates: [{ url: 'https://example.test/feed.xml', title: 'Design Notes', type: 'rss' }] } }));
  await page.route('**/api/feeds', async (route) => {
    if (route.request().method() === 'POST') { feeds = [{ id: 1, folderId: 1, url: 'https://example.test/feed.xml', siteUrl: 'https://example.test', title: 'Design Notes', description: null }]; await route.fulfill({ status: 201, json: feeds[0] }); }
    else await route.fulfill({ json: feeds });
  });
  await page.route('**/api/opml/import', async (route) => {
    feeds.push({ id: 2, folderId: 1, url: 'https://imported.test/feed.xml', siteUrl: null, title: 'Imported Journal', description: null });
    await route.fulfill({ json: { imported: 1, skipped: 0, foldersCreated: 0 } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage feeds' }).click();
  await page.getByLabel('New folder name').fill('Design');
  await page.getByRole('button', { name: 'Create folder' }).click();
  await expect(page.getByText('Design', { exact: true })).toBeVisible();
  await page.getByLabel('Feed or website URL').fill('https://example.test');
  await page.getByRole('button', { name: 'Find feed' }).click();
  await expect(page.getByText('Design Notes')).toBeVisible();
  await page.getByLabel('Save in').selectOption('1');
  await page.getByRole('button', { name: /Design Notes/ }).click();
  await expect(page.getByRole('heading', { name: 'Design Notes' })).toBeVisible();
  await page.getByLabel('Import OPML').setInputFiles({ name: 'subscriptions.opml', mimeType: 'text/x-opml', buffer: Buffer.from('<?xml version="1.0"?><opml version="2.0"><body/></opml>') });
  await expect(page.getByText('Imported 1 feeds.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Imported Journal' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Export OPML' })).toHaveAttribute('href', '/api/opml/export');
});
