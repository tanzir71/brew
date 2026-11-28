import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { agentModeFixture } from './agent-mode-fixture';
import { newslettersFixture } from './newsletters-fixture';
import { RulesService } from '../../targets/node/src/services/rules-service';

test('temporary agent links survive Brew, Compose, Reader, newsletters and Rules URL changes without saving a preference', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const service = new RulesService(f.database);
    service.create({
      name: 'Agent navigation rule',
      enabled: false,
      matchType: 'all',
      scope: {},
      conditions: [{ field: 'title', operator: 'contains', value: 'Agent' }],
      actions: [{ type: 'star' }],
      stopProcessing: false,
    });
    await page.goto(`/?view=brew&brew=${f.morning.id}&agent=1`);
    await page.getByRole('radio', { name: 'Compose', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/b/${f.morning.id}/compose\\?agent=1$`));
    await expect(page.locator('html')).toHaveAttribute('data-agent-mode', 'true');
    await page.getByRole('radio', { name: 'Read', exact: true }).click();
    expect(new URL(page.url()).searchParams.get('agent')).toBe('1');
    const sidebar = page.getByRole('navigation', { name: 'Library', exact: true });
    await expect(sidebar.getByRole('link', { name: /^All articles/ })).toHaveAttribute(
      'href',
      '/?view=reader&scope=all&agent=1',
    );
    await sidebar.getByRole('link', { name: 'Newsletters', exact: false }).click();
    await expect(page.locator('html')).toHaveAttribute('data-agent-mode', 'true');
    await page.getByRole('link', { name: 'Low Tide', exact: false }).click();
    expect(new URL(page.url()).searchParams.get('agent')).toBe('1');
    await page
      .getByRole('navigation', { name: 'Library', exact: true })
      .getByRole('link', { name: 'Rules', exact: true })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-agent-mode', 'true');
    await page.getByRole('link', { name: 'Logs', exact: true }).click();
    await expect(page).toHaveURL(/\/rules\/\d+\?tab=log&agent=1$/);
    expect(new URL(page.url()).searchParams.get('agent')).toBe('1');
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
    await expect(help.getByRole('link', { name: 'Open Reader', exact: true })).toHaveAttribute(
      'href',
      '/all?agent=1',
    );
    await help.getByRole('link', { name: 'Open Reader', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Article results', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('brew:agent-mode'))).toBeNull();
  } finally {
    await f.close();
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`URL agent mode exposes full numbered pages, disables motion and leaves reads unchanged in ${theme}`, async ({
    page,
  }, testInfo) => {
    const f = await agentModeFixture(page, theme);
    const requests: URL[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/articles')
        requests.push(new URL(request.url()));
    });
    await page.addInitScript(() => localStorage.setItem('brew:mark-read-on-scroll', 'true'));
    try {
      const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
      await page.goto('/all?density=title&agent=1');
      const list = page.getByRole('region', { name: 'Article results', exact: true });
      await expect(list.getByRole('article')).toHaveCount(50);
      await expect(page.getByRole('region', { name: 'Reader page', exact: true })).toContainText(
        'Showing 1–50 of 121',
      );
      await expect(page.getByLabel('Read on scroll', { exact: true })).toBeDisabled();
      await expect(page.getByLabel('Read on scroll', { exact: true })).not.toBeChecked();
      expect(await page.evaluate(() => localStorage.getItem('brew:mark-read-on-scroll'))).toBe(
        'true',
      );
      expect(await page.evaluate(() => localStorage.getItem('brew:agent-mode'))).toBeNull();
      expect(await list.locator('[data-index]').count()).toBe(0);
      const last = list.getByRole('button', {
        name: 'Open article · Agent story 050',
        exact: true,
      });
      await last.focus();
      await expect(last).toBeInViewport();
      await list.focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('PageDown');
      await page.keyboard.press('End');
      expect(
        await list
          .getByRole('article')
          .first()
          .evaluate((element) => ({
            animation: getComputedStyle(element).animationName,
            transition: getComputedStyle(element).transitionDuration,
          })),
      ).toEqual({ animation: 'none', transition: '0s' });
      expect(
        await page
          .getByRole('navigation', { name: 'Library', exact: true })
          .getByRole('link', { name: /^All/ })
          .evaluate((element) => getComputedStyle(element).transitionDuration),
      ).toBe('0s');
      expect(
        requests.every(
          (url) => url.searchParams.get('offset') === '0' && !url.searchParams.has('cursor'),
        ),
      ).toBe(true);
      await page.getByRole('link', { name: 'Page 2', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'All articles', exact: true })).toBeFocused();
      await expect(list.getByRole('article')).toHaveCount(50);
      await expect(page.getByRole('region', { name: 'Reader page', exact: true })).toContainText(
        'Showing 51–100 of 121',
      );
      await expect(page.getByRole('link', { name: 'Page 3', exact: true })).toHaveAttribute(
        'href',
        '/all?page=3&density=title&agent=1',
      );
      await page.getByRole('link', { name: 'Page 3', exact: true }).click();
      await expect(list.getByRole('article')).toHaveCount(21);
      await expect(page.getByRole('region', { name: 'Reader page', exact: true })).toContainText(
        'Showing 101–121 of 121',
      );
      await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
          ['serious', 'critical'].includes(v.impact ?? ''),
        ),
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`agent-page-${theme}.png`) });
      await page.reload();
      await expect(list.getByRole('article')).toHaveCount(21);
      await page.goto('/all?page=4&density=title&agent=1');
      await expect(list.getByRole('article')).toHaveCount(0);
      await expect(page.getByLabel('Page 4', { exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByRole('link', { name: 'First page', exact: true })).toHaveAttribute(
        'href',
        '/all?density=title&agent=1',
      );
      await page.getByRole('link', { name: 'First page', exact: true }).click();
      await expect(list.getByRole('article')).toHaveCount(50);
      expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
      expect(
        f.database.sqlite
          .prepare('SELECT count(*) AS n FROM articles WHERE read_at IS NOT NULL')
          .get(),
      ).toEqual({ n: 0 });
    } finally {
      await f.close();
    }
  });
}

test('agent search pages preserve folder/starred scopes, exact twins, filters and history without loading ahead', async ({
  page,
}) => {
  const f = await agentModeFixture(page);
  const requests: URL[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/search') requests.push(new URL(request.url()));
  });
  try {
    await page.goto(
      `/search?q=Agent&scope=folder&folderId=${f.folder.id}&page=2&density=title&unread=true&sort=oldest&agent=1`,
    );
    const list = page.getByRole('region', { name: 'Search results', exact: true });
    await expect(list.getByRole('article')).toHaveCount(50);
    await expect(list.getByRole('article').first()).toHaveAccessibleName('Agent story 071');
    const next = page.getByRole('link', { name: 'Page 3', exact: true });
    await expect(next).toHaveAttribute(
      'href',
      `/search?q=Agent&scope=folder&folderId=${f.folder.id}&page=3&density=title&unread=true&sort=oldest&agent=1`,
    );
    await list.focus();
    await page.keyboard.press('End');
    expect(requests.every((url) => url.searchParams.get('offset') === '50')).toBe(true);
    await next.click();
    await expect(list.getByRole('article')).toHaveCount(21);
    await expect(page.getByRole('heading', { name: '“Agent”', exact: true })).toBeFocused();
    const json = page
      .getByRole('navigation', { name: 'Reader text formats', exact: true })
      .getByRole('link', { name: 'JSON', exact: true });
    expect(await json.getAttribute('href')).toContain('page=3');
    const response = await f.app.inject({ method: 'GET', url: (await json.getAttribute('href'))! });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      page: 3,
      pageSize: 50,
      total: 121,
      showing: { from: 101, to: 121 },
      filters: { agent: true, scope: 'folder', unread: true, sort: 'oldest' },
    });
    await page.goBack();
    await expect(page.getByRole('region', { name: 'Reader page', exact: true })).toContainText(
      'Showing 51–100 of 121',
    );
    await page.getByRole('button', { name: 'Starred', exact: true }).click();
    await expect(list.getByRole('article')).toHaveCount(3);
    await expect(page.getByRole('region', { name: 'Reader page', exact: true })).toContainText(
      'Showing 1–3 of 3',
    );
    expect(new URL(page.url()).searchParams.get('agent')).toBe('1');
    await page.reload();
    await expect(list.getByRole('article')).toHaveCount(3);
    expect(
      f.database.sqlite
        .prepare('SELECT count(*) AS n FROM articles WHERE read_at IS NOT NULL')
        .get(),
    ).toEqual({ n: 0 });
  } finally {
    await f.close();
  }
});

test('agent setting saves across reload/tabs, reports storage failures and leaves URL overrides temporary', async ({
  page,
}, testInfo) => {
  const f = await agentModeFixture(page);
  try {
    await page.goto('/settings/runs#setup-agents');
    const dialog = page.getByRole('dialog', { name: 'Agent access', exact: true });
    const toggle = dialog.getByRole('switch', { name: 'Agent-friendly mode', exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await expect(
      dialog.getByRole('region', { name: 'Agent preferences result', exact: true }),
    ).toHaveText('Agent-friendly mode saved in this browser.');
    const target = (await toggle.boundingBox())!;
    expect(target.height).toBeGreaterThanOrEqual(24);
    expect(target.width).toBeGreaterThanOrEqual(24);
    await page.screenshot({ path: testInfo.outputPath('agent-setting-light.png') });
    await page.reload();
    await expect(toggle).toBeChecked();
    const other = await page.context().newPage();
    await other.goto('/all?density=title');
    await expect(
      other.getByRole('region', { name: 'Article results', exact: true }).getByRole('article'),
    ).toHaveCount(50);
    await other
      .getByRole('button', { name: 'Open article · Agent story 001', exact: true })
      .click();
    const article = other.getByRole('dialog', { name: 'Article reader', exact: true });
    await article.getByRole('button', { name: 'Tag', exact: true }).click();
    await article.getByLabel('New tag', { exact: true }).fill('Keep this draft');
    await toggle.click();
    await expect(other.getByTestId('virtual-article-list')).toBeAttached();
    await expect(article.getByLabel('New tag', { exact: true })).toHaveValue('Keep this draft');
    await other.close();
    await page.evaluate(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'brew:agent-mode') throw new Error('Storage unavailable');
        return write.call(this, key, value);
      };
    });
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(dialog.getByRole('alert')).toContainText(
      'Could not save agent-friendly mode. Your saved preference was kept.',
    );
    await page.goto('/settings/runs?agent=1#setup-agents');
    await expect(toggle).not.toBeChecked();
    await expect(dialog.getByRole('status')).toContainText('This URL enables agent-friendly mode');
    expect(await page.locator('html').getAttribute('data-agent-mode')).toBe('true');
    await dialog.getByRole('link', { name: 'Use saved preference', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-agent-mode', 'false');
    expect(await page.evaluate(() => localStorage.getItem('brew:agent-mode'))).toBe('false');
  } finally {
    await f.close();
  }
});

test('agent lists render all densities and Today groups in the DOM and restore the normal list when history removes the flag', async ({
  page,
}, testInfo) => {
  const f = await agentModeFixture(page, 'dark');
  try {
    await page.goto('/all?density=title');
    await expect(page.getByTestId('virtual-article-list')).toBeVisible();
    await page.goto('/today?density=title&agent=1');
    const list = page.getByRole('region', { name: 'Article results', exact: true });
    await expect(list.getByRole('article')).toHaveCount(50);
    await expect(list.getByRole('heading', { name: 'Agent library', exact: true })).toBeVisible();
    await list.focus();
    for (let i = 0; i < 50; i++) await page.keyboard.press('j');
    await expect(
      list.getByRole('article', { name: 'Agent story 050', exact: true }),
    ).toBeInViewport();
    for (const density of ['magazine', 'cards', 'title']) {
      await page
        .getByRole('radio', {
          name: { title: 'Titles', magazine: 'Magazine', cards: 'Cards' }[density],
          exact: true,
        })
        .click();
      await expect(list.getByRole('article')).toHaveCount(50);
      expect(await list.locator('[data-index]').count()).toBe(0);
    }
    await page.goto('/settings/runs?agent=1#setup-agents');
    await expect(page.getByRole('dialog', { name: 'Agent access', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('agent-setting-dark.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('agent-setting-phone-dark.png') });
    await expect(
      page.getByRole('switch', { name: 'Agent-friendly mode', exact: true }),
    ).toBeInViewport();
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      ),
    ).toEqual([]);
    await page.goBack();
    await expect(list.getByRole('article')).toHaveCount(50);
    await page.goto('/all?density=title');
    await expect(page.getByTestId('virtual-article-list')).toBeVisible();
    expect(await page.locator('html').getAttribute('data-agent-mode')).toBe('false');
  } finally {
    await f.close();
  }
});
