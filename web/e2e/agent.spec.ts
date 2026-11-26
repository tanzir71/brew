import { expect, test, type Route } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';
import { newBrewSection } from '../../packages/core/src/composition-model';
import { isArticleOutputPath } from '../../packages/core/src/article-outputs';
import { RulesService } from '../../targets/node/src/services/rules-service';
import { isReaderPageOutputPath } from '../../packages/core/src/reader-pages';
import { articles } from '../../targets/node/src/db/schema';

test('an agent reloads saved rule selection and log state and navigates feed audit views with native links', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const service = new RulesService(f.database);
    const rule = service.create({
      name: 'Saved rule view',
      enabled: true,
      matchType: 'all',
      scope: {},
      conditions: [{ field: 'title', operator: 'contains', value: 'Forms' }],
      actions: [{ type: 'star' }],
      stopProcessing: false,
    });
    f.database.sqlite.prepare('UPDATE articles SET hidden=1 WHERE id=1').run();
    await page.goto('/rules');
    await page.getByRole('link', { name: rule.name, exact: true }).click();
    await expect(page).toHaveURL(`/rules/${rule.id}`);
    await page.reload();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(rule.name);
    await page
      .getByRole('article', { name: rule.name, exact: true })
      .getByRole('link', { name: 'Logs', exact: true })
      .click();
    await expect(page).toHaveURL(`/rules/${rule.id}?tab=log`);
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Rule execution log', exact: true }),
    ).toContainText('No executions yet.');
    await page.goBack();
    await expect(page).toHaveURL(`/rules/${rule.id}`);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page).toHaveURL('/rules');
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('New rule');
    await page.getByRole('link', { name: 'Manage feeds', exact: true }).click();
    await page.getByRole('link', { name: 'Feed health', exact: true }).click();
    await expect(page).toHaveURL('/feeds?section=health');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Feed health', exact: true })).toBeVisible();
    await page.goBack();
    await page.getByRole('link', { name: 'Hidden articles', exact: true }).click();
    await expect(page).toHaveURL('/feeds?section=hidden');
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Forms should declare their tools', exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Manage feeds', exact: true }).click();
    await expect(page).toHaveURL('/feeds');
  } finally {
    await f.close();
  }
});

