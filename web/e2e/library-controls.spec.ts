import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';

for (const theme of ['light', 'dark'] as const)
  test(`feed editors retain drafts after failures and save actual acknowledged state in ${theme}`, async ({
    page,
  }, testInfo) => {
    const f = await newslettersFixture(page, { theme });
    try {
      const feed = f.database.sqlite
        .prepare("SELECT id,retention_days AS days FROM feeds WHERE title='Design journal'")
        .get() as { id: number; days: number };
      await page.setViewportSize({ width: 780, height: 900 });
      await page.goto('/feeds');
      const row = page.getByRole('article', { name: 'Design journal', exact: true });
      await row.getByRole('button', { name: 'Rename', exact: true }).click();
      const rename = page.getByRole('dialog', { name: 'Rename feed', exact: true });
      await rename.getByLabel('Feed name', { exact: true }).fill('Retry journal');
      f.failNext('PATCH', `/api/feeds/${feed.id}`);
      await rename.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(rename.getByRole('alert')).toBeVisible();
      await expect(rename.getByLabel('Feed name', { exact: true })).toHaveValue('Retry journal');
      expect(f.database.sqlite.prepare('SELECT title FROM feeds WHERE id=?').get(feed.id)).toEqual({
        title: 'Design journal',
      });
      await rename.screenshot({ path: testInfo.outputPath(`rename-feed-${theme}.png`) });
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
          ['serious', 'critical'].includes(item.impact ?? ''),
        ),
      ).toEqual([]);
      await rename.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(rename).not.toBeVisible();
      const updated = page.getByRole('article', { name: 'Retry journal', exact: true });
      await expect(updated).toBeVisible();
      await updated
        .getByRole('button', { name: 'Edit retention for Retry journal', exact: true })
        .click();
      const retention = page.getByRole('dialog', { name: 'Feed retention', exact: true });
      await retention.getByLabel('Retention in days', { exact: true }).fill('15');
      f.failNext('PATCH', `/api/feeds/${feed.id}/retention`);
      await retention.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(retention.getByRole('alert')).toBeVisible();
      expect(
        f.database.sqlite
          .prepare('SELECT retention_days AS days FROM feeds WHERE id=?')
          .get(feed.id),
      ).toEqual({ days: feed.days });
      await page.setViewportSize({ width: 390, height: 844 });
      await retention.screenshot({ path: testInfo.outputPath(`retention-${theme}.png`) });
      const box = await retention.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.width).toBeLessThanOrEqual(390);
      await retention.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(retention).not.toBeVisible();
      await expect(
        updated.getByRole('button', { name: 'Edit retention for Retry journal', exact: true }),
      ).toHaveText('Keep 15 days');
      await page.setViewportSize({ width: 780, height: 900 });
      await page.getByRole('button', { name: 'Rename Design', exact: true }).click();
      const folder = page.getByRole('dialog', { name: 'Rename folder', exact: true });
      await folder.getByLabel('Folder name', { exact: true }).fill('Design retry');
      f.failNext('PATCH', '/api/folders/1');
      await folder.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(folder.getByRole('alert')).toBeVisible();
      await expect(folder.getByLabel('Folder name', { exact: true })).toHaveValue('Design retry');
      await folder.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(folder).not.toBeVisible();
      await expect(page.getByRole('link', { name: 'Design retry', exact: true })).toBeVisible();
    } finally {
      await f.close();
    }
  });

test('library, folder creation and hidden-article failures offer real retry without false empty or successful state', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    let libraryUnavailable = true;
    let hiddenUnavailable = false;
    await page.context().route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (
        route.request().method() === 'GET' &&
        ((path === '/api/feeds' && libraryUnavailable) ||
          (path === '/api/articles-hidden' && hiddenUnavailable))
      )
        return route.fulfill({
          status: 503,
          json: { error: 'Temporary fixture failure. Try again.' },
        });
      return route.fallback();
    });
    await page.goto('/feeds');
    await expect(page.getByRole('alert')).toContainText('Could not load the feed library');
    await expect(page.getByText('No feeds yet.', { exact: true })).toHaveCount(0);
    libraryUnavailable = false;
    await page.getByRole('button', { name: 'Retry library', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Design journal', exact: true })).toBeVisible();
    await page.getByLabel('New folder name', { exact: true }).fill('Retry new folder');
    f.failNext('POST', '/api/folders');
    await page.getByRole('button', { name: 'Create folder', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel('New folder name', { exact: true })).toHaveValue(
      'Retry new folder',
    );
    expect(
      f.database.sqlite
        .prepare("SELECT count(*) AS n FROM folders WHERE title='Retry new folder'")
        .get(),
    ).toEqual({ n: 0 });
    await page.getByRole('button', { name: 'Create folder', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Retry new folder', exact: true })).toBeVisible();
    const story = f.database.sqlite
      .prepare("SELECT id FROM articles WHERE title='Design story'")
      .get() as { id: number };
    f.database.sqlite.prepare('UPDATE articles SET hidden=1 WHERE id=?').run(story.id);
    hiddenUnavailable = true;
    await page.getByRole('link', { name: 'Hidden articles', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not load hidden articles');
    await expect(page.getByText('No hidden articles.', { exact: true })).toHaveCount(0);
    hiddenUnavailable = false;
    await page.getByRole('button', { name: 'Retry hidden articles', exact: true }).click();
    const hidden = page.getByRole('article', { name: 'Design story', exact: true });
    await expect(hidden).toBeVisible();
    await expect(
      page.locator('head link[rel="alternate"][type="application/json"]'),
    ).toHaveAttribute('href', '/feeds.json?section=hidden');
    f.failNext('POST', `/api/articles/${story.id}/unhide`);
    await hidden.getByRole('button', { name: 'Unhide', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(hidden).toBeVisible();
    expect(
      f.database.sqlite.prepare('SELECT hidden FROM articles WHERE id=?').get(story.id),
    ).toEqual({ hidden: 1 });
    await hidden.getByRole('button', { name: 'Unhide', exact: true }).click();
    await expect(hidden).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Library result', exact: true })).toContainText(
      'Unhid “Design story”.',
    );
    expect(
      f.database.sqlite.prepare('SELECT hidden FROM articles WHERE id=?').get(story.id),
    ).toEqual({ hidden: 0 });
  } finally {
    await f.close();
  }
});
