import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const tokens = JSON.parse(
  readFileSync(new URL('../../design/tokens.json', import.meta.url), 'utf8'),
) as {
  fonts: Record<string, { family: string }>;
  typography: Record<
    string,
    { family: string; size: number; lineHeight: number; weight: number; tracking: number }
  >;
};
const origin = 'http://127.0.0.1:4401';

async function expectCustomFont(page: Page, selector: string, family: string) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(
      fonts.some(
        (font) => font.isCustomFont && font.glyphCount > 0 && font.familyName.startsWith(family),
      ),
    ).toBe(true);
  } finally {
    await session.detach();
  }
}

for (const theme of ['light', 'dark'] as const)
  test(`Figma typography uses local fonts and exact metrics in ${theme}`, async ({ page }) => {
    const remoteFonts: string[] = [];
    const fontResponses: Array<Promise<{ path: string; status: number; signature: string }>> = [];
    page.on('request', (request) => {
      if (
        ['font', 'stylesheet'].includes(request.resourceType()) &&
        new URL(request.url()).origin !== origin
      )
        remoteFonts.push(request.url());
    });
    page.on('response', (response) => {
      if (response.request().resourceType() === 'font')
        fontResponses.push(
          response.body().then((body) => ({
            path: new URL(response.url()).pathname,
            status: response.status(),
            signature: body.subarray(0, 4).toString(),
          })),
        );
    });
    await page.setViewportSize({ width: 1100, height: 1100 });
    await page.goto(`/test/type.html?theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('[data-type-style]')).toHaveCount(17);
    for (const [key, style] of Object.entries(tokens.typography)) {
      const sample = page.locator(`[data-type-style="${key}"]`);
      const css = await sample.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          family: style.fontFamily,
          size: style.fontSize,
          line: style.lineHeight,
          weight: style.fontWeight,
          tracking: style.letterSpacing,
          fontStyle: style.fontStyle,
        };
      });
      expect(css.family).toContain(tokens.fonts[style.family]!.family);
      expect(css).toMatchObject({
        size: `${style.size}px`,
        line: `${style.lineHeight}px`,
        weight: String(style.weight),
        fontStyle: 'normal',
      });
      expect(css.tracking === 'normal' ? 0 : Number.parseFloat(css.tracking)).toBeCloseTo(
        style.size * style.tracking,
        3,
      );
    }
    for (const [selector, family] of [
      ['[data-type-style="display-xl"]', 'Newsreader'],
      ['[data-type-style="ui-body"]', 'Instrument Sans'],
      ['[data-type-style="mono-s"]', 'Geist Mono'],
    ])
      await expectCustomFont(page, selector!, family!);
    const faces = await page.evaluate(() =>
      [...document.fonts].map((face) => ({
        display: face.display,
        status: face.status,
        style: face.style,
      })),
    );
    expect(faces).toHaveLength(6);
    expect(
      faces.every(
        (face) => face.display === 'swap' && face.status === 'loaded' && face.style === 'normal',
      ),
    ).toBe(true);
    const responses = await Promise.all(fontResponses);
    expect(responses.map((response) => response.path).sort()).toEqual(
      ['geist-mono', 'instrument-sans', 'newsreader']
        .flatMap((name) => [`/fonts/${name}-latin.woff2`, `/fonts/${name}-latin-ext.woff2`])
        .sort(),
    );
    expect(
      responses.every((response) => response.status === 200 && response.signature === 'wOF2'),
    ).toBe(true);
    expect(remoteFonts).toEqual([]);
    await expect(page.getByRole('main')).toHaveScreenshot(`type-${theme}.png`, {
      animations: 'disabled',
    });
    const audit = await new AxeBuilder({ page }).analyze();
    expect(
      audit.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
    ).toEqual([]);
  });

test('Brew, Reader, Rules and settings keep fonts local and preserve reading preferences', async ({
  page,
}) => {
  const remoteFonts: string[] = [];
  page.on('request', (request) => {
    if (
      ['font', 'stylesheet'].includes(request.resourceType()) &&
      new URL(request.url()).origin !== origin
    )
      remoteFonts.push(request.url());
  });
  const article = {
    id: 1,
    title: 'A locally typeset article',
    feedTitle: 'Design Notes',
    url: 'https://example.test/article',
    publishedAt: '2026-11-25T00:00:00.000Z',
    readAt: null,
    starredAt: null,
    author: null,
    imageUrl: null,
    readTimeMinutes: 2,
    summaryHtml: '<p>Reading stays private.</p>',
    tags: [],
    fullTextHtml: '<p>Reading stays private with <code>local fonts</code>.</p>',
  };
  await page.route('**/api/brew-configs', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/reader/navigation', (route) =>
    route.fulfill({
      json: {
        counts: { all: 1, today: 1, starred: 0 },
        folders: [],
        unfiled: [],
      },
    }),
  );
  await page.route('**/api/articles?**', (route) =>
    route.fulfill({ json: { items: [article], nextCursor: null } }),
  );
  await page.route('**/api/articles/1', (route) => route.fulfill({ json: article }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nothing has been brewed yet.' })).toHaveCSS(
    'font-family',
    'Newsreader, Georgia, serif',
  );
  await page.getByRole('button', { name: 'Reader', exact: true }).click();
  await page.getByRole('button', { name: /^All/ }).click();
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: article.title }) })
    .click();
  await expect(page.locator('.article-content')).toHaveCSS(
    'font-family',
    'Newsreader, Georgia, serif',
  );
  await expect(page.locator('.article-content')).toHaveCSS('font-size', '19px');
  await expect(page.locator('.article-content')).toHaveCSS('line-height', '31px');
  await page.evaluate(() => document.fonts.ready);
  await expectCustomFont(page, '.article-content p', 'Newsreader');
  await expectCustomFont(page, '.article-content code', 'Geist Mono');
  await expect(page.getByLabel('Reader font')).toHaveValue('serif');
  await page.getByLabel('Reader font').selectOption('sans');
  await expect(page.locator('.article-content')).toHaveCSS(
    'font-family',
    '"Instrument Sans", ui-sans-serif, sans-serif',
  );
  await expect(page.getByRole('button', { name: 'Copy link' })).toHaveCSS(
    'font-family',
    '"Instrument Sans", ui-sans-serif, sans-serif',
  );
  await page.goto('/?view=reader&scope=all');
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: article.title }) })
    .click();
  await expect(page.getByLabel('Reader font')).toHaveValue('sans');
  await page.getByRole('button', { name: 'Close article' }).click();
  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rules', exact: true })).toBeVisible();
  await page.goto('/settings/runs');
  await expect(page.getByRole('heading', { name: 'Where Brew runs' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(remoteFonts).toEqual([]);
});