test('an agent reloads and navigates paged Reader and search filters and opens matching text twins', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const feed = f.database.sqlite
      .prepare("SELECT id,folder_id AS folderId FROM feeds WHERE kind='rss' ORDER BY id LIMIT 1")
      .get() as { id: number; folderId: number };
    const totalBefore = (
      f.database.sqlite
        .prepare('SELECT count(*) AS n FROM articles WHERE feed_id=?')
        .get(feed.id) as { n: number }
    ).n;
    f.database.sqlite.transaction(() => {
      for (let i = 0; i < 120; i++)
        f.database.db
          .insert(articles)
          .values({
            feedId: feed.id,
            guid: `paged-${i}`,
            hash: `paged-${i}`,
            title: `Paginationneedle ${i}`,
            url: `https://paged.fixture.test/${i}`,
            publishedAt: new Date(Date.parse('2026-11-24T01:00:00Z') + i * 1000),
            readAt: i % 2 === 0 ? new Date('2026-11-25T01:00:00Z') : null,
          })
          .run();
    })();
    const outputs: Array<Record<string, unknown>> = [];
    const forward = async (route: Route) => {
      const url = new URL(route.request().url());
      if (!isReaderPageOutputPath(url.pathname)) return route.fallback();
      const response = await f.app.inject({
        method: 'GET',
        url: url.pathname + url.search,
        headers: { host: url.host },
      });
      expect(response.statusCode).toBe(200);
      if (url.pathname.endsWith('.json')) outputs.push(response.json());
      await route.fulfill({
        status: response.statusCode,
        body: response.rawPayload,
        headers: { 'content-type': String(response.headers['content-type']) },
      });
    };
    await page.context().route('**/feed/**', forward);
    await page.context().route('**/search.*', forward);
    await page.goto(`/feed/${feed.id}?density=title&sort=oldest`);
    const footer = page.getByRole('region', { name: 'Reader page', exact: true });
    await expect(footer).toContainText(`Showing 1–50 of ${totalBefore + 120}`);
    await page
      .getByRole('navigation', { name: 'Reader pages', exact: true })
      .getByRole('link', { name: 'Next', exact: true })
      .click();
    await expect(footer).toContainText(`Showing 51–100 of ${totalBefore + 120}`);
    await expect(page).toHaveURL(/page=2&density=title&sort=oldest$/);
    await page.reload();
    await expect(footer).toContainText('Showing 51–100');
    await expect(page.getByLabel('Sort articles', { exact: true })).toHaveValue('oldest');
    await expect(page.getByRole('button', { name: 'title view', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Unread', exact: true }).click();
    await expect(page).toHaveURL(/density=title&unread=true&sort=oldest$/);
    await expect(footer).toContainText('Showing 1–50');
    const open = page.context().waitForEvent('page');
    await page
      .getByRole('navigation', { name: 'Reader text formats', exact: true })
      .getByRole('link', { name: 'JSON', exact: true })
      .click();
    const twin = await open;
    await twin.waitForLoadState();
    expect(outputs.at(-1)).toMatchObject({
      page: 1,
      filters: { kind: 'feed', unread: true, sort: 'oldest', density: 'title' },
    });
    await twin.close();
    await page.goBack();
    await expect(footer).toContainText('Showing 51–100');
    await page.goForward();
    await expect(page.getByRole('button', { name: 'Unread', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByLabel('Search', { exact: true }).fill('Paginationneedle');
    await page.getByLabel('Search', { exact: true }).press('Enter');
    await expect(page).toHaveURL(/\/search\?q=Paginationneedle/);
    await expect(footer).toContainText('Showing 1–50 of 60');
    await expect(
      page.getByRole('article', { name: 'Paginationneedle 1', exact: true }),
    ).toHaveAttribute('data-brew-density', 'title');
    await page.getByRole('button', { name: 'Starred', exact: true }).click();
    await expect(footer).toContainText('Showing 0–0 of 0');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Starred', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Current folder', exact: true }).click();
    await expect(footer).toContainText('Showing 1–50 of 60');
    await expect(page).toHaveURL(new RegExp(`scope=folder&folderId=${feed.folderId}`));
    const searchOpen = page.context().waitForEvent('page');
    await page
      .getByRole('navigation', { name: 'Reader text formats', exact: true })
      .getByRole('link', { name: 'JSON', exact: true })
      .click();
    const searchTwin = await searchOpen;
    await searchTwin.waitForLoadState();
    expect(outputs.at(-1)).toMatchObject({
      kind: 'search',
      total: 60,
      filters: { scope: 'folder', folderId: feed.folderId },
    });
    await searchTwin.close();
    await page.getByRole('link', { name: 'Rules', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Rules', exact: true })).toBeVisible();
    await page.getByLabel('Search', { exact: true }).fill('Paginationneedle');
    await page.getByLabel('Search', { exact: true }).press('Enter');
    await expect(page).toHaveURL(/\/search\?q=Paginationneedle/);
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Rules', exact: true })).toBeVisible();
  } finally {
    await f.close();
  }
});

test('an agent recovers failed history and a lost delete acknowledgement without repeating the action', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    f.failNext('GET', '/api/actions');
    await page.goto('/?view=feeds');
    await expect(page.getByRole('alert')).toContainText('Could not recover recent actions.');
    await page.getByRole('button', { name: 'Retry actions', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Retry actions', exact: true }),
    ).not.toBeVisible();
    let lost = false;
    await page.route('**/api/actions', async (route) => {
      if (route.request().method() !== 'POST' || lost) return route.fallback();
      lost = true;
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/actions',
        payload: route.request().postData()!,
        headers: { 'content-type': 'application/json' },
      });
      expect(response.statusCode).toBe(200);
      await route.fulfill({
        status: 503,
        json: { error: 'The connection closed before the result arrived.' },
      });
    });
    const feed = page.getByRole('article', { name: 'Interface Letters', exact: true });
    await feed.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete Interface Letters?', exact: true });
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('The action may have finished.');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Check result', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(feed).not.toBeVisible();
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 1,
    });
    await page
      .getByRole('region', { name: 'Action result', exact: true })
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect(feed).toBeVisible();
  } finally {
    await f.close();
  }
});

