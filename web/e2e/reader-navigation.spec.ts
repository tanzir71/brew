import { expect, test } from '@playwright/test';

test('navigates Today, All, Starred, folders, and feeds from the sidebar', async ({ page }) => {
  const states = new Map<number, ReturnType<typeof detail>>();
  await page.route('**/api/reader/navigation', (route) => route.fulfill({ json: { counts: { all: 3, today: 2, starred: 1 }, folders: [{ id: 1, title: 'Design', unreadCount: 2, feeds: [{ id: 1, folderId: 1, title: 'Design Notes', unreadCount: 2, muted: false }] }], unfiled: [] } }));
  await page.route('**/api/articles?**', (route) => {
    const url = new URL(route.request().url());
    const view = url.searchParams.get('view');
    const cursor = url.searchParams.get('cursor');
    const items = view === 'starred' ? [article(3, 'Saved essay', 'Research', true)] : view === 'today' ? [article(1, 'Fresh design story', 'Design'), article(2, 'Fresh research story', 'Research')] : cursor ? [article(999, 'Next page story', 'Design')] : Array.from({ length: 60 }, (_, index) => article(index + 10, `Library story ${index + 1}`, 'Design'));
    return route.fulfill({ json: { items, nextCursor: view === 'all' && !cursor ? '123:1' : null } });
  });
  await page.route('**/api/articles/*', async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    let value = states.get(id) ?? detail(id);
    if (route.request().method() === 'PATCH') { const body = route.request().postDataJSON() as { read?: boolean; starred?: boolean }; value = { ...value, readAt: body.read === undefined ? value.readAt : body.read ? '2026-07-10T05:00:00.000Z' : null, starredAt: body.starred === undefined ? value.starredAt : body.starred ? '2026-07-10T05:00:00.000Z' : null }; states.set(id, value); }
    return route.fulfill({ json: value });
  });
  await page.route('**/api/articles/*/full-text', (route) => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const id = Number(parts.at(-2));
    return route.fulfill({ json: { ...(states.get(id) ?? detail(id)), fullTextHtml: '<p>The complete extracted article body.</p>', readTimeMinutes: 4 } });
  });
  await page.route('**/api/articles/*/tags', async (route) => { const parts = new URL(route.request().url()).pathname.split('/'); const id = Number(parts.at(-2)); const tagIds = (route.request().postDataJSON() as { tagIds: number[] }).tagIds; const value = { ...(states.get(id) ?? detail(id)), tags: tagIds.map((tagId) => ({ id: tagId, name: tagId === 1 ? 'Tools' : 'Fresh', color: '#b45309' })) }; states.set(id, value); await route.fulfill({ json: value }); });
  await page.route('**/api/tags', async (route) => route.request().method() === 'POST' ? route.fulfill({ status: 201, json: { id: 2, name: 'Fresh', color: '#b45309' } }) : route.fulfill({ json: [{ id: 1, name: 'Tools', color: '#b45309' }] }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The Brew' })).toBeVisible();
  await page.getByRole('button', { name: /Today/ }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Design', exact: true })).toBeVisible();
  await expect(page.getByText('Fresh research story')).toBeVisible();
  await page.getByRole('button', { name: /Starred/ }).click();
  await expect(page.getByText('Saved essay')).toBeVisible();
  await page.getByRole('complementary', { name: 'Reader navigation' }).getByRole('button', { name: /Design Notes/ }).click();
  await expect(page.getByRole('heading', { name: 'Design Notes' })).toBeVisible();
  expect(await page.getByTestId('virtual-article-list').locator('article').count()).toBeLessThan(40);
  await page.getByTestId('virtual-article-list').locator('article').filter({ hasText: 'Library story 1' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Article reader' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Article 10 detail' })).toBeVisible();
  await expect(page.getByText('2 min read')).toBeVisible();
  await page.getByRole('button', { name: '☆ Star' }).click();
  await expect(page.getByRole('button', { name: '★ Starred' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Mark read' }).click();
  await expect(page.getByRole('button', { name: 'Mark unread' })).toBeVisible();
  await page.getByRole('button', { name: 'Tag' }).click();
  await page.getByRole('button', { name: 'Tools' }).click();
  await expect(page.getByRole('button', { name: 'Tag · 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Load full article' }).click();
  await expect(page.getByText('The complete extracted article body.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Article reader' })).toBeHidden();
  await page.getByLabel('Open articles').selectOption('pane');
  expect(await page.evaluate(() => localStorage.getItem('brew:article-open-mode'))).toBe('pane');
  await page.getByTestId('virtual-article-list').locator('article').filter({ hasText: 'Library story 2' }).first().click();
  const pane = page.getByRole('dialog', { name: 'Article reader' });
  await expect(pane).toBeVisible();
  expect((await pane.boundingBox())?.x).toBeGreaterThan(400);
  await expect(page.getByRole('link', { name: /View original/ })).toHaveAttribute('href', /example\.test/);
  await page.getByRole('button', { name: 'Close article' }).click();
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

function detail(id: number) {
  return { ...article(id, `Article ${id} detail`, 'Design'), url: `https://example.test/${id}`, contentHtml: '<p>Short feed content.</p>', fullTextHtml: null, readTimeMinutes: 2, tags: [] };
}
