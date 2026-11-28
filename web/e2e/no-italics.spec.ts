import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { serveWebsite } from '../../scripts/lib/website-server.mjs';
import { sanitizeArticleHtml } from '../../packages/core/src/html-sanitizer.js';

async function expectNormalText(page: Page) {
  // Query and inspect in one evaluation: React can replace sidebar links between
  // locator resolution and inspection, giving detached nodes empty computed styles.
  const slanted = await page.evaluate(() =>
    [...document.querySelectorAll('body *')].flatMap((element) =>
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
      .getByRole('button', { name: `Open article · ${article.title}`, exact: true })
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
  const server = await serveWebsite();
  const thirdParty: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== server.origin) thirdParty.push(url.href);
  });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.origin + '/brew/', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Your feeds and newsletters, made into one calm daily paper.',
    );
    await expectNormalText(page);
    await page.goto(server.origin + '/brew/demo/', { waitUntil: 'networkidle' });
    await expect(page.locator('.demo-notice')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Morning', exact: true })).toBeVisible();
    await expectNormalText(page);
    await page.getByRole('button', { name: 'Switch theme', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'dark');
    await expectNormalText(page);
    await page.getByRole('link', { name: /^All articles/ }).click();
    await expect(page.getByRole('heading', { name: 'All articles', exact: true })).toBeVisible();
    await expectNormalText(page);
    await page.setViewportSize({ width: 1200, height: 630 });
    await page.goto(server.origin + '/brew/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await expectNormalText(page);
    const social = await readFile(new URL('../../docs/og.png', import.meta.url));
    expect(social.readUInt32BE(16)).toBe(1200);
    expect(social.readUInt32BE(20)).toBe(630);
    const painted = await page.screenshot();
    expect(createHash('sha256').update(painted).digest('hex')).toBe(
      createHash('sha256').update(social).digest('hex'),
    );
    expect(thirdParty).toEqual([]);
  } finally {
    await server.close();
  }
});
