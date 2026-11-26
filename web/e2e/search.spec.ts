import { expect, test } from '@playwright/test';

test('searches with virtualized all, current-folder, and starred scopes', async ({ page }) => {
  await page.route('**/api/events', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: 'event: heartbeat\ndata: {}\n\n',
    }),
  );
  await page.route('**/api/reader/navigation', (route) =>
    route.fulfill({
      json: {
        counts: { all: 70, today: 2, starred: 1 },
        folders: [
          {
            id: 1,
            title: 'Design',
            unreadCount: 10,
            feeds: [{ id: 1, folderId: 1, title: 'Design Notes', unreadCount: 10, muted: false }],
          },
        ],
        unfiled: [],
      },
    }),
  );
  await page.route('**/api/articles?**', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route('**/api/search?**', (route) => {
    const url = new URL(route.request().url());
    const scope = url.searchParams.get('scope');
    const offset = Number(url.searchParams.get('offset'));
    const items =
      scope === 'folder'
        ? [article(201, 'Folder needle')]
        : scope === 'starred'
          ? [article(202, 'Starred needle', true)]
          : offset === 0
            ? Array.from({ length: 50 }, (_, index) =>
                article(index + 1, `Needle result ${index + 1}`),
              )
            : [article(101, 'Needle next page')];
    return route.fulfill({
      json: { items, nextOffset: scope === 'all' && offset === 0 ? 50 : null, durationMs: 2.4 },
    });
  });

  await page.goto('/');
  await page.getByRole('link', { name: /^All articles/ }).click();
  await page
    .getByRole('complementary', { name: 'Reader navigation' })
    .getByRole('link', { name: /Design/ })
    .first()
    .click();
  await page.keyboard.press('/');
  const search = page.getByLabel('Search', { exact: true });
  await expect(search).toBeFocused();
  await search.fill('needle');
  const allRequest = page.waitForRequest(
    (request) =>
      request.url().includes('/api/search?') &&
      request.url().includes('q=needle') &&
      request.url().includes('scope=all'),
  );
  await search.press('Enter');
  await allRequest;
  await expect(page.getByRole('heading', { name: '“needle”' })).toBeVisible();
  await expect(page.getByText('Needle result 1', { exact: true })).toBeVisible();
  expect(await page.getByTestId('virtual-search-results').locator('article').count()).toBeLessThan(
    35,
  );
  await page.getByTestId('virtual-search-results').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(page.getByText('Needle next page')).toBeVisible();

  const folderRequest = page.waitForRequest(
    (request) =>
      request.url().includes('/api/search?') &&
      request.url().includes('scope=folder') &&
      request.url().includes('folderId=1'),
  );
  await page.getByRole('button', { name: 'Current folder' }).click();
  await folderRequest;
  await expect(page.getByText('Folder needle')).toBeVisible();
  const starredRequest = page.waitForRequest(
    (request) => request.url().includes('/api/search?') && request.url().includes('scope=starred'),
  );
  await page.getByRole('button', { name: 'Starred', exact: true }).last().click();
  await starredRequest;
  await expect(page.getByText('Starred needle')).toBeVisible();
  await expect(page.getByText('2.4 ms')).toBeVisible();
  await page.getByRole('button', { name: 'Save search' }).click();
  const save = page.getByRole('dialog', { name: 'Save search', exact: true });
  await save.getByLabel('Saved search name', { exact: true }).fill('Needles');
  await save.getByRole('button', { name: 'Save search', exact: true }).click();
  await expect(save).not.toBeVisible();
  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(page.getByRole('heading', { name: 'Design' })).toBeVisible();
  await page.getByRole('link', { name: '⌕ Needles' }).click();
  await expect(page.getByRole('heading', { name: '“needle”', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Starred', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'More actions for saved search Needles' }).click();
  await page
    .getByRole('dialog', { name: 'Saved search “Needles”', exact: true })
    .getByRole('button', { name: 'Delete saved search', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Delete saved search “Needles”?', exact: true })
    .getByRole('button', { name: 'Delete saved search', exact: true })
    .click();
  await expect(page.getByRole('link', { name: '⌕ Needles' })).toHaveCount(0);
});

function article(id: number, title: string, starred = false) {
  return {
    id,
    url: `https://search.test/${id}`,
    title,
    author: null,
    summaryHtml: '<p>Search result summary.</p>',
    imageUrl: null,
    publishedAt: '2026-07-10T03:00:00.000Z',
    readAt: null,
    starredAt: starred ? '2026-07-10T04:00:00.000Z' : null,
    feedId: 1,
    feedTitle: 'Design Notes',
    folderId: 1,
    folderTitle: 'Design',
  };
}
