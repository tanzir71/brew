import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';

test('saved-search changes propagate between Reader and an already-open sidebar without reloading', async ({
  page,
}, testInfo) => {
  const f = await newslettersFixture(page, { theme: 'dark' });
  const sidebar = await page.context().newPage();
  try {
    await page.goto('/search?q=Design&sort=oldest');
    await sidebar.goto('/settings/runs');
    await page.getByRole('button', { name: 'Save search', exact: true }).click();
    const save = page.getByRole('dialog', { name: 'Save search', exact: true });
    await save.getByLabel('Saved search name', { exact: true }).fill('Shared design');
    await save.screenshot({ path: testInfo.outputPath('save-search-dark.png') });
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ['serious', 'critical'].includes(item.impact ?? ''),
      ),
    ).toEqual([]);
    await save.getByRole('button', { name: 'Save search', exact: true }).click();
    const shared = sidebar.getByRole('link', { name: 'Shared design', exact: true });
    await expect(shared).toHaveAttribute('href', '/search?q=Design&sort=oldest');
    const more = page.getByRole('button', {
      name: 'More actions for saved search Shared design',
      exact: true,
    });
    const box = await more.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
    await more.click();
    await page
      .getByRole('dialog', { name: 'Saved search “Shared design”', exact: true })
      .getByRole('button', { name: 'Delete saved search', exact: true })
      .click();
    const confirm = page.getByRole('dialog', {
      name: 'Delete saved search “Shared design”?',
      exact: true,
    });
    await confirm.screenshot({ path: testInfo.outputPath('delete-search-dark.png') });
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ['serious', 'critical'].includes(item.impact ?? ''),
      ),
    ).toEqual([]);
    await confirm.getByRole('button', { name: 'Delete saved search', exact: true }).click();
    await expect(shared).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Undo deletion of “Shared design”', exact: true })
      .click();
    await expect(shared).toBeVisible();
    await shared.click();
    await expect(sidebar).toHaveURL('/search?q=Design&sort=oldest');
    await expect(sidebar.getByRole('link', { name: 'Shared design', exact: true })).toBeVisible();
  } finally {
    await sidebar.close();
    await f.close();
  }
});

test('storage failures retain the saved-search form, require recoverable deletion and allow actual Undo retry', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (
          (key === 'brew:saved-searches' &&
            sessionStorage.getItem('test:fail-search-write') === '1') ||
          (key === 'brew:saved-search-undo' &&
            sessionStorage.getItem('test:fail-search-undo') === '1')
        )
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await page.goto('/search?q=Design');
    await page.getByRole('button', { name: 'Save search', exact: true }).click();
    const save = page.getByRole('dialog', { name: 'Save search', exact: true });
    await save.getByLabel('Saved search name', { exact: true }).fill('Retry design');
    await page.evaluate(() => sessionStorage.setItem('test:fail-search-write', '1'));
    await save.getByRole('button', { name: 'Save search', exact: true }).click();
    await expect(save.getByRole('alert')).toContainText('Could not save this change');
    await expect(save.getByLabel('Saved search name', { exact: true })).toHaveValue('Retry design');
    expect(await page.evaluate(() => localStorage.getItem('brew:saved-searches'))).toBeNull();
    await page.evaluate(() => sessionStorage.removeItem('test:fail-search-write'));
    await save.getByRole('button', { name: 'Save search', exact: true }).click();
    await expect(save).not.toBeVisible();
    const bookmark = page.getByRole('link', { name: 'Retry design', exact: true });
    await expect(bookmark).toBeVisible();
    await page
      .getByRole('button', { name: 'More actions for saved search Retry design', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Saved search “Retry design”', exact: true })
      .getByRole('button', { name: 'Delete saved search', exact: true })
      .click();
    const confirm = page.getByRole('dialog', {
      name: 'Delete saved search “Retry design”?',
      exact: true,
    });
    await page.evaluate(() => sessionStorage.setItem('test:fail-search-undo', '1'));
    await confirm.getByRole('button', { name: 'Delete saved search', exact: true }).click();
    await expect(confirm.getByRole('alert')).toContainText('Nothing was removed');
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('brew:saved-searches')!)),
    ).toHaveLength(1);
    await page.evaluate(() => sessionStorage.removeItem('test:fail-search-undo'));
    await confirm.getByRole('button', { name: 'Delete saved search', exact: true }).click();
    await expect(bookmark).toHaveCount(0);
    const undo = page.getByRole('button', { name: 'Undo deletion of “Retry design”', exact: true });
    await page.evaluate(() => sessionStorage.setItem('test:fail-search-write', '1'));
    await undo.click();
    await expect(page.getByRole('alert')).toContainText('Could not save this change');
    await expect(bookmark).toHaveCount(0);
    await expect(undo).toBeEnabled();
    await page.evaluate(() => sessionStorage.removeItem('test:fail-search-write'));
    await undo.click();
    await expect(bookmark).toBeFocused();
    await expect(
      page.getByRole('region', { name: 'Saved search result', exact: true }),
    ).toContainText('Restored saved search');
  } finally {
    await f.close();
  }
});

test('malformed saved-search storage reports a retryable error without crashing search or replacing the stored data', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    await page.addInitScript(() => localStorage.setItem('brew:saved-searches', '[null]'));
    await page.goto('/search?q=Design');
    await expect(page.getByRole('heading', { name: '“Design”', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Could not read saved searches');
    await page.getByRole('button', { name: 'Save search', exact: true }).click();
    const save = page.getByRole('dialog', { name: 'Save search', exact: true });
    await save.getByRole('button', { name: 'Save search', exact: true }).click();
    await expect(save.getByRole('alert')).toContainText('Could not save this change');
    expect(await page.evaluate(() => localStorage.getItem('brew:saved-searches'))).toBe('[null]');
    await save.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => localStorage.setItem('brew:saved-searches', '[]'));
    await page.getByRole('button', { name: 'Retry saved searches', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Retry saved searches', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Save search', exact: true }).click();
    await save.getByLabel('Saved search name', { exact: true }).fill('Recovered');
    await save.getByRole('button', { name: 'Save search', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Recovered', exact: true })).toBeVisible();
  } finally {
    await f.close();
  }
});
