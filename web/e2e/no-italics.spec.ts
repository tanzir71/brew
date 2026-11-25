import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { sanitizeArticleHtml } from '../../packages/core/src/html-sanitizer.js';

async function expectNormalText(page: Page) {
  const slanted = await page.locator('body *').evaluateAll((elements) =>
    elements.flatMap((element) =>
      ['', '::before', '::after'].flatMap((pseudo) => {
        const style = getComputedStyle(element, pseudo || null).fontStyle;
        return style === 'normal' ? [] : [`${element.tagName}${pseudo}: ${style}`];
      }),
    ),
  );
  expect(slanted).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  test(`semantic feed content and UI stay normal in ${theme}`, async ({ page }) => {
    const content = sanitizeArticleHtml(
      '<p><em style="font-style:italic">Emphasis</em>, <i>term</i>, <cite>citation</cite>, <var>x</var>.</p>',
    )!;
    expect(content).toContain('<em>Emphasis</em>');
    const article = {
      id: 1,
      title: 'Normal article typography',
      feedTitle: 'Design Notes',
      url: 'https://example.test/article',
      publishedAt: '2026-11-25T00:00:00.000Z',
      readAt: null,
      starredAt: null,
      author: null,
      imageUrl: null,
      readTimeMinutes: 2,
      summaryHtml: content,
      tags: [],
      fullTextHtml: content,
    };
    const section = {
      id: 'lead',
      title: 'Lead story',
      source: 'today',
      maxItems: 5,
      layout: 'hero',
      sort: 'newest',
      onlyUnread: false,
    };
    const config = {
      id: 1,
      name: 'Morning',
      scheduleCron: '0 7 * * *',
      enabled: true,
      sections: [section],
      createdAt: article.publishedAt,
    };
    const snapshot = {
      id: 1,
      brewConfigId: 1,
      configName: 'Morning',
      generatedAt: article.publishedAt,
      sections: [{ ...section, items: [article] }],
      scrollPosition: 0,
    };
    await page.addInitScript((value) => localStorage.setItem('brew:theme', value), theme);
    await page.route('**/api/brew-configs', (route) => route.fulfill({ json: [config] }));
    await page.route('**/api/brew-configs/1/history', (route) =>
      route.fulfill({ json: [snapshot] }),
    );
    await page.route('**/api/reader/navigation', (route) =>
      route.fulfill({
        json: { counts: { all: 1, today: 1, starred: 0 }, folders: [], unfiled: [] },
      }),
    );
    await page.route('**/api/articles?**', (route) =>
      route.fulfill({ json: { items: [article], nextCursor: null } }),
    );
    await page.route('**/api/articles/1', (route) => route.fulfill({ json: article }));
    await page.route('**/api/brews/*/scroll', (route) => route.fulfill({ json: { ok: true } }));
    await page.goto('/');
    await expect(page.locator('article em')).toHaveText('Emphasis');
    await expectNormalText(page);
    await page.goto('/?view=reader&scope=all');
    await page
      .getByRole('button')
      .filter({ has: page.getByRole('heading', { name: article.title }) })
      .click();
    await expect(page.locator('.article-content em')).toHaveText('Emphasis');
    await expect(page.locator('.article-content em')).toHaveCSS('font-style', 'normal');
    // Even inline styles from future content renderers cannot reintroduce slants.
    await page.locator('.article-content').evaluate((element) => {
      for (const tag of ['em', 'i', 'cite', 'dfn', 'address', 'var']) {
        const child = document.createElement(tag);
        child.textContent = tag;
        child.style.fontStyle = 'oblique';
        element.append(child);
      }
    });
    await expectNormalText(page);
    await page.goto('/?view=rules');
    await expect(page.getByRole('heading', { name: 'Rules', exact: true })).toBeVisible();
    await expectNormalText(page);
    await page.goto('/settings/runs');
    await expect(page.getByRole('heading', { name: 'Where Brew runs' })).toBeVisible();
    await expectNormalText(page);
  });
}

test('landing, interactive demo and social artwork use only normal typography', async ({
  page,
}) => {
  const files: Record<string, [string, string]> = {
    '/': ['index.html', 'text/html'],
    '/site.css': ['site.css', 'text/css'],
    '/site.js': ['site.js', 'text/javascript'],
    '/demo/': ['demo/index.html', 'text/html'],
    '/demo/demo.css': ['demo/demo.css', 'text/css'],
    '/demo/demo.js': ['demo/demo.js', 'text/javascript'],
    '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
    '/og.svg': ['og.svg', 'image/svg+xml'],
  };
  const fontRequests: string[] = [];
  // The legacy marketing fonts are outside the app. Make this style check deterministic.
  await page.route('https://fonts.googleapis.com/**', (route) => {
    fontRequests.push(route.request().url());
    return route.fulfill({ contentType: 'text/css', body: '' });
  });
  await page.route('http://brew-site.test/**', async (route) => {
    const file = files[new URL(route.request().url()).pathname];
    if (!file) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({
      contentType: file[1],
      body: await readFile(new URL(`../../docs/${file[0]}`, import.meta.url)),
    });
  });
  await page.goto('http://brew-site.test/');
  await expect(page.locator('h1 em')).toHaveText('you own.');
  await expectNormalText(page);
  await page.goto('http://brew-site.test/demo/');
  await expect(page.locator('.demo-notice')).toBeVisible();
  await expectNormalText(page);
  await page.getByRole('button', { name: 'Toggle dark mode' }).click();
  await expectNormalText(page);
  await page.locator('[data-view="reader"]').first().click();
  await expectNormalText(page);
  expect(fontRequests).toHaveLength(2);
  expect(fontRequests.every((url) => !url.includes('ital'))).toBe(true);
  await page.goto('http://brew-site.test/og.svg');
  await expect(page.locator('text')).not.toHaveCount(0);
  expect(
    await page
      .locator('text')
      .evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).fontStyle === 'normal'),
      ),
  ).toBe(true);
});
