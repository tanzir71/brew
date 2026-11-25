import { expect, test } from '@playwright/test';

test('refreshes the active list when article:new arrives over SSE', async ({ page }) => {
  let articleRequests = 0;
  let eventSent = false;
  await page.route('**/api/reader/navigation', (route) => route.fulfill({ json: { counts: { all: articleRequests > 1 ? 2 : 1, today: 0, starred: 0 }, folders: [], unfiled: [] } }));
  await page.route('**/api/articles?**', (route) => { articleRequests++; const items = [article(1, 'Already here')]; if (articleRequests > 1) items.unshift(article(2, 'Arrived live')); return route.fulfill({ json: { items, nextCursor: null } }); });
  await page.route('**/api/events', async (route) => {
    if (!eventSent) { eventSent = true; await new Promise((resolve) => setTimeout(resolve, 600)); return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: 'event: article:new\ndata: {"count":1}\n\n' }); }
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'event: heartbeat\ndata: {}\n\n' });
  });
  await page.goto('/');
  await page.getByRole('link', { name: /^All articles/ }).click();
  await page.getByRole('complementary', { name: 'Reader navigation' }).getByRole('button', { name: /^All/ }).click();
  await expect(page.getByText('Already here')).toBeVisible();
  await expect(page.getByText('Arrived live')).toBeVisible();
  expect(articleRequests).toBeGreaterThan(1);
});

function article(id: number, title: string) { return { id, title, author: null, summaryHtml: null, imageUrl: null, publishedAt: '2026-07-10T03:00:00.000Z', readAt: null, starredAt: null, feedId: 1, feedTitle: 'Live feed', folderId: null, folderTitle: null }; }
