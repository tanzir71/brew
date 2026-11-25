import { expect, test } from '@playwright/test';
import { upgradeLegacyDraft } from '../../packages/core/src/composition-model';

const sections = [
  {
    id: 'hero',
    title: 'Lead story',
    divider: 'Ideas worth a quiet morning',
    source: 'today',
    maxItems: 5,
    layout: 'hero',
    sort: 'newest',
    onlyUnread: false,
    items: [
      item(1, 'The case for calmer software', 'A thoughtful look at tools that respect attention.'),
    ],
  },
  {
    id: 'list',
    title: 'Briefing',
    source: 'starred',
    maxItems: 5,
    layout: 'list',
    sort: 'newest',
    onlyUnread: false,
    items: [
      item(2, 'Local data has a durable future', 'Small systems can remain useful for decades.'),
      item(
        3,
        'Typography for long-form reading',
        'Rhythm and measure make a reader feel effortless.',
      ),
    ],
  },
  {
    id: 'empty',
    title: 'From the archive',
    source: 'featured',
    maxItems: 5,
    layout: 'magazine',
    sort: 'newest',
    onlyUnread: true,
    items: [],
  },
];
const config = {
  id: 1,
  name: 'Morning',
  scheduleCron: '0 7 * * *',
  enabled: true,
  sections: sections.map((section) => ({
    id: section.id,
    title: section.title,
    ...('divider' in section ? { divider: section.divider } : {}),
    source: section.source,
    maxItems: section.maxItems,
    layout: section.layout,
    sort: section.sort,
    onlyUnread: section.onlyUnread,
  })),
  createdAt: '2026-07-10T00:00:00.000Z',
};
const snapshot = {
  id: 1,
  brewConfigId: 1,
  configName: 'Morning',
  generatedAt: '2026-07-10T07:00:00.000Z',
  sections,
  scrollPosition: 0,
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/brew-configs', (route) => route.fulfill({ json: [config] }));
  await page.route('**/api/brew-configs/1/composition', (route) =>
    route.fulfill({
      json: {
        ...config,
        ...upgradeLegacyDraft(config as Parameters<typeof upgradeLegacyDraft>[0], 'Asia/Dhaka'),
      },
    }),
  );
  await page.route('**/api/brew-configs/1/history', (route) => route.fulfill({ json: [snapshot] }));
  await page.route('**/api/reader/navigation', (route) =>
    route.fulfill({ json: { counts: { all: 3, today: 3, starred: 1 }, folders: [], unfiled: [] } }),
  );
  await page.route('**/api/brews/*/state', (route) =>
    route.fulfill({
      json: {
        articles: sections
          .flatMap((section) => section.items)
          .map((item) => ({
            id: item.id,
            available: true,
            readAt: null,
            starredAt: null,
            highlightColor: null,
            rules: [],
          })),
        timeZone: 'Asia/Dhaka',
        nextAt: '2026-07-11T01:00:00.000Z',
        scheduleLabel: 'Daily',
      },
    }),
  );
  await page.route('**/api/tags', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/brews/*/scroll', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/articles/*', (route) => route.fulfill({ json: {} }));
});
for (const theme of ['light', 'dark'] as const)
  test(`renders a frozen Brew in ${theme} theme`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('brew:theme', value), theme);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Morning' })).toBeVisible();
    await expect(page.getByText('No stories for this section today.')).toBeVisible();
    await expect(page.getByText('0 of 3 read', { exact: true })).toHaveCount(2);
    await expect(page).toHaveScreenshot(`brew-${theme}.png`, {
      fullPage: true,
      animations: 'disabled',
    });
  });
test('opens the canonical composer for an existing v1 Brew', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Compose', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Section title', exact: true })).toHaveValue(
    'Note',
  );
  await expect(page.getByRole('textbox', { name: 'Note · Markdown' })).toHaveValue(
    'Ideas worth a quiet morning',
  );
  await page.getByRole('button', { name: 'Expand Lead story', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Section title', exact: true })).toHaveValue(
    'Lead story',
  );
});

function item(id: number, title: string, summary: string) {
  return {
    id,
    title,
    url: `https://example.test/${id}`,
    author: null,
    summaryHtml: `<p>${summary}</p>`,
    imageUrl: null,
    publishedAt: '2026-07-10T06:00:00.000Z',
    feedTitle: 'Design Notes',
    readTimeMinutes: 4,
    readAt: null,
  };
}
