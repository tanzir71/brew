import { expect, test } from '@playwright/test';

test('navigates Today, All, Starred, folders, and feeds from the sidebar', async ({ page }) => {
  await page.route('**/api/reader/navigation', (route) => route.fulfill({ json: { counts: { all: 3, today: 2, starred: 1 }, folders: [{ id: 1, title: 'Design', unreadCount: 2, feeds: [{ id: 1, folderId: 1, title: 'Design Notes', unreadCount: 2, muted: false }] }], unfiled: [] } }));
  await page.route('**/api/articles?**', (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view');
    const items = view === 'starred' ? [article(3, 'Saved essay', 'Research', true)] : view === 'today' ? [article(1, 'Fresh design story', 'Design'), article(2, 'Fresh research story', 'Research')] : [article(1, 'Fresh design story', 'Design')];
    return route.fulfill({ json: items });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The Brew' })).toBeVisible();
  await page.getByRole('button', { name: /Today/ }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Design', exact: true })).toBeVisible();
  await expect(page.getByText('Fresh research story')).toBeVisible();
  await page.getByRole('button', { name: /Starred/ }).click();
  await expect(page.getByText('Saved essay')).toBeVisible();
  await page.getByRole('button', { name: /Design Notes/ }).click();
  await expect(page.getByRole('heading', { name: 'Design Notes' })).toBeVisible();
});

function article(id: number, title: string, folderTitle: string, starred = false) {
  return { id, title, author: null, summaryHtml: null, imageUrl: null, publishedAt: '2026-07-10T03:00:00.000Z', readAt: null, starredAt: starred ? '2026-07-10T04:00:00.000Z' : null, feedId: 1, feedTitle: 'Design Notes', folderId: 1, folderTitle };
}
