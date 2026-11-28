import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';

for (const theme of ['light', 'dark'] as const)
  test(`settings preference dialogs and data guides retain accessible focus and phone layout in ${theme}`, async ({
    page,
  }, testInfo) => {
    const f = await newslettersFixture(page, { theme });
    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto('/settings/runs');
      const nav = page.getByRole('navigation', { name: 'Settings', exact: true });
      const generalLink = nav.getByRole('link', { name: 'General', exact: true });
      await generalLink.focus();
      await page.keyboard.press('Enter');
      const general = page.getByRole('dialog', { name: 'General settings', exact: true });
      await expect(
        general.getByRole('button', { name: 'Close General settings', exact: true }),
      ).toBeFocused();
      await general.screenshot({ path: testInfo.outputPath(`general-desktop-${theme}.png`) });
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
          ['serious', 'critical'].includes(v.impact ?? ''),
        ),
      ).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(generalLink).toBeFocused();
      await nav.getByRole('link', { name: 'Reading', exact: true }).click();
      const reading = page.getByRole('dialog', { name: 'Reading settings', exact: true });
      for (const control of await reading.getByRole('combobox').all())
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(24);
      await page.setViewportSize({ width: 390, height: 844 });
      await reading.screenshot({ path: testInfo.outputPath(`reading-phone-${theme}.png`) });
      expect((await reading.boundingBox())!.width).toBeLessThanOrEqual(390);
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
          ['serious', 'critical'].includes(v.impact ?? ''),
        ),
      ).toEqual([]);
      await reading.getByRole('button', { name: 'Done', exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(
        reading.getByRole('button', { name: 'Close Reading settings', exact: true }),
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await page.goto('/settings/runs#preferences-general');
      await page.reload();
      await general.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Where Brew runs', exact: true }),
      ).toBeFocused();
      // A fresh deep link has no original trigger; closing returns to the heading.
      await page.goto('/settings/runs#setup-data');
      await page.reload();
      const data = page.getByRole('dialog', { name: 'Data & backup', exact: true });
      await data.screenshot({ path: testInfo.outputPath(`data-phone-${theme}.png`) });
      await data.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Where Brew runs', exact: true }),
      ).toBeFocused();
    } finally {
      await f.close();
    }
  });

test('failed preference writes keep actual values, report failure and allow the same choice to be retried', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (sessionStorage.getItem('test:fail-pref') === key)
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await page.goto('/settings/runs#preferences-general');
    const general = page.getByRole('dialog', { name: 'General settings', exact: true });
    await page.evaluate(() => sessionStorage.setItem('test:fail-pref', 'brew:theme'));
    await general.getByLabel('Theme', { exact: true }).selectOption('dark');
    await expect(general.getByRole('alert')).toContainText('Could not save theme');
    await expect(general.getByLabel('Theme', { exact: true })).toHaveValue('light');
    await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('brew:theme'))).toBe('light');
    await page.evaluate(() => sessionStorage.removeItem('test:fail-pref'));
    await general.getByLabel('Theme', { exact: true }).selectOption('dark');
    await expect(
      general.getByRole('region', { name: 'Preferences result', exact: true }),
    ).toHaveText('Theme saved in this browser.');
    await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'dark');
    await general.getByRole('button', { name: 'Done', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Settings', exact: true })
      .getByRole('link', { name: 'Reading', exact: true })
      .click();
    const reading = page.getByRole('dialog', { name: 'Reading settings', exact: true });
    await reading.getByLabel('Reader width', { exact: true }).selectOption('wide');
    await page.evaluate(() => sessionStorage.setItem('test:fail-pref', 'brew:reading-prefs'));
    await reading.getByLabel('Reader font', { exact: true }).selectOption('sans');
    await expect(reading.getByRole('alert')).toContainText('Could not save reader font');
    await expect(reading.getByLabel('Reader font', { exact: true })).toHaveValue('serif');
    await expect(reading.getByLabel('Reader width', { exact: true })).toHaveValue('wide');
    await page.evaluate(() => sessionStorage.removeItem('test:fail-pref'));
    await reading.getByLabel('Reader font', { exact: true }).selectOption('sans');
    await page.reload();
    await expect(reading.getByLabel('Reader font', { exact: true })).toHaveValue('sans');
    await expect(reading.getByLabel('Reader width', { exact: true })).toHaveValue('wide');
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('brew:reading-prefs')!)),
    ).toEqual({ width: 'wide', font: 'sans' });
  } finally {
    await f.close();
  }
});

