import { expect, test, type Page } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  for (const density of ['title', 'magazine', 'cards'] as const) {
    test(`Reader ${density} density in ${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await mockReader(page);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/');
      await page.getByRole('link', { name: /^All articles/ }).click();
      await page.getByLabel('Theme').selectOption(theme);
      await page.getByRole('complementary', { name: 'Reader navigation' }).getByRole('button', { name: /^All/ }).click();
      await page.getByRole('button', { name: `${density} view` }).click();
      await expect(page.getByText('Designing a calmer feed')).toBeVisible();
      await page.evaluate(async () => { await document.fonts.ready; for (const animation of document.getAnimations()) if (animation.effect?.getTiming().iterations !== Infinity) animation.finish(); });
      await expect(page).toHaveScreenshot(`reader-${density}-${theme}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
    });
  }
}

test('Reader view navigation paints within 100ms', async ({ page }) => {
  await mockReader(page);
  await page.goto('/');
  await page.getByRole('link', { name: /^All articles/ }).click();
  await page.getByRole('complementary', { name: 'Reader navigation' }).getByRole('button', { name: /^Today/ }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const duration = await page.evaluate(async () => {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent?.includes('All'));
    if (!(button instanceof HTMLButtonElement)) throw new Error('All button not found');
    const start = performance.now(); button.click();
    while (![...document.querySelectorAll('h1')].some((heading) => heading.textContent === 'All articles')) await new Promise(requestAnimationFrame);
    return performance.now() - start;
  });
  expect(duration).toBeLessThan(100);
});

async function mockReader(page: Page) {
  await page.route('**/api/feeds/*/icon',(route)=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" rx="4" fill="#f59e0b"/></svg>'}));
  await page.route('**/api/events', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'event: heartbeat\ndata: {}\n\n' }));
  await page.route('**/api/reader/navigation', (route) => route.fulfill({ json: { counts: { all: 8, today: 5, starred: 2 }, folders: [{ id: 1, title: 'Design', unreadCount: 5, feeds: [{ id: 1, folderId: 1, title: 'Design Notes', unreadCount: 5, muted: false }, { id: 2, folderId: 1, title: 'Type Foundry', unreadCount: 0, muted: false }] }, { id: 2, title: 'Technology', unreadCount: 3, feeds: [{ id: 3, folderId: 2, title: 'Practical Systems', unreadCount: 3, muted: false }] }], unfiled: [] } }));
  await page.route('**/api/articles?**', (route) => route.fulfill({ json: { items: [
    article(1, 'Designing a calmer feed', 'How restraint, rhythm, and good defaults turn a firehose into a useful daily ritual.', 'Design Notes'),
    article(2, 'The quiet craft of interface typography', 'A close look at optical sizing, line length, and hierarchy in reading interfaces.', 'Type Foundry'),
    article(3, 'Local software is having a moment', 'Durable data and tools that work without accounts are finding their way home.', 'Practical Systems'),
    article(4, 'A field guide to useful empty states', 'Good empty states explain the product without making an absence feel like an error.', 'Design Notes'),
    article(5, 'Building a considerate polling loop', 'Conditional requests, backoff, and concurrency limits make small systems dependable.', 'Practical Systems'),
    article(6, 'Notes on warm neutral palettes', 'A restrained palette can feel expressive without competing with the content.', 'Design Notes'),
    article(7, 'Reading lists at ten thousand items', 'Virtualization keeps interaction immediate while preserving a simple mental model.', 'Practical Systems'),
    article(8, 'The case for a morning edition', 'A frozen daily snapshot replaces unread-count anxiety with a natural stopping point.', 'Design Notes'),
  ], nextCursor: null } }));
}

function article(id: number, title: string, summary: string, feedTitle: string) { return { id, title, author: id % 2 ? 'Mara Chen' : null, summaryHtml: `<p>${summary}</p>`, imageUrl: null, publishedAt: `2026-07-${String(10 - id).padStart(2, '0')}T03:00:00.000Z`, readAt: id === 4 ? '2026-07-10T04:00:00.000Z' : null, starredAt: id === 2 ? '2026-07-10T04:00:00.000Z' : null, feedId: 1, feedTitle, folderId: 1, folderTitle: 'Design' }; }