test('an agent confirms and undoes rule application, rule deletion, feed deletion and folder deletion', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const service = new RulesService(f.database);
    const rule = service.create({
      name: 'Restore labels',
      enabled: true,
      matchType: 'all',
      scope: {},
      conditions: [{ field: 'title', operator: 'contains', value: 'Forms' }],
      actions: [
        { type: 'mark_read' },
        { type: 'highlight', color: '#a0471d' },
        { type: 'add_tag', tag: 'Agent label' },
      ],
      stopProcessing: false,
    });
    const article = () =>
      f.database.sqlite
        .prepare('SELECT id,read_at,highlight_color,raw_html FROM articles WHERE id=1')
        .get();
    const original = article();
    const count = () =>
      (f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get() as { n: number })
        .n;
    await page.goto('/?view=rules');
    const row = page.getByRole('article', { name: rule.name, exact: true });
    await row.getByRole('button', { name: 'Apply 30d', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: `Apply ${rule.name}?`, exact: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(article()).toEqual(original);
    expect(count()).toBe(0);
    await row.getByRole('button', { name: 'Apply 30d', exact: true }).click();
    dialog = page.getByRole('dialog', { name: `Apply ${rule.name}?`, exact: true });
    await dialog.getByRole('button', { name: 'Apply rule', exact: true }).click();
    const result = page.getByRole('region', { name: 'Action result', exact: true });
    await expect(result).toContainText('Applied to 1 existing article.');
    expect(article()).not.toEqual(original);
    await result.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(result).toContainText('Undid local changes.');
    expect(article()).toEqual(original);
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    dialog = page.getByRole('dialog', { name: `Delete ${rule.name}?`, exact: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(service.list().some((value) => value.id === rule.id)).toBe(true);
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: `Delete ${rule.name}?`, exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(row).not.toBeVisible();
    await result.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(row).toBeVisible();
    expect(service.list().some((value) => value.id === rule.id)).toBe(true);
    await page.getByRole('link', { name: 'Manage feeds', exact: true }).click();
    const feed = page.getByRole('article', { name: 'Interface Letters', exact: true });
    await feed.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete Interface Letters?', exact: true })
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    expect(article()).toEqual(original);
    await feed.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete Interface Letters?', exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(feed).not.toBeVisible();
    expect(article()).toBeUndefined();
    await page.reload();
    await page
      .getByRole('region', { name: 'Action result', exact: true })
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect(feed).toBeVisible();
    expect(article()).toEqual(original);
    const folder = f.database.sqlite
      .prepare('SELECT id,title FROM folders ORDER BY id LIMIT 1')
      .get() as { id: number; title: string };
    const feedsBefore = f.database.sqlite
      .prepare('SELECT id,folder_id FROM feeds ORDER BY id')
      .all();
    await page.getByRole('button', { name: `Delete ${folder.title}`, exact: true }).click();
    await page
      .getByRole('dialog', { name: `Delete ${folder.title}?`, exact: true })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: `Delete ${folder.title}`, exact: true }),
    ).not.toBeVisible();
    await page
      .getByRole('region', { name: 'Action result', exact: true })
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: `Delete ${folder.title}`, exact: true }),
    ).toBeVisible();
    expect(f.database.sqlite.prepare('SELECT id,folder_id FROM feeds ORDER BY id').all()).toEqual(
      feedsBefore,
    );
  } finally {
    await f.close();
  }
});

