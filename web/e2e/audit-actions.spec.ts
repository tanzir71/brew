import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';

for (const theme of ['light', 'dark'] as const)
  test(`feed audit More sheets retain native focus and accessible targets in ${theme}`, async ({
    page,
  }, testInfo) => {
    const f = await newslettersFixture(page, { theme });
    try {
      const story = f.database.sqlite
        .prepare("SELECT id FROM articles WHERE title='Design story'")
        .get() as { id: number };
      f.database.sqlite.prepare('UPDATE articles SET hidden=1 WHERE id=?').run(story.id);
      await page.setViewportSize({ width: 900, height: 900 });
      await page.goto('/feeds?section=health');
      const more = page
        .getByRole('article', { name: 'Design journal', exact: true })
        .getByRole('button', { name: 'More actions for feed Design journal', exact: true });
      const box = await more.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(24);
      expect(box!.width).toBeGreaterThanOrEqual(24);
      await more.focus();
      await page.keyboard.press('Enter');
      const health = page.getByRole('dialog', { name: 'Feed actions', exact: true });
      await expect(health.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
      await health.screenshot({ path: testInfo.outputPath(`health-actions-${theme}.png`) });
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
          ['serious', 'critical'].includes(item.impact ?? ''),
        ),
      ).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(more).toBeFocused();
      await page.goto('/feeds?section=hidden');
      const row = page.getByRole('article', { name: 'Design story', exact: true });
      const hiddenMore = row.getByRole('button', {
        name: 'More actions for hidden article Design story',
        exact: true,
      });
      await expect(row.getByRole('link', { name: 'Design story', exact: true })).toHaveAttribute(
        'href',
        `/a/${story.id}`,
      );
      await hiddenMore.click();
      const hidden = page.getByRole('dialog', { name: 'Hidden article actions', exact: true });
      await expect(hidden.getByRole('link', { name: 'Markdown', exact: true })).toHaveAttribute(
        'href',
        `/a/${story.id}.md`,
      );
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
          ['serious', 'critical'].includes(item.impact ?? ''),
        ),
      ).toEqual([]);
      await hidden.screenshot({ path: testInfo.outputPath(`hidden-actions-${theme}.png`) });
      await page.setViewportSize({ width: 390, height: 844 });
      await hidden.screenshot({ path: testInfo.outputPath(`hidden-actions-phone-${theme}.png`) });
      const mobile = await hidden.boundingBox();
      expect(mobile!.x).toBeGreaterThanOrEqual(0);
      expect(mobile!.width).toBeLessThanOrEqual(390);
      await page.keyboard.press('Escape');
      await expect(hiddenMore).toBeFocused();
      await row.getByRole('link', { name: 'Design story', exact: true }).click();
      await expect(page).toHaveURL(`/a/${story.id}`);
      await expect(page.getByRole('article', { name: 'Design story', exact: true })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL('/feeds?section=hidden');
      await expect(row).toBeVisible();
    } finally {
      await f.close();
    }
  });

test('audit actions keep unsupported deletion and hidden content formats visible with setup guidance', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    f.database.sqlite.prepare("UPDATE articles SET hidden=1 WHERE title='Design story'").run();
    const caps = (await f.app.inject('/api/capabilities')).json();
    await page.context().route('**/api/capabilities', (route) =>
      route.fulfill({
        json: {
          ...caps,
          actions: { ...caps.actions, undo: false },
          outputs: { ...caps.outputs, twins: false },
        },
      }),
    );
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    await page.goto('/feeds?section=health');
    await page
      .getByRole('article', { name: 'Design journal', exact: true })
      .getByRole('button', { name: 'More actions for feed Design journal', exact: true })
      .click();
    await expect(
      page
        .getByRole('dialog', { name: 'Feed actions', exact: true })
        .getByRole('button', { name: 'Delete', exact: true }),
    ).toBeDisabled();
    await expect(
      page
        .getByRole('dialog', { name: 'Feed actions', exact: true })
        .getByRole('link', { name: 'Set up actions', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: 'Set up actions', exact: true })).toBeVisible();
    await page.goto('/feeds?section=hidden');
    await page
      .getByRole('button', { name: 'More actions for hidden article Design story', exact: true })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Hidden article actions', exact: true });
    await expect(
      sheet.getByRole('button', { name: 'Markdown Twins need setup', exact: true }),
    ).toBeDisabled();
    await expect(
      sheet.getByRole('button', { name: 'JSON Twins need setup', exact: true }),
    ).toBeDisabled();
    await expect(
      sheet.getByRole('link', { name: 'Set up article outputs', exact: true }),
    ).toHaveAttribute('href', '/settings/runs#setup-outputs');
    await page.keyboard.press('Escape');
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  } finally {
    await f.close();
  }
});

test('a completed health fetch reports a failed read refresh truthfully and retries the view without refetching the feed', async ({
  page,
}) => {
  let fetched = 0;
  const f = await newslettersFixture(page, {
    fetcher: async () => {
      fetched++;
      return new Response(
        '<rss version="2.0"><channel><title>Journal</title><link>https://rss.fixture.test/</link><description>Fixture</description></channel></rss>',
      );
    },
  });
  try {
    let unavailable = false;
    await page
      .context()
      .route('**/api/feeds', (route) =>
        route.request().method() === 'GET' && unavailable
          ? route.fulfill({ status: 503, json: { error: 'Temporary read failure.' } })
          : route.fallback(),
      );
    await page.goto('/feeds?section=health');
    const row = page.getByRole('article', { name: 'Design journal', exact: true });
    await expect(row).toBeVisible();
    const feed = f.database.sqlite
      .prepare("SELECT id FROM feeds WHERE title='Design journal'")
      .get() as { id: number };
    unavailable = true;
    await row.getByRole('button', { name: 'Fetch now', exact: true }).click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'The fetch finished, but the library could not refresh' }),
    ).toBeVisible();
    expect(fetched).toBe(1);
    expect(
      f.database.sqlite.prepare('SELECT last_status AS status FROM feeds WHERE id=?').get(feed.id),
    ).toEqual({ status: 200 });
    unavailable = false;
    await page.getByRole('button', { name: 'Retry library', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Library result', exact: true })).toContainText(
      'Library reloaded.',
    );
    await expect(
      page.getByRole('article', { name: 'Journal', exact: true }).getByText('200', { exact: true }),
    ).toBeVisible();
    expect(fetched).toBe(1);
  } finally {
    await f.close();
  }
});