test('browser storage changes update already-open settings, Reader controls and article typography across tabs', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  const other = await page.context().newPage();
  try {
    await page.goto('/all');
    await other.goto('/settings/runs#preferences-reading');
    const settings = other.getByRole('dialog', { name: 'Reading settings', exact: true });
    await settings.getByLabel('Open articles', { exact: true }).selectOption('pane');
    await expect(page.getByLabel('Open articles', { exact: true })).toHaveValue('pane');
    await settings.getByLabel('Reader font', { exact: true }).selectOption('sans');
    await page.getByRole('button', { name: 'Open article · Design story', exact: true }).click();
    const article = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(article).toHaveAttribute('aria-modal', 'false');
    await article.getByRole('button', { name: 'More article actions', exact: true }).click();
    const actions = page.getByRole('dialog', { name: 'Article actions', exact: true });
    await expect(actions.getByLabel('Reader font', { exact: true })).toHaveValue('sans');
    await actions.getByLabel('Reader font', { exact: true }).selectOption('serif');
    await expect(settings.getByLabel('Reader font', { exact: true })).toHaveValue('serif');
    await settings.getByLabel('Reader width', { exact: true }).selectOption('wide');
    await expect(actions.getByLabel('Reader width', { exact: true })).toHaveValue('wide');
    await expect(article.locator('.article-content')).toHaveAttribute('data-reading-font', 'serif');
    await settings.getByRole('button', { name: 'Done', exact: true }).click();
    await other
      .getByRole('navigation', { name: 'Settings', exact: true })
      .getByRole('link', { name: 'General', exact: true })
      .click();
    await other.getByLabel('Theme', { exact: true }).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'dark');
    await actions.getByRole('button', { name: 'Close article', exact: true }).click();
    if (
      (await page
        .locator('summary[aria-label="Reader options"]')
        .locator('..')
        .getAttribute('open')) === null
    )
      await page.locator('summary[aria-label="Reader options"]').click();
    await page.getByLabel('Read on scroll', { exact: true }).check();
    await other.getByRole('button', { name: 'Done', exact: true }).click();
    await other
      .getByRole('navigation', { name: 'Settings', exact: true })
      .getByRole('link', { name: 'Reading', exact: true })
      .click();
    await expect(settings.getByLabel('Read on scroll', { exact: true })).toBeChecked();
  } finally {
    await other.close();
    await f.close();
  }
});

test('unreadable preference storage has an explicit read retry and keeps the last known values', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    await page.addInitScript(() => {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (
          key === 'brew:reading-prefs' &&
          original.call(sessionStorage, 'test:fail-pref-read') === '1'
        )
          throw new DOMException('Storage blocked', 'SecurityError');
        return original.call(this, key);
      };
    });
    await page.goto('/settings/runs#preferences-reading');
    const reading = page.getByRole('dialog', { name: 'Reading settings', exact: true });
    await reading.getByLabel('Reader font', { exact: true }).selectOption('sans');
    await page.evaluate(() => {
      sessionStorage.setItem('test:fail-pref-read', '1');
      window.dispatchEvent(new StorageEvent('storage', { key: 'brew:reading-prefs' }));
    });
    await expect(reading.getByRole('alert')).toContainText('Could not read browser preferences');
    await expect(reading.getByLabel('Reader font', { exact: true })).toHaveValue('sans');
    await page.evaluate(() => sessionStorage.removeItem('test:fail-pref-read'));
    await reading.getByRole('button', { name: 'Retry browser preferences', exact: true }).click();
    await expect(reading.getByRole('alert')).toHaveCount(0);
    await expect(reading.getByLabel('Reader font', { exact: true })).toHaveValue('sans');
  } finally {
    await f.close();
  }
});
