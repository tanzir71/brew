import { expect, test, type Route } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';
import { newBrewSection } from '../../packages/core/src/composition-model';
import { RulesService } from '../../targets/node/src/services/rules-service';
import { isAppPageOutputPath } from '../../packages/core/src/app-pages';

test('saved Compose, rule and instance twins follow the current selection without saving draft edits', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const service = new RulesService(f.database);
    const rule = service.create({
      name: 'Saved view',
      enabled: true,
      scope: {},
      matchType: 'all',
      conditions: [{ field: 'title', operator: 'contains', value: 'Forms' }],
      actions: [{ type: 'star' }],
      stopProcessing: false,
    });
    f.brews.updateComposition(f.morning.id, {
      ...f.morning,
      sections: [
        { ...newBrewSection('one'), title: 'First' },
        { ...newBrewSection('two'), title: 'Second' },
      ],
    });
    const forward = async (route: Route) => {
      const url = new URL(route.request().url());
      if (!isAppPageOutputPath(url.pathname)) return route.fallback();
      const response = await f.app.inject({
        method: 'GET',
        url: url.pathname + url.search,
        headers: { host: url.host },
      });
      await route.fulfill({
        status: response.statusCode,
        body: response.rawPayload,
        headers: { 'content-type': String(response.headers['content-type']) },
      });
    };
    await page.context().route('**/*.json*', forward);
    const json = page.locator('head link[rel="alternate"][type="application/json"]');
    await page.goto(`/b/${f.morning.id}/compose?section=two&sheet=schedule`);
    await expect(json).toHaveAttribute(
      'href',
      `/b/${f.morning.id}/compose.json?section=two&sheet=schedule`,
    );
    await expect(json).toHaveAttribute('title', 'Saved Compose configuration');
    let response = await page.goto(`/b/${f.morning.id}/compose.json?section=two&sheet=schedule`);
    expect((await response!.json()).state).toEqual({
      brewId: f.morning.id,
      section: 'two',
      sheet: 'schedule',
    });
    await page.goto(`/rules/${rule.id}?tab=log`);
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('Saved view');
    await expect(
      page.getByRole('region', { name: 'Rule execution log', exact: true }),
    ).toContainText('No executions yet.');
    await expect(json).toHaveAttribute('href', `/rules/${rule.id}.json?tab=log`);
    await page.getByLabel('Rule name', { exact: true }).fill('Unsaved view');
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    response = await page.goto(`/rules/${rule.id}.json?tab=log`);
    expect((await response!.json()).title).toBe('Rules · Saved view');
    expect(service.list()[0].name).toBe('Saved view');
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    await page.goto('/settings/runs#setup-agents');
    await expect(json).toHaveAttribute('href', '/settings/runs.json?setup=agents');
    response = await page.goto('/settings/runs.json?setup=agents');
    expect((await response!.json()).state).toEqual({ section: 'runs', setup: 'agents' });
  } finally {
    await f.close();
  }
});

test('newsletter list discovery survives an implicitly previewed letter and switches for an explicit open', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    f.library.updateSender(1, { favorite: true });
    await page.goto('/letters?view=favorites&sender=1&sort=name');
    const json = page.locator('head link[rel="alternate"][type="application/json"]');
    await expect(
      page.getByRole('article', { name: 'Letter from Interface Letters', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('article', { name: 'Letter from Interface Letters', exact: true })
        .getByRole('heading', { name: 'Forms should declare their tools', exact: true }),
    ).toBeVisible();
    await expect(json).toHaveAttribute('href', '/letters.json?view=favorites&sender=1&sort=name');
    await page
      .getByRole('button', { name: 'Read Forms should declare their tools', exact: true })
      .click();
    await expect(json).toHaveAttribute('href', '/a/1.json');
    await page.goBack();
    await expect(json).toHaveAttribute('href', '/letters.json?view=favorites&sender=1&sort=name');
    await page.reload();
    await expect(json).toHaveAttribute('href', '/letters.json?view=favorites&sender=1&sort=name');
    await page.goto(`/b/${f.morning.id}`);
    await expect(json).toHaveAttribute('href', `/b/${f.morning.id}/read.json`);
    await page.goto('/?view=reader&scope=brew');
    await expect(json).toHaveAttribute('href', '/reader.json');
  } finally {
    await f.close();
  }
});

test('unsupported saved-page formats never advertise working alternate links', async ({ page }) => {
  const f = await newslettersFixture(page);
  try {
    await page.route('**/api/capabilities', async (route) => {
      const response = await f.app.inject('/api/capabilities');
      await route.fulfill({
        json: { ...response.json(), outputs: { twins: false, feed: false, webhook: false } },
      });
    });
    for (const path of [
      `/b/${f.morning.id}/compose`,
      '/rules',
      '/feeds?section=health',
      '/letters',
      '/settings/runs',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.locator('head link[rel="alternate"][type="application/json"]')).toHaveCount(
        0,
      );
      await expect(page.locator('head link[rel="alternate"][type="text/markdown"]')).toHaveCount(0);
    }
  } finally {
    await f.close();
  }
});
