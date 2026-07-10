import { expect, test } from '@playwright/test';

test('navigates Today, All, Starred, folders, and feeds from the sidebar', async ({ page }) => {
  await page.route('**/api/reader/navigation', (route) => route.fulfill({ json: { counts: { all: 3, today: 2, starred: 1 }, folders: [{ id: 1, title: 'Design', unreadCount: 2, feeds: [{ id: 1, folderId: 1, title: 'Design Notes', unreadCount: 2, muted: false }] }], unfiled: [] } }));
  await page.route('**/api/articles?**', (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view');
    const cursor = url.searchParams.get('cursor');
    const items = view === 'starred' ? [article(3, 'Saved essay', 'Research', true)] : view === 'today' ? [article(1, 'Fresh design story', 'Design'), article(2, 'Fresh research story', 'Research')] : cursor ? [article(999, 'Next page story', 'Design')] : Array.from({ length: 60 }, (_, index) => article(index + 10, `Library story ${index + 1}`, 'Design'));
    return route.fulfill({ json: { items, nextCursor: view === 'all' && !cursor ? '123:1' : null } });
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
  expect(await page.getByTestId('virtual-article-list').locator('article').count()).toBeLessThan(40);
  await page.getByTestId('virtual-article-list').evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await expect(page.getByText('Next page story')).toBeVisible();
  await page.getByRole('button', { name: 'cards view' }).click();
  await expect(page.getByRole('button', { name: 'cards view' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('brew:density:feed:1'))).toBe('cards');
  const unreadRequest = page.waitForRequest((request) => request.url().includes('/api/articles?') && request.url().includes('unread=true'));
  await page.getByRole('button', { name: 'Unread' }).click();
  await unreadRequest;
  const oldestRequest = page.waitForRequest((request) => request.url().includes('/api/articles?') && request.url().includes('sort=oldest'));
  await page.getByLabel('Sort articles').selectOption('oldest');
  await oldestRequest;
});

function article(id: number, title: string, folderTitle: string, starred = false) {
  return { id, title, author: null, summaryHtml: null, imageUrl: null, publishedAt: '2026-07-10T03:00:00.000Z', readAt: null, starredAt: starred ? '2026-07-10T04:00:00.000Z' : null, feedId: 1, feedTitle: 'Design Notes', folderId: 1, folderTitle };
}
