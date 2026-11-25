import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
const tokens = JSON.parse(
  readFileSync(new URL('../../design/tokens.json', import.meta.url), 'utf8'),
) as { colors: Record<'light' | 'dark', Record<string, string>> };

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;

for (const theme of ['light', 'dark'] as const)
  test(`Figma color foundations and live Tailwind variables in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 950 });
    await page.goto(`/test/colors.html?theme=${theme}`);
    await expect(
      page.getByRole('heading', { name: `Color · ${theme === 'light' ? 'Light' : 'Dark'}` }),
    ).toBeVisible();
    const swatches = await page
      .locator('[data-token]')
      .evaluateAll((elements) =>
        Object.fromEntries(
          elements.map((element) => [
            element.getAttribute('data-token')!,
            getComputedStyle(element).backgroundColor,
          ]),
        ),
      );
    expect(Object.keys(swatches)).toHaveLength(32);
    for (const [name, value] of Object.entries(tokens.colors[theme]))
      expect(swatches[name]).toBe(rgb(value));
    const button = page.getByRole('button', { name: 'Switch theme' });
    const styles = await button.evaluate((element) => {
      const css = getComputedStyle(element);
      return {
        background: css.backgroundColor,
        color: css.color,
        radius: css.borderRadius,
        padding: css.paddingInlineStart,
        shadow: css.boxShadow,
      };
    });
    expect(styles).toMatchObject({
      background: rgb(tokens.colors[theme]['bg/inverse']),
      color: rgb(tokens.colors[theme]['text/inverse']),
      radius: '8px',
      padding: '16px',
    });
    expect(styles.shadow).not.toBe('none');
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('main')).toHaveScreenshot(`color-${theme}.png`, {
      animations: 'disabled',
    });
    const audit = await new AxeBuilder({ page }).analyze();
    expect(
      audit.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
    ).toEqual([]);
    const next = theme === 'light' ? 'dark' : 'light';
    await button.click();
    await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', next);
    await expect(button).toHaveCSS('background-color', rgb(tokens.colors[next]['bg/inverse']));
  });
