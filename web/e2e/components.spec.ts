import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
    await Promise.all(
      [...document.querySelectorAll<HTMLElement>('[data-figma-asset]')].map(async (element) => {
        const image = new Image();
        image.src = element.dataset.figmaAsset!;
        await image.decode();
        const rect = element.getBoundingClientRect();
        if (
          element.getClientRects().length &&
          (rect.width !== image.naturalWidth || rect.height !== image.naturalHeight)
        )
          throw new Error('Figma asset geometry changed');
      }),
    );
  });
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual(
    [],
  );
}
for (const theme of ['light', 'dark']) {
  test(`primitive Figma variants in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`/test/components.html?theme=${theme}`);
    await ready(page);
    const buttons = page.getByLabel('Buttons').getByRole('button');
    expect(await buttons.count()).toBe(8);
    expect(
      await buttons.evaluateAll((elements) =>
        elements.map((element) => ({
          height: element.getBoundingClientRect().height,
          radius: getComputedStyle(element).borderRadius,
        })),
      ),
    ).toEqual(Array.from({ length: 8 }, (_, n) => ({ height: n % 2 ? 28 : 36, radius: '8px' })));
    await expect(page.getByRole('main')).toHaveScreenshot(`primitives-${theme}.png`);
    await accessible(page);
    await page.getByRole('switch', { name: 'On toggle' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('switch', { name: 'On toggle' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await page.getByRole('checkbox', { name: 'Unchecked checkbox' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: 'Unchecked checkbox' })).toBeChecked();
    await page.getByLabel('Foundation input').fill('Typed by keyboard');
    await expect(page.getByLabel('Foundation input')).toHaveValue('Typed by keyboard');
  });
  test(`all 53 Figma icon symbols in ${theme}`, async ({ page }) => {
    const remote: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== 'http://127.0.0.1:4401') remote.push(request.url());
    });
    await page.goto(`/test/components.html?view=icons&theme=${theme}`);
    await ready(page);
    const gallery = page.getByRole('region', { name: 'Icon foundations', exact: true });
    await expect(gallery.getByRole('img')).toHaveCount(53);
    const geometry = await gallery.locator('svg').evaluateAll((elements) =>
      elements.map((svg) => {
        const box = (svg as SVGSVGElement).getBBox();
        const rect = svg.getBoundingClientRect();
        return rect.width === 20 && rect.height === 20 && box.width > 0 && box.height > 0;
      }),
    );
    expect(geometry.every(Boolean)).toBe(true);
    const geometryMatches = await page.evaluate(async () => {
      const images = [
        ...document.querySelectorAll<HTMLImageElement>('[aria-label="Original icon exports"] img'),
      ];
      return Promise.all(
        images.map(async (image) => {
          const name = image.src.split('/').at(-1)!.replace('.svg', '');
          const source = new DOMParser().parseFromString(
            await (await fetch(image.src)).text(),
            'image/svg+xml',
          ).documentElement;
          const symbol = document.getElementById(`brew-icon-${name}`)!;
          const ids = new Map(
            [...source.querySelectorAll('[id]')].map((element, index) => [
              element.id,
              `brew-${name}-${index}`,
            ]),
          );
          const record = (root: Element, original: boolean) =>
            [...root.querySelectorAll('*')].map((element) => ({
              tag: element.tagName,
              attributes: element
                .getAttributeNames()
                .filter((name) => name !== 'id')
                .sort()
                .map((name) => {
                  let value = element.getAttribute(name)!;
                  if (
                    original &&
                    ['fill', 'stroke'].includes(name) &&
                    value.toLowerCase() === '#4e4842'
                  )
                    value = 'currentColor';
                  if (original)
                    value = value.replace(
                      /url\(#([^)]+)\)/g,
                      (_, id: string) => `url(#${ids.get(id)})`,
                    );
                  return [name, value];
                }),
            }));
          return (
            source.getAttribute('viewBox') === symbol.getAttribute('viewBox') &&
            JSON.stringify(record(source, true)) === JSON.stringify(record(symbol, false))
          );
        }),
      );
    });
    expect(geometryMatches).toHaveLength(53);
    expect(
      geometryMatches.every(Boolean),
      'Every exported vector and stroke is preserved in the inline symbols',
    ).toBe(true);
    await expect(gallery).toHaveCSS(
      'color',
      theme === 'light' ? 'rgb(78, 72, 66)' : 'rgb(197, 190, 181)',
    );
    await expect(gallery).toHaveScreenshot(`icons-${theme}.png`);
    expect(remote).toEqual([]);
    await accessible(page);
  });
  test(`composite patterns in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(`/test/components.html?view=composites&theme=${theme}`);
    await ready(page);
    await expect(page.getByRole('button', { name: 'Unavailable action' })).toBeDisabled();
    await expect(page.getByRole('switch', { name: 'Email delivery' })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Set up Email', exact: true })).toBeVisible();
    await expect(page.getByRole('main')).toHaveScreenshot(`composites-${theme}.png`);
    await accessible(page);
  });
  test(`shared sidebar components and Calm counts in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route('**/api/capabilities', (route) =>
      route.fulfill({
        json: {
          mode: 'cloudflare',
          fetch: 'direct',
          backgroundFetch: { kind: 'cron', everyMinutes: 15 },
          inboundMail: 'cloudflare-email',
          emailDelivery: null,
          readerApi: true,
          mcp: 'http',
          webmcp: false,
          ai: { available: ['workers-ai'], configured: false },
          readState: 'server',
          publicCopy: true,
        },
      }),
    );
    await page.route('**/api/brew-configs', (route) =>
      route.fulfill({
        json: [
          { id: 1, name: 'Morning' },
          { id: 2, name: 'Weekend' },
        ],
      }),
    );
    await page.route('**/api/reader/navigation', (route) =>
      route.fulfill({
        json: {
          counts: { today: 34, all: 312, starred: 9 },
          unfiled: [],
          folders: [
            { id: 1, title: 'Design', unreadCount: 18, feeds: [] },
            { id: 2, title: 'Engineering', unreadCount: 41, feeds: [] },
            { id: 3, title: 'Independent', unreadCount: 7, feeds: [] },
            { id: 4, title: 'Video', unreadCount: 5, feeds: [] },
          ],
        },
      }),
    );
    await page.addInitScript(() =>
      localStorage.setItem(
        'brew:saved-searches',
        JSON.stringify([{ id: 'figma', name: 'Figma mentions', query: 'figma' }]),
      ),
    );
    await page.goto(`/test/components.html?view=sidebar&theme=${theme}`);
    await expect(page.getByRole('link', { name: 'Cloudflare · Where Brew runs' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Morning', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await ready(page);
    await expect(page.locator('.sidebar-foundations')).toHaveScreenshot(`sidebar-${theme}.png`);
    await accessible(page);
    await page.evaluate(() => localStorage.setItem('brew:calm', 'true'));
    await page.reload();
    await expect(page.getByRole('link', { name: 'Today', exact: true })).toBeVisible();
    await expect(page.locator('.brew-nav-count, .runs-nav-count')).toHaveCount(0);
  });
}
test('composites support keyboard selection, numeric bounds, ordering and article actions', async ({
  page,
}) => {
  await page.goto('/test/components.html?view=composites');
  const layout = page.getByRole('radiogroup', { name: 'Layout', exact: true });
  await layout.getByRole('radio', { name: 'Lead' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(layout.getByRole('radio', { name: 'Magazine' })).toBeFocused();
  await expect(layout.getByRole('radio', { name: 'Magazine' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.keyboard.press('End');
  await expect(layout.getByRole('radio', { name: 'Headlines' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('spinbutton', { name: 'Items', exact: true }).fill('20');
  await expect(page.getByRole('button', { name: 'Increase Items' })).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'Items', exact: true }).fill('1');
  await expect(page.getByRole('button', { name: 'Decrease Items' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Filter value', exact: true }).fill('webmcp');
  await expect(page.getByRole('textbox', { name: 'Filter value', exact: true })).toHaveValue(
    'webmcp',
  );
  await page.getByRole('button', { name: 'Move Design & craft down' }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.locator('.brew-section-card').first()).toHaveAttribute(
    'aria-label',
    'From your newsletters',
  );
  await page.getByRole('button', { name: 'Move Design & craft up' }).click();
  await expect(page.locator('.brew-section-card').first()).toHaveAttribute(
    'aria-label',
    'Design & craft',
  );
  await page
    .getByRole('button', { name: 'Drag Design & craft to reorder' })
    .dragTo(page.getByRole('region', { name: 'From your newsletters', exact: true }));
  await expect(page.locator('.brew-section-card').first()).toHaveAttribute(
    'aria-label',
    'From your newsletters',
  );
  await page.getByRole('button', { name: 'Star article', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unstar article' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Mark article read' }).click();
  await expect(page.getByRole('button', { name: 'Mark article unread' })).toBeVisible();
  await page
    .getByRole('radiogroup', { name: 'Brew view' })
    .getByRole('radio', { name: 'Compose' })
    .click();
  await expect(page.getByRole('radio', { name: 'Compose' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByRole('status')).toHaveText('Marked all read');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.copiedCode = text;
        },
      },
    }),
  );
  await page.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.locator('html').getAttribute('data-copied-code')).toContain(
    '\n  "mcpServers": {\n',
  );
  await page.goto('/test/components.html?view=composites&disabled=1');
  const disabledLayout = page.getByRole('radiogroup', { name: 'Layout', exact: true });
  await expect(disabledLayout.getByRole('radio', { name: 'Magazine' })).toBeDisabled();
  await disabledLayout.getByRole('radio', { name: 'Lead' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(disabledLayout.getByRole('radio', { name: 'Grid', exact: true })).toBeFocused();
});
for (const theme of ['light', 'dark'])
  test(`sheets trap focus, close by Escape and restore the opener in ${theme}`, async ({
    page,
  }) => {
    await page.goto(`/test/components.html?view=composites&theme=${theme}`);
    const opener = page.getByRole('button', { name: 'Open modal sheet' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Add a source', exact: true });
    await expect(page.getByLabel('Source URL')).toBeFocused();
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await accessible(page);
    await expect(dialog).toHaveScreenshot(`modal-sheet-${theme}.png`);
    for (let n = 0; n < 7; n++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();
    await page.getByLabel('Source URL').fill('https://example.test/feed');
    await dialog.getByRole('button', { name: 'Add source', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Added https://example.test/feed');
    const sideOpener = page.getByRole('button', { name: 'Open side sheet' });
    await sideOpener.click();
    const side = page.getByRole('dialog', { name: 'Schedule & delivery' });
    await expect(side).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Send email', exact: true })).toBeDisabled();
    await accessible(page);
    await expect(side).toHaveScreenshot(`side-sheet-${theme}.png`);
    await page.keyboard.press('Escape');
    await expect(side).toHaveCount(0);
    await expect(sideOpener).toBeFocused();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  });
