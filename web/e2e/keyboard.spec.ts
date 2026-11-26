import { expect, test } from '@playwright/test';
import { installBulkReadFixture } from './bulk-read-fixture';

test('supports the complete Reader keyboard map and cheat sheet', async ({ page }) => {
  let articleRequests = 0;
  let readAt: string | null = null;
  let starredAt: string | null = null;
  await page.route('**/api/events', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: 'event: heartbeat\ndata: {}\n\n',
    }),
  );
  await page.route('**/api/reader/navigation', (route) =>
    route.fulfill({ json: { counts: { all: 2, today: 2, starred: 0 }, folders: [], unfiled: [] } }),
  );
  await page.route('**/api/articles?**', (route) => {
    articleRequests++;
    return route.fulfill({
      json: {
        items: [summary(1, 'First keyboard story'), summary(2, 'Second keyboard story')],
        nextCursor: null,
      },
    });
  });
  await page.route('**/api/articles/*', async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { read?: boolean; starred?: boolean };
      if (body.read !== undefined) readAt = body.read ? new Date().toISOString() : null;
      if (body.starred !== undefined) starredAt = body.starred ? new Date().toISOString() : null;
    }
    return route.fulfill({ json: detail(id, readAt, starredAt) });
  });
  await page.route('**/api/tags', (route) =>
    route.fulfill({ json: [{ id: 1, name: 'Tools', color: '#b45309' }] }),
  );
  await page.route('https://example.test/**', (route) =>
    route.fulfill({ body: '<title>Original</title>' }),
  );

  await installBulkReadFixture(
    page,
    () => [
      { id: 1, readAt },
      { id: 2, readAt },
    ],
    (_id, value) => {
      readAt = value;
    },
  );
  await page.goto('/');
  await page.getByRole('link', { name: /^All articles/ }).click();
  await expect(page.getByRole('heading', { name: 'All articles' })).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('a');
  await expect(page.getByRole('heading', { name: 'All articles' })).toBeVisible();
  await expect(page.getByText('First keyboard story')).toBeVisible();
  await page.keyboard.press('j');
  await expect(page.locator('article[data-focused="true"]')).toContainText('First keyboard story');
  await page.keyboard.press('j');
  await expect(page.locator('article[data-focused="true"]')).toContainText('Second keyboard story');
  await page.keyboard.press('k');
  await expect(page.locator('article[data-focused="true"]')).toContainText('First keyboard story');

  await page.keyboard.press('1');
  await expect(page.getByRole('button', { name: 'title view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('2');
  await expect(page.getByRole('button', { name: 'magazine view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('3');
  await expect(page.getByRole('button', { name: 'cards view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Shift+A');
  await page
    .getByRole('dialog', { name: 'Mark all articles read?' })
    .getByRole('button', { name: 'Mark all read', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Marked 2 read.');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('status', { name: 'Bulk read result', exact: true })).toContainText(
    'Undid local changes.',
  );
  await expect(page.getByRole('button', { name: 'Mark all read', exact: true })).toBeFocused();

  await page.keyboard.press('o');
  await expect(page.getByRole('dialog', { name: 'Article reader' })).toBeVisible();
  await expect(page.getByLabel('Listen to First keyboard story')).toBeVisible();
  await page.getByLabel('Reader font').selectOption('serif');
  await page.getByLabel('Reader width').selectOption('wide');
  await page.getByLabel('Reader line height').selectOption('compact');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('brew:reading-prefs')))
    .toContain('compact');
  await expect(page.getByRole('button', { name: '☆ Star' })).toBeVisible();
  await page.keyboard.press('s');
  await expect(page.getByRole('button', { name: '★ Starred' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark unread' })).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Mark read' })).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByRole('button', { name: 'Mark unread' })).toBeVisible();
  await page.keyboard.press('t');
  await expect(page.getByText('Tags', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Article reader' })).toBeHidden();
  await page
    .getByRole('button', { name: 'Open article · First keyboard story', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Article reader' })).toBeVisible();
  await page.keyboard.press('Escape');

  const popupPromise = page.waitForEvent('popup');
  await page.keyboard.press('v');
  const popup = await popupPromise;
  expect(popup).toBeTruthy();
  await popup.close();
  await page.bringToFront();
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await expect(page.getByText('Next / previous article')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');

  await page.locator('body').click({ position: { x: 500, y: 500 } });
  await page.keyboard.press('g');
  await page.keyboard.press('t');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await expect(page.getByRole('heading', { name: 'The Brew' })).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('a');
  await expect(page.getByRole('heading', { name: 'All articles' })).toBeVisible();
  const beforeRefresh = articleRequests;
  await page.keyboard.press('r');
  await expect.poll(() => articleRequests).toBeGreaterThan(beforeRefresh);
});

function summary(id: number, title: string) {
  return {
    id,
    url: `https://example.test/${id}`,
    title,
    author: null,
    summaryHtml: '<p>Keyboard test summary.</p>',
    imageUrl: null,
    publishedAt: '2026-07-10T03:00:00.000Z',
    readAt: null,
    starredAt: null,
    feedId: 1,
    feedTitle: 'Keyboard feed',
    folderId: null,
    folderTitle: null,
  };
}
function detail(id: number, currentReadAt: string | null, currentStarredAt: string | null) {
  return {
    ...summary(id, id === 1 ? 'First keyboard story' : 'Second keyboard story'),
    readAt: currentReadAt,
    starredAt: currentStarredAt,
    contentHtml: '<p>Full keyboard story.</p>',
    fullTextHtml: '<p>Full keyboard story.</p>',
    enclosureUrl: 'https://example.test/episode.mp3',
    enclosureType: 'audio/mpeg',
    readTimeMinutes: 2,
    tags: [],
  };
}
