import { expect, test } from '@playwright/test';

test('switches system, light, and dark themes instantly and persists the choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'dark');
  const darkCanvas = await page.locator('main').evaluate((element) => getComputedStyle(element).backgroundColor);

  await page.getByLabel('Theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'light');
  const lightCanvas = await page.locator('main').evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(lightCanvas).not.toBe(darkCanvas);
  expect(await page.evaluate(() => localStorage.getItem('brew:theme'))).toBe('light');

  await page.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'dark');
  expect(await page.locator('main').evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(darkCanvas);

  await page.getByLabel('Theme').selectOption('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'light');
});
