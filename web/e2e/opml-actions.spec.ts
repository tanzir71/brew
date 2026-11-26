import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';

for (const theme of ['light', 'dark'] as const)
  test(`OPML preview retries the retained file and pages a bulk review accessibly in ${theme}`, async ({
    page,
  }, testInfo) => {
    const f = await newslettersFixture(page, { theme });
    try {
      const count = () => f.database.sqlite.prepare('SELECT count(*) AS n FROM feeds').get();
      const before = count();
      const xml = `<opml><body>${Array.from({ length: 53 }, (_, i) => `<outline text="Review ${i + 1}" xmlUrl="https://review.test/${i + 1}"/>`).join('')}</body></opml>`;
      await page.setViewportSize({ width: 780, height: 900 });
      await page.goto('/feeds');
      await expect(page.getByRole('button', { name: 'Import OPML', exact: true })).toBeEnabled();
      f.failNext('POST', '/api/opml/preview');
      await page
        .getByLabel('Import OPML', { exact: true })
        .setInputFiles({ name: 'review.opml', mimeType: 'text/x-opml', buffer: Buffer.from(xml) });
      await expect(page.getByRole('alert')).toContainText('Temporary fixture failure');
      expect(count()).toEqual(before);
      await page.getByRole('button', { name: 'Retry OPML preview', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Import OPML?', exact: true });
      await expect(dialog).toContainText('53 new feeds');
      const rows = dialog
        .getByRole('list', { name: 'OPML subscriptions', exact: true })
        .getByRole('listitem');
      await expect(rows).toHaveCount(50);
      await expect(dialog).toContainText('Showing 1–50 of 53 outlines');
      await dialog.getByRole('button', { name: 'Next outlines', exact: true }).click();
      await expect(rows).toHaveCount(3);
      await expect(dialog).toContainText('Showing 51–53 of 53 outlines');
      await expect(
        dialog.getByRole('button', { name: 'Next outlines', exact: true }),
      ).toBeDisabled();
      await dialog.getByRole('button', { name: 'Previous outlines', exact: true }).click();
      await expect(rows).toHaveCount(50);
      await dialog.screenshot({ path: testInfo.outputPath(`opml-${theme}.png`) });
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
          ['serious', 'critical'].includes(item.impact ?? ''),
        ),
      ).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      await dialog.screenshot({ path: testInfo.outputPath(`opml-phone-${theme}.png`) });
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.width).toBeLessThanOrEqual(390);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Import OPML', exact: true })).toBeFocused();
      expect(count()).toEqual(before);
      expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
        n: 0,
      });
    } finally {
      await f.close();
    }
  });

test('OPML remains visible with setup guidance when durable Undo is unavailable', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const caps = (await f.app.inject('/api/capabilities')).json();
    await page
      .context()
      .route('**/api/capabilities', (route) =>
        route.fulfill({ json: { ...caps, actions: { ...caps.actions, undo: false } } }),
      );
    await page.goto('/feeds');
    await expect(page.getByRole('button', { name: 'Import OPML', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Import OPML', { exact: true })).toBeDisabled();
    await expect(
      page.getByRole('link', { name: 'Set up OPML import', exact: true }),
    ).toHaveAttribute('href', '/settings/runs#setup-data');
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
  } finally {
    await f.close();
  }
});
