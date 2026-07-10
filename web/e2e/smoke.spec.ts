import { expect, test } from '@playwright/test';
test('shows the Brew landing page', async ({ page }) => { await page.goto('/'); await expect(page.getByRole('heading', { name: 'Brew' })).toBeVisible(); });
