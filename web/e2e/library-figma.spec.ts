import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { composeFixture } from './compose-fixture';
import { RulesService } from '../../targets/node/src/services/rules-service';

for (const theme of ['light', 'dark'] as const) {
  test(`Reader and multi-source Rules use the Figma library shell in ${theme}`, async ({
    page,
  }) => {
    const f = await composeFixture(page, theme);
    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => {
        localStorage.setItem('brew:article-open-mode', 'pane');
        localStorage.setItem('brew:direct-images', 'true');
      });
      const rule = new RulesService(f.database).create({
        name: 'Figma mentions',
        enabled: true,
        matchType: 'any',
        scope: { folderIds: [1, 2] },
        conditions: [
          { field: 'title', operator: 'contains', value: 'figma' },
          { field: 'content', operator: 'matches_regex', value: '\\bfigjam|figma\\b' },
          { field: 'author', operator: 'equals', value: 'Jo Park' },
        ],
        actions: [
          { type: 'highlight', color: '#6e9278' },
          { type: 'add_tag', tag: 'Tools' },
          { type: 'feature_in_brew' },
        ],
        stopProcessing: false,
      });
      const service = new RulesService(f.database);
      for (const row of f.database.sqlite.prepare('SELECT id FROM articles').all() as {
        id: number;
      }[])
        await service.evaluateArticle(row.id);
      await page.goto('/f/1?density=title');
      await page
        .getByRole('button', {
          name: 'Open article · Figma’s variables panel, a month in',
          exact: true,
        })
        .click();
      const pane = page.getByRole('dialog', { name: 'Article reader', exact: true });
      await expect(pane).toBeVisible();
      await expect(pane.locator('h1')).toHaveText('Figma’s variables panel, a month in');
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page
        .locator('.reader-main, .reader-topbar, .reader-list-body, .article-reader--pane')
        .evaluateAll((nodes) =>
          nodes.map((n) => ({
            x: n.getBoundingClientRect().x,
            width: n.getBoundingClientRect().width,
            height: n.getBoundingClientRect().height,
          })),
        );
      expect(geometry[0]!.x).toBe(256);
      expect(geometry[1]!.height).toBe(56);
      expect(geometry[2]!.width).toBe(500);
      expect(geometry[3]!.x).toBe(757);
      await expect(page).toHaveScreenshot(`figma-library-reader-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.01,
      });
      await page.goto(`/rules/${rule.id}`);
      await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('Figma mentions');
      await expect(page.getByRole('button', { name: 'Rule scope', exact: true })).toHaveText(
        'Design',
      );
      await expect(
        page.getByRole('button', { name: 'Rule scope · Independent', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: /^Would match [1-9]/ })).toBeVisible();
      await expect(page).toHaveScreenshot(`figma-library-rules-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.01,
      });
      const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      );
      expect(violations).toEqual([]);
      await page.getByRole('button', { name: 'Rule scope', exact: true }).click();
      const sources = page.getByRole('dialog', { name: 'Rule sources', exact: true });
      await sources.getByRole('checkbox', { name: 'Independent', exact: true }).uncheck();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('button', { name: 'Save rule', exact: true }).click();
      await expect(
        page.getByRole('status', { name: 'Rule editor result', exact: true }),
      ).toContainText('Rule saved.');
      expect(service.list().find((value) => value.id === rule.id)?.scope.folderIds).toEqual([1]);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Rule scope', exact: true })).toHaveText(
        'Design',
      );
      await expect(
        page.getByRole('button', { name: 'Rule scope · Independent', exact: true }),
      ).toHaveCount(0);
    } finally {
      await f.close();
    }
  });
}

test('a delayed saved-rule toggle preserves a newer editor draft', async ({ page }) => {
  const f = await composeFixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const started = new Promise<void>((resolve) => {
    reached = resolve;
  });
  try {
    const service = new RulesService(f.database);
    const rule = service.create({
      name: 'Saved highlight',
      enabled: true,
      matchType: 'all',
      scope: {},
      conditions: [{ field: 'title', operator: 'contains', value: 'Figma' }],
      actions: [{ type: 'highlight', color: '#6e9278' }],
      stopProcessing: false,
    });
    await page.route(`**/api/rules/${rule.id}`, async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      reached();
      await held;
      const response = await f.app.inject({
        method: 'PUT',
        url: `/api/rules/${rule.id}`,
        payload: route.request().postDataJSON(),
      });
      return route.fulfill({ status: response.statusCode, json: response.json() });
    });
    await page.goto(`/rules/${rule.id}`);
    await page.getByRole('switch', { name: 'Enable Saved highlight', exact: true }).click();
    await started;
    await page.getByRole('button', { name: 'New rule', exact: true }).click();
    await page.getByLabel('Rule name', { exact: true }).fill('New unsaved rule');
    release();
    await expect(
      page.getByRole('switch', { name: 'Enable Saved highlight', exact: true }),
    ).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Enabled', exact: true })).toBeChecked();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('New unsaved rule');
    expect(service.list().find((value) => value.id === rule.id)?.enabled).toBe(false);
  } finally {
    release();
    await f.close();
  }
});
