import fs from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { renderBrewEmail } from '../../packages/core/src/brew-outputs';
import { outputOrigin, readingOutputFixture } from '../../packages/core/test/output-fixtures';

for (const theme of ['light', 'dark'] as const)
  for (const width of [760, 390])
    test(`delivered email remains readable at ${width}px in ${theme}`, async ({ page }) => {
      const requests: string[] = [];
      const picture = fs.readFileSync(
        new URL('../../packages/web/public/figma/newsletters/letter.png', import.meta.url),
      );
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        requests.push(url.href);
        if (url.origin === outputOrigin && url.pathname === '/api/img')
          await route.fulfill({ contentType: 'image/png', body: picture });
        else await route.abort();
      });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const rendered = renderBrewEmail(readingOutputFixture(), { baseUrl: outputOrigin });
      await page.setContent(rendered.html);
      await expect(
        page.getByRole('heading', { name: 'Weekend & reading', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'context', exact: true })).toHaveAttribute(
        'href',
        `${outputOrigin}/a/81`,
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode()));
      });
      const geometry = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        table: document.querySelector('table[width="600"]')!.getBoundingClientRect().width,
        background: getComputedStyle(document.body).backgroundColor,
        slanted: [...document.body.querySelectorAll('*')].filter((node) =>
          ['italic', 'oblique'].includes(getComputedStyle(node).fontStyle),
        ).length,
        images: [...document.images].map((image) => ({
          loaded: image.naturalWidth > 0,
          width: image.getBoundingClientRect().width,
        })),
      }));
      expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.table).toBe(width === 760 ? 600 : 390);
      expect(geometry.background).toBe(
        theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(26, 25, 23)',
      );
      expect(geometry.slanted).toBe(0);
      expect(geometry.images).toHaveLength(1);
      expect(geometry.images[0]!.loaded).toBe(true);
      expect(geometry.images[0]!.width).toBeLessThanOrEqual(width - 72);
      expect(requests.every((url) => url.startsWith(`${outputOrigin}/api/img?src=`))).toBe(true);
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(
        accessibility.violations.filter((item) =>
          ['serious', 'critical'].includes(item.impact ?? ''),
        ),
      ).toEqual([]);
      await expect(page).toHaveScreenshot(`email-${theme}-${width}.png`, {
        fullPage: true,
        animations: 'disabled',
      });
    });