test('an agent triages, exports, confirms and undoes bulk read, saves a rule and composes with roles and labels only', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const story = f.database.sqlite
      .prepare(
        "SELECT a.id,a.title,a.feed_id AS feedId FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE f.kind='rss' ORDER BY a.id LIMIT 1",
      )
      .get() as { id: number; title: string; feedId: number };
    f.brews.updateComposition(f.morning.id, {
      ...f.morning,
      sections: [
        {
          ...newBrewSection('stories'),
          title: 'Stories',
          sources: [{ kind: 'feed', id: story.feedId }],
        },
      ],
    });
    await f.brews.generateComposition(f.morning.id);
    const readCount = () =>
      (
        f.database.sqlite
          .prepare('SELECT count(*) AS n FROM articles WHERE read_at IS NOT NULL')
          .get() as { n: number }
      ).n;
    const before = readCount();
    await page.context().route('**/a/**', async (route) => {
      const url = new URL(route.request().url());
      if (!isArticleOutputPath(url.pathname)) return route.fallback();
      const response = await f.app.inject({
        method: 'GET',
        url: url.pathname,
        headers: { host: url.host },
      });
      await route.fulfill({
        status: response.statusCode,
        body: response.rawPayload,
        headers: { 'content-type': String(response.headers['content-type']) },
      });
    });
    await page.goto('/?view=reader&scope=all');
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Library' })).toBeVisible();
    const row = page.getByRole('article', { name: story.title, exact: true });
    await expect(row).toHaveAttribute('data-brew-id', String(story.id));
    await expect(row).toHaveAttribute('data-brew-kind', 'article');
    await expect(row).toHaveAttribute('data-brew-state', 'unread');
    await row.getByRole('button', { name: `Open article · ${story.title}`, exact: true }).click();
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    const article = reader.getByRole('article', { name: story.title, exact: true });
    await expect(article).toHaveAttribute('data-brew-state', 'read');
    await reader.getByRole('button', { name: '☆ Star', exact: true }).click();
    await expect(reader.getByRole('button', { name: '★ Starred', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(article).toHaveAttribute('data-brew-state', 'read starred');
    await reader.getByRole('button', { name: 'Tag', exact: true }).click();
    await reader.getByLabel('New tag', { exact: true }).fill('Agent picks');
    await reader.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(reader.getByRole('button', { name: 'Agent picks', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await reader.getByRole('button', { name: 'More article actions', exact: true }).click();
    const actions = page.getByRole('dialog', { name: 'Article actions', exact: true });
    await actions.getByRole('button', { name: 'Mark unread', exact: true }).click();
    await expect(actions.getByRole('button', { name: 'Mark read', exact: true })).toBeVisible();
    for (const [name, format] of [
      ['Markdown', 'md'],
      ['JSON', 'json'],
    ] as const) {
      const [popup, response] = await Promise.all([
        page.waitForEvent('popup'),
        page.context().waitForEvent('response', {
          predicate: (response) => new URL(response.url()).pathname === `/a/${story.id}.${format}`,
        }),
        actions.getByRole('link', { name, exact: true }).click(),
      ]);
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain(story.title);
      await popup.close();
    }
    await actions.getByRole('button', { name: 'Close Article actions', exact: true }).click();
    await reader.getByRole('button', { name: 'Close article', exact: true }).click();
    await expect(row).toHaveAttribute('data-brew-state', 'unread starred');
    expect(readCount()).toBe(before);
    await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
    let confirm = page.getByRole('dialog', { name: 'Mark all articles read?', exact: true });
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(readCount()).toBe(before);
    await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
    confirm = page.getByRole('dialog', { name: 'Mark all articles read?', exact: true });
    await confirm.getByRole('button', { name: 'Mark all read', exact: true }).click();
    await expect(page.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    await expect.poll(readCount).toBeGreaterThan(before);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(readCount).toBe(before);
    await page.getByRole('link', { name: 'Rules', exact: true }).click();
    await page.getByLabel('Rule name', { exact: true }).fill('Agent picks design');
    await page.getByLabel('Condition 1 value', { exact: true }).fill('Design');
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await expect(
      page.getByRole('article', { name: 'Agent picks design', exact: true }),
    ).toHaveAttribute('data-brew-kind', 'rule');
    await page.getByRole('link', { name: 'Brew home', exact: true }).click();
    await expect(
      page.getByRole('complementary', { name: 'In this Brew', exact: true }),
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Compose', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Section title', exact: true })
      .fill('Agent picked stories');
    await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
    expect(f.brews.composition(f.morning.id)!.sections[0]!.title).toBe('Agent picked stories');
    await page
      .getByRole('region', { name: 'Schedule summary', exact: true })
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Schedule & delivery', exact: true });
    await sheet.getByRole('switch', { name: 'Atom and JSON feed', exact: true }).check();
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(sheet).not.toBeVisible();
    expect(f.brews.composition(f.morning.id)!.delivery.feed).toBe(true);
    const prior = f.brews.history(f.morning.id).length;
    await page.getByRole('button', { name: 'Make one now', exact: true }).click();
    await expect.poll(() => f.brews.history(f.morning.id).length).toBe(prior + 1);
  } finally {
    await f.close();
  }
});
