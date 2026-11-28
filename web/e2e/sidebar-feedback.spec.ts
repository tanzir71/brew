import { expect, test } from '@playwright/test';
import { composeFixture } from './compose-fixture';

test('responsive previews and the sidebar preserve space, keyboard access and browser choice', async ({
  page,
}) => {
  const fixture = await composeFixture(page);
  try {
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto(`/b/${fixture.config.id}/compose?section=design`);
    const paper = page.getByRole('article', { name: 'Web preview', exact: true });
    await expect(paper).toBeVisible();
    const width = (await paper.boundingBox())!.width;
    expect(width).toBeGreaterThan(560);
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect((await paper.boundingBox())!.width).toBeGreaterThan(width);
    await expect(page.getByRole('navigation', { name: 'Library', exact: true })).toBeHidden();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible();
    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Search library', exact: true })).toBeFocused();
    await expect(page.getByRole('navigation', { name: 'Library', exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Email', exact: true }).click();
    const email = page.locator('iframe[title="Email preview"]');
    await expect(email).toBeVisible();
    expect((await email.boundingBox())!.width).toBeGreaterThan(600);
    await page.getByRole('radio', { name: 'Web', exact: true }).click();
    await page.getByRole('radio', { name: 'Phone', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await page.locator('.compose-preview-hero img').evaluate((element) => {
      const image = element as HTMLImageElement;
      const rect = image.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        available: image.parentElement!.clientWidth,
      };
    });
    expect(phone.width).toBeLessThanOrEqual(phone.available + 1);
    expect(phone.width / phone.height).toBeCloseTo(468 / 190, 2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'brew:sidebar-collapsed')
          throw new DOMException('Storage unavailable', 'QuotaExceededError');
        original.call(this, key, value);
      };
    });
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible();
    await expect(page.locator('.runs-sidebar-notice')).toHaveText(/could not save/);
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Library', exact: true })).toBeVisible();
  } finally {
    await fixture.close();
  }
});
