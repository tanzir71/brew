import { expect, test, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newslettersFixture } from './newsletters-fixture';
import { newBrewSection } from '../../packages/core/src/composition-model';
import { isArticleOutputPath } from '../../packages/core/src/article-outputs';
import { RulesService } from '../../targets/node/src/services/rules-service';
import { isReaderPageOutputPath } from '../../packages/core/src/reader-pages';
import { articles } from '../../targets/node/src/db/schema';
import { composeFixture } from './compose-fixture';
import { BrewService } from '../../targets/node/src/services/brew-service';
import { agentModeFixture } from './agent-mode-fixture';
import { seedRuleHistory } from './rule-history-fixture';

test('an agent pages the complete execution history, follows matching twins and recovers keyboard focus after Undo', async ({ page }) => {
  const f = await newslettersFixture(page);
  try {
    const { rule, service } = seedRuleHistory(f);
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    await page.context().route('**/rules/*.json*', async (route) => {
      const url = new URL(route.request().url());
      const response = await f.app.inject({ method: 'GET', url: url.pathname + url.search });
      await route.fulfill({ status: response.statusCode, body: response.rawPayload, headers: { 'content-type': String(response.headers['content-type']) } });
    });
    await page.goto(`/rules/${rule.id}?tab=log&agent=1`);
    await expect(page.getByRole('main', { name: 'Rules', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Library', exact: true })).toBeVisible();
    const log = page.getByRole('region', { name: 'Rule execution log', exact: true });
    await expect(page.getByRole('status', { name: 'Saved rule total', exact: true })).toHaveText('1 saved rule');
    await expect(log.getByRole('status', { name: 'Execution range', exact: true })).toHaveText('Showing 1–50 of 126 executions');
    await page.getByLabel('Rule name', { exact: true }).fill('Unsaved history draft');
    await log.getByRole('link', { name: 'Next', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(log.getByRole('status', { name: 'Execution range', exact: true })).toHaveText('Showing 51–100 of 126 executions');
    await expect(log.getByRole('heading', { name: 'Recent executions', exact: true })).toBeFocused();
    await log.getByRole('link', { name: 'Page 3', exact: true }).click();
    await expect(log.getByRole('status', { name: 'Execution range', exact: true })).toHaveText('Showing 101–126 of 126 executions');
    await expect(log.getByRole('article')).toHaveCount(26);
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('Unsaved history draft');
    const [popup, response] = await Promise.all([
      page.waitForEvent('popup'),
      page.context().waitForEvent('response', { predicate: (response) => new URL(response.url()).pathname === `/rules/${rule.id}.json` }),
      log.getByRole('link', { name: 'JSON', exact: true }).click(),
    ]);
    const document = await response.json();
    expect(document.sections[1].data).toMatchObject({ total: 126, shown: 26, page: 3 });
    expect(document.sections[1].items).toHaveLength(26);
    await popup.close();
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    await page.getByRole('button', { name: 'More actions for rule History rule', exact: true }).click();
    await page.getByRole('dialog', { name: 'Rule actions', exact: true }).getByRole('button', { name: 'Copy', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Saved rule total', exact: true })).toHaveText('2 saved rules');
    await page.reload();
    await page.getByRole('button', { name: 'Undo', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Action result', exact: true })).toBeFocused();
    await expect(page.getByRole('status', { name: 'Saved rule total', exact: true })).toHaveText('1 saved rule');
    expect(service.list()).toHaveLength(1);
    expect((await f.app.inject(`/api/rules/${rule.id}/executions?page=3`)).json().items).toHaveLength(26);
  } finally { await f.close(); }
});

test('an agent recovers a copied rule through More, reloads Undo and saves the duplicate filter using native controls', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const service = new RulesService(f.database);
    const rule = service.create({
      name: 'Agent copy source',
      enabled: false,
      matchType: 'all',
      scope: {},
      conditions: [{ field: 'title', operator: 'contains', value: 'Forms' }],
      actions: [{ type: 'star' }],
      stopProcessing: false,
    });
    const beforeArticles = f.database.sqlite.prepare('SELECT * FROM articles ORDER BY id').all();
    let lost = true;
    const identities: string[] = [];
    await page.route('**/api/actions', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const payload = route.request().postDataJSON();
      identities.push(payload.requestId);
      const response = await f.app.inject({ method: 'POST', url: '/api/actions', payload });
      if (lost) {
        lost = false;
        return route.abort('failed');
      }
      return route.fulfill({ status: response.statusCode, json: response.json() });
    });
    await page.goto(`/rules/${rule.id}?agent=1`);
    await page
      .getByRole('button', { name: 'More actions for rule Agent copy source', exact: true })
      .click();
    const more = page.getByRole('dialog', { name: 'Rule actions', exact: true });
    await more.getByRole('button', { name: 'Copy', exact: true }).click();
    const recovery = page.getByRole('dialog', { name: 'Copy Agent copy source?', exact: true });
    await recovery.getByRole('button', { name: 'Check result', exact: true }).click();
    await expect(
      page.getByRole('article', { name: 'Agent copy source copy', exact: true }),
    ).toHaveAttribute('data-brew-state', 'disabled');
    expect(service.list()).toHaveLength(2);
    expect(new Set(identities).size).toBe(1);
    expect(f.database.sqlite.prepare('SELECT * FROM articles ORDER BY id').all()).toEqual(
      beforeArticles,
    );
    await page.reload();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(
      page.getByRole('article', { name: 'Agent copy source copy', exact: true }),
    ).toHaveCount(0);
    expect(service.list()).toHaveLength(1);
    expect(new URL(page.url()).searchParams.get('agent')).toBe('1');
    const filter = page.getByLabel('Hide near-duplicate titles (3 days)', { exact: true });
    await expect(filter).toBeEnabled();
    await filter.click();
    await expect(
      page.getByRole('status', { name: 'Duplicate filter result', exact: true }),
    ).toHaveText('Duplicate filter enabled.');
    expect((await f.app.inject('/api/rules/duplicate-filter')).json()).toEqual({ enabled: true });
    await page.reload();
    await expect(filter).toBeChecked();
  } finally {
    await f.close();
  }
});


test('an agent uses compact rule targets, edits native draft controls and cancels deletion without writes', async ({ page }) => {
  const f = await newslettersFixture(page);
  try {
    const service = new RulesService(f.database);
    service.create({ name: 'Target rule', enabled: false, matchType: 'all', scope: {}, conditions: [{ field: 'title', operator: 'contains', value: 'Design' }], actions: [{ type: 'star' }], stopProcessing: false });
    await page.goto('/rules');
    const original = page.getByRole('article', { name: 'Target rule', exact: true });
    const copy = original.getByRole('button', { name: 'Copy', exact: true });
    await expect(copy).toBeEnabled();
    const box = (await copy.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    await page.mouse.click(box.x + box.width / 2, box.y + 1);
    const copied = page.getByRole('article', { name: 'Target rule copy', exact: true });
    await expect(copied).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Rule name', exact: true })).toHaveValue('Target rule copy');
    expect(f.database.sqlite.prepare('SELECT name,enabled FROM rules ORDER BY id').all()).toEqual([{ name: 'Target rule', enabled: 0 }, { name: 'Target rule copy', enabled: 0 }]);
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    const enabled = page.getByRole('checkbox', { name: 'Enabled', exact: true });
    await enabled.focus();
    await page.keyboard.press('Space');
    await expect(enabled).toBeChecked();
    await page.getByRole('button', { name: '+ Add condition', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Condition 2 value', { exact: true }).fill('Draft only');
    const remove = copied.getByRole('button', { name: 'Delete', exact: true });
    const target = (await remove.boundingBox())!;
    expect(target.height).toBeGreaterThanOrEqual(24);
    await page.mouse.click(target.x + target.width / 2, target.y + target.height - 1);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(remove).toBeFocused();
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM rules').get()).toEqual({ n: 2 });
  } finally { await f.close(); }
});

test('an agent enables saved agent mode, pages the full DOM by keyboard and reads an exact search item', async ({ page }) => {
  const f = await agentModeFixture(page);
  try {
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    await page.goto('/settings/runs#setup-agents');
    const guide = page.getByRole('dialog', { name: 'Agent access', exact: true });
    const toggle = guide.getByRole('switch', { name: 'Agent-friendly mode', exact: true });
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toBeChecked();
    await page.keyboard.press('Escape');
    await page.getByRole('navigation', { name: 'Library', exact: true }).getByRole('link', { name: /^All articles/ }).click();
    const list = page.getByRole('region', { name: 'Article results', exact: true });
    await expect(list.getByRole('article')).toHaveCount(50);
    await list.getByRole('button', { name: 'Open article · Agent story 050', exact: true }).focus();
    const next = page.getByRole('link', { name: 'Page 2', exact: true });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'All articles', exact: true })).toBeFocused();
    await expect(list.getByRole('article')).toHaveCount(50);
    await expect(page.getByRole('region', { name: 'Reader page', exact: true })).toContainText('Showing 51–100 of 121');
    await page.getByRole('link', { name: 'Page 3', exact: true }).click();
    await expect(list.getByRole('article')).toHaveCount(21);
    await page.goBack();
    await expect(list.getByRole('article')).toHaveCount(50);
    await page.reload();
    await expect(list.getByRole('article')).toHaveCount(50);
    const search = page.getByLabel('Search', { exact: true });
    await search.fill('Agent');
    await search.press('Enter');
    const results = page.getByRole('region', { name: 'Search results', exact: true });
    await expect(results.getByRole('article')).toHaveCount(50);
    await page.getByRole('link', { name: 'Page 2', exact: true }).click();
    await expect(results.getByRole('article')).toHaveCount(50);
    await expect(page.getByRole('navigation', { name: 'Reader text formats', exact: true }).getByRole('link', { name: 'JSON', exact: true })).toHaveAttribute('href', '/search.json?q=Agent&page=2&agent=1');
    expect(new URL(page.url()).searchParams.has('agent')).toBe(false);
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    const opener = results.getByRole('button', { name: 'Open article · Agent story 100', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(reader.getByRole('article', { name: 'Agent story 100', exact: true })).toBeFocused();
    await expect(reader.getByRole('button', { name: 'Mark unread', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    expect(f.database.sqlite.prepare('SELECT id FROM articles WHERE read_at IS NOT NULL').all()).toEqual([{ id: 100 }]);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({ n: 0 });
  } finally { await f.close(); }
});

test('an agent opens native shortcut help and recovers changed Reader and search pages without writes', async ({ page }) => {
  const f = await newslettersFixture(page);
  let failing = true;
  await page.route('**/api/articles?**', (route) => failing ? route.fulfill({ status: 503, json: {} }) : route.fallback());
  try {
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    await page.goto('/all?page=2&density=title&unread=true&sort=oldest');
    const retry = page.getByRole('button', { name: 'Retry articles', exact: true });
    await expect(retry).toBeEnabled();
    await retry.focus();
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
    await expect(help.getByRole('button', { name: 'Close Keyboard shortcuts', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(help.getByRole('button', { name: 'Done', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(retry).toBeFocused();
    failing = false;
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'All articles', exact: true })).toBeFocused();
    const first = page.getByRole('link', { name: 'First page', exact: true });
    await expect(first).toHaveAttribute('href', '/all?density=title&unread=true&sort=oldest');
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/all\?density=title&unread=true&sort=oldest$/);
    await expect(page.getByRole('button', { name: 'Open article · Design story', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unread', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Sort articles', { exact: true })).toHaveValue('oldest');
    await page.goto('/search?q=story&page=2&density=title&unread=true&sort=oldest');
    await expect(first).toHaveAttribute('href', '/search?q=story&density=title&unread=true&sort=oldest');
    await first.click();
    await expect(page.getByRole('button', { name: 'Open article · Design story', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Reader page', exact: true })).toContainText('Showing 1–4 of 4');
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  } finally { await f.close(); }
});

test('an agent creates an article tag, cancels a letter tag draft and submits the native form by keyboard', async ({ page }) => {
  const f = await newslettersFixture(page);
  try {
    f.brews.updateComposition(f.morning.id, { ...f.morning, sections: [{ ...newBrewSection('letters'), sources: [{ kind: 'newsletters' }] }] });
    await f.brews.generateComposition(f.morning.id);
    const frozen = f.database.sqlite.prepare('SELECT payload_json FROM brews ORDER BY id').all();
    expect(JSON.stringify(frozen)).toContain('Forms should declare their tools');
    await page.goto('/a/1');
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(reader.getByRole('article', { name: 'Forms should declare their tools', exact: true })).toBeFocused();
    await page.keyboard.press('t');
    const input = reader.getByLabel('New tag', { exact: true });
    await input.fill('Agent tag');
    await expect(reader.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
    await input.press('Enter');
    await expect(reader.getByRole('status', { name: 'Tag result', exact: true })).toHaveText('Tags saved.');
    await expect(reader.getByRole('button', { name: 'Agent tag', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await page.goto('/letters/1/1');
    const letter = page.getByRole('article', { name: 'Letter from Interface Letters', exact: true });
    const trigger = letter.getByRole('button', { name: 'Tag', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Tag this letter', exact: true });
    await expect(dialog.getByRole('checkbox', { name: 'Agent tag', exact: true })).toBeChecked();
    const beforeCancel = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    await dialog.getByRole('checkbox', { name: 'Agent tag', exact: true }).uncheck();
    await dialog.getByLabel('New tag', { exact: true }).fill('Cancelled tag');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(beforeCancel);
    await page.keyboard.press('Enter');
    await dialog.getByRole('checkbox', { name: 'Agent tag', exact: true }).uncheck();
    await dialog.getByLabel('New tag', { exact: true }).fill('Letter tag');
    await dialog.getByLabel('New tag', { exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(letter.getByLabel('Letter tags', { exact: true })).toHaveText('Letter tag');
    await expect(letter.getByRole('status', { name: 'Letter result', exact: true })).toHaveText('Tags saved.');
    expect(f.database.sqlite.prepare('SELECT t.name FROM article_tags a JOIN tags t ON t.id=a.tag_id WHERE article_id=1').all()).toEqual([{ name: 'Letter tag' }]);
    expect(f.database.sqlite.prepare('SELECT name FROM tags WHERE name=?').all('Cancelled tag')).toEqual([]);
    expect(f.database.sqlite.prepare('SELECT payload_json FROM brews ORDER BY id').all()).toEqual(frozen);
  } finally { await f.close(); }
});

test('an agent opens unread articles with native focus, returns to the next row and closes a one-item search at its heading', async ({ page }) => {
  const f = await newslettersFixture(page);
  try {
    const stories = f.database.sqlite.prepare("SELECT a.id,a.title FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE f.kind='rss' ORDER BY a.id DESC LIMIT 2").all() as { id: number; title: string }[];
    await page.goto('/all?density=title&unread=true');
    const first = page.getByRole('button', { name: `Open article · ${stories[0]!.title}`, exact: true });
    await first.focus();
    await page.keyboard.press('Enter');
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(reader.getByRole('article', { name: stories[0]!.title, exact: true })).toBeFocused();
    await expect(reader.getByRole('button', { name: 'Mark unread', exact: true })).toBeVisible();
    await reader.getByRole('button', { name: 'More article actions', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(reader.getByRole('button', { name: 'More article actions', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    const next = page.getByRole('button', { name: `Open article · ${stories[1]!.title}`, exact: true });
    await expect(next).toBeFocused();
    await expect(first).toHaveCount(0);
    expect(f.database.sqlite.prepare('SELECT read_at FROM articles WHERE id=?').get(stories[0]!.id)).not.toEqual({ read_at: null });
    const search = page.getByLabel('Search', { exact: true });
    await search.fill(stories[1]!.title);
    await search.press('Enter');
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(reader.getByRole('article', { name: stories[1]!.title, exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: `“${stories[1]!.title}”`, exact: true })).toBeFocused();
    await expect(next).toHaveCount(0);
    await expect(page).toHaveURL(/\/search\?.*unread=true/);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({ n: 0 });
  } finally { await f.close(); }
});

test('an agent reviews the full paged Reader scope, cancels without writes and recovers a lost bulk acknowledgement and reload Undo', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const feed = (
      f.database.sqlite.prepare("SELECT id FROM feeds WHERE title='Design journal'").get() as {
        id: number;
      }
    ).id;
    f.database.sqlite.transaction(() => {
      const insert = f.database.sqlite.prepare(
        'INSERT INTO articles(feed_id,guid,url,title,hash,published_at) VALUES(?,?,?,?,?,?)',
      );
      for (let i = 0; i < 120; i++)
        insert.run(
          feed,
          `bulk-${i}`,
          `https://rss.fixture.test/bulk-${i}`,
          `Paged bulk story ${i}`,
          `bulk-${i}`,
          Date.parse('2026-11-25T06:00:00Z') - i * 60_000,
        );
    })();
    const rows = () =>
      f.database.sqlite
        .prepare('SELECT id,read_at,starred_at FROM articles WHERE feed_id=? ORDER BY id')
        .all(feed);
    const before = rows();
    const url = `/feed/${feed}?page=2&density=title&unread=true&sort=oldest`;
    await page.goto(url);
    const trigger = page.getByRole('button', { name: 'Mark all read', exact: true });
    await expect(trigger).toBeEnabled();
    await trigger.focus();
    await page.keyboard.press('Enter');
    const review = page.getByRole('dialog', { name: 'Mark all articles read?', exact: true });
    await expect(review).toContainText('121 unread stories');
    await expect(review.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(trigger).toBeFocused();
    expect(rows()).toEqual(before);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
    await page.keyboard.press('Enter');
    let drop = true;
    await page.context().route('**/api/actions', async (route) => {
      if (drop && route.request().method() === 'POST') {
        drop = false;
        const response = await f.app.inject({
          method: 'POST',
          url: '/api/actions',
          payload: route.request().postDataJSON(),
        });
        expect(response.json().updated).toBe(121);
        return route.abort('failed');
      }
      return route.fallback();
    });
    await review.getByRole('button', { name: 'Mark all read', exact: true }).click();
    await expect(review.getByRole('alert')).toContainText('may have finished');
    await review.getByRole('button', { name: 'Check result', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Bulk read result', exact: true })).toContainText(
      'Marked 121 read.',
    );
    expect(rows().every((row) => (row as { read_at: number | null }).read_at !== null)).toBe(true);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 1,
    });
    await page.reload();
    const result = page.getByRole('status', { name: 'Bulk read result', exact: true });
    await expect(result).toContainText('Marked 121 read.');
    await result.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(result).toContainText('Undid local changes.');
    await expect(trigger).toBeFocused();
    expect(rows()).toEqual(before);
    await expect(page).toHaveURL(url);
  } finally {
    await f.close();
  }
});

test('an agent marks a frozen Brew section and whole edition read and restores exact unread states with archived stories unchanged', async ({
  page,
}) => {
  const f = await composeFixture(page);
  try {
    const service = new BrewService(f.database);
    const issue = await service.generateComposition(f.config.id);
    const payload = f.database.sqlite
      .prepare('SELECT payload_json FROM brews WHERE id=?')
      .get(issue.id);
    f.database.sqlite
      .prepare('UPDATE articles SET read_at=? WHERE id=1')
      .run(Date.parse('2026-11-25T02:00:00Z'));
    f.database.sqlite.prepare('DELETE FROM articles WHERE id=4').run();
    const rows = () =>
      f.database.sqlite.prepare('SELECT id,read_at,starred_at FROM articles ORDER BY id').all();
    const before = rows();
    await page.goto(`/b/${f.config.id}/${issue.id}`);
    const section = page.getByRole('region', { name: 'Design & craft', exact: true });
    const trigger = section.getByRole('button', { name: 'Mark section read', exact: true });
    await trigger.click();
    const review = page.getByRole('dialog', { name: 'Mark Design & craft read?', exact: true });
    await expect(review).toContainText('2 unread stories');
    await expect(review).toContainText('1 archived story is no longer in your library');
    await page.keyboard.press('Enter');
    await expect(trigger).toBeFocused();
    expect(rows()).toEqual(before);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
    await trigger.click();
    await review.getByRole('button', { name: 'Mark 2 read', exact: true }).click();
    const result = page.getByRole('status', { name: 'Bulk read result', exact: true });
    await expect(result).toContainText('Marked 2 read.');
    await page.reload();
    await result.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(result).toContainText('Undid local changes.');
    expect(rows()).toEqual(before);
    const all = page.getByRole('button', { name: 'Mark all read', exact: true });
    await expect(all).toBeFocused();
    await page.keyboard.press('Enter');
    const whole = page.getByRole('dialog', { name: 'Mark this Brew read?', exact: true });
    await expect(whole).toContainText('3 unread stories');
    await whole.getByRole('button', { name: 'Mark 3 read', exact: true }).click();
    await expect(result).toContainText('Marked 3 read.');
    await result.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(result).toContainText('Undid local changes.');
    expect(rows()).toEqual(before);
    expect(
      f.database.sqlite.prepare('SELECT payload_json FROM brews WHERE id=?').get(issue.id),
    ).toEqual(payload);
  } finally {
    await f.close();
  }
});

test('an agent changes browser settings through native links, reloads reading choices and exports actual OPML without server writes', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    await page.goto('/settings/runs');
    const nav = page.getByRole('navigation', { name: 'Settings', exact: true });
    const generalLink = nav.getByRole('link', { name: 'General', exact: true });
    await generalLink.focus();
    await page.keyboard.press('Enter');
    const general = page.getByRole('dialog', { name: 'General settings', exact: true });
    await expect(page).toHaveURL('/settings/runs#preferences-general');
    await general.getByLabel('Theme', { exact: true }).selectOption('dark');
    await general.getByLabel('Image privacy', { exact: true }).selectOption('direct');
    await general.getByLabel('Default landing page', { exact: true }).selectOption('reader');
    await expect(
      general.getByRole('region', { name: 'Preferences result', exact: true }),
    ).toHaveText('Default landing page saved in this browser.');
    await page.keyboard.press('Escape');
    await expect(generalLink).toBeFocused();
    await expect(page).toHaveURL('/settings/runs');
    const readingLink = nav.getByRole('link', { name: 'Reading', exact: true });
    await readingLink.click();
    const reading = page.getByRole('dialog', { name: 'Reading settings', exact: true });
    await reading.getByLabel('Open articles', { exact: true }).selectOption('pane');
    await reading.getByLabel('Read on scroll', { exact: true }).check();
    await reading.getByLabel('Read on scroll', { exact: true }).uncheck();
    await reading.getByLabel('Reader font', { exact: true }).selectOption('sans');
    await reading.getByLabel('Reader width', { exact: true }).selectOption('wide');
    await reading.getByLabel('Reader line height', { exact: true }).selectOption('compact');
    await page.reload();
    await expect(reading.getByLabel('Reader font', { exact: true })).toHaveValue('sans');
    await expect(reading.getByLabel('Reader width', { exact: true })).toHaveValue('wide');
    await expect(reading.getByLabel('Reader line height', { exact: true })).toHaveValue('compact');
    await page.goBack();
    await expect(reading).toHaveCount(0);
    await page.goForward();
    await expect(reading.getByLabel('Open articles', { exact: true })).toHaveValue('pane');
    await reading.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Where Brew runs', exact: true })).toBeFocused();
    await nav.getByRole('link', { name: 'Data & backup', exact: true }).click();
    const data = page.getByRole('dialog', { name: 'Data & backup', exact: true });
    expect((await f.app.inject('/api/opml/export')).body).toContain('https://rss.fixture.test/0');
    const downloaded = page.waitForEvent('download');
    await data.getByRole('link', { name: 'Export OPML', exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe('brew-subscriptions.opml');
    expect(await readFile((await download.path())!, 'utf8')).toContain('<opml version="2.0">');
    await data.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(nav.getByRole('link', { name: 'Data & backup', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Refresh capabilities', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Capabilities result', exact: true })).toHaveText(
      'Capabilities checked.',
    );
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    await page
      .getByRole('navigation', { name: 'Library', exact: true })
      .getByRole('link', { name: /^All articles/ })
      .click();
    await expect(page.getByLabel('Open articles', { exact: true })).toHaveValue('pane');
    await expect(page.getByLabel('Read on scroll', { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Open article · Design story', exact: true }).click();
    const article = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(article.getByLabel('Reader font', { exact: true })).toHaveValue('sans');
    await expect(article.getByLabel('Reader width', { exact: true })).toHaveValue('wide');
    await expect(article.getByLabel('Reader line height', { exact: true })).toHaveValue('compact');
    await article.getByRole('button', { name: 'Close article', exact: true }).click();
    await page.goto('/');
    await expect(
      page.getByRole('complementary', { name: 'Reader navigation', exact: true }),
    ).toBeVisible();
  } finally {
    await f.close();
  }
});

test('an agent reviews sender blocking, recovers a lost acknowledgement and undoes the actual setting after reload', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const before = f.database.sqlite.prepare('SELECT * FROM feeds WHERE id=1').get();
    await page.goto('/letters?sort=name');
    const nav = page.getByRole('navigation', { name: 'Newsletter senders', exact: true });
    await nav.getByRole('link', { name: /Interface Letters/ }).focus();
    await page.keyboard.press('Tab');
    const more = nav.getByRole('button', {
      name: 'More actions for sender Interface Letters',
      exact: true,
    });
    await expect(more).toBeFocused();
    await expect(more).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    const actions = page.getByRole('dialog', { name: 'Sender actions', exact: true });
    await actions.getByRole('button', { name: 'Block', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Update Interface Letters?', exact: true });
    await expect(review).toContainText('Block new mail: Off → On');
    await expect(review).toContainText('Undo cannot recover mail rejected during that time.');
    await expect(review.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(more).toBeFocused();
    expect(f.database.sqlite.prepare('SELECT * FROM feeds WHERE id=1').get()).toEqual(before);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
    await page.keyboard.press('Enter');
    await actions.getByRole('button', { name: 'Block', exact: true }).click();
    let drop = true;
    await page.context().route('**/api/actions', async (route) => {
      if (drop && route.request().method() === 'POST') {
        drop = false;
        const response = await f.app.inject({
          method: 'POST',
          url: '/api/actions',
          payload: route.request().postDataJSON(),
        });
        expect(response.statusCode).toBe(200);
        return route.abort('failed');
      }
      return route.fallback();
    });
    await review.getByRole('button', { name: 'Save sender', exact: true }).click();
    await expect(review.getByRole('alert')).toContainText('may have finished');
    expect(f.library.letter(1)!.sender.settings.blocked).toBe(true);
    expect(
      (
        await f.pipeline.ingestMessage({
          from: { address: 'hello@interfaceletters.co' },
          messageId: 'while-blocked',
          subject: 'Rejected mail',
          html: '<p>Rejected mail.</p>',
        })
      ).outcome,
    ).toBe('blocked');
    await review.getByRole('button', { name: 'Check result', exact: true }).click();
    await expect(review).not.toBeVisible();
    await expect(more).toBeFocused();
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 1,
    });
    await expect(page).toHaveURL('/letters?sort=name');
    await page.reload();
    const result = page.getByRole('region', { name: 'Action result', exact: true });
    await expect(result).toContainText('Saved settings for “Interface Letters”.');
    await result.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(result).toContainText('Undid local changes.');
    await expect(more).toBeFocused();
    expect(f.database.sqlite.prepare('SELECT * FROM feeds WHERE id=1').get()).toEqual(before);
    await expect(page).toHaveURL('/letters?sort=name');
  } finally {
    await f.close();
  }
});

test('an agent submits native sender settings, keeps a cancelled draft and restores pruned originals and Brew routing', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const ids: number[] = [];
    for (const title of ['Old unprotected', 'Old starred', 'Old tagged'])
      ids.push(
        (
          await f.pipeline.ingestMessage({
            from: { address: 'hello@interfaceletters.co' },
            messageId: title,
            subject: title,
            date: '2026-09-20T12:00:00Z',
            html: `<p>${title} original.</p>`,
          })
        ).articleId!,
      );
    f.database.sqlite
      .prepare('UPDATE articles SET starred_at=? WHERE id=?')
      .run(Date.parse('2026-11-25T08:00:00Z'), ids[1]);
    const tag = Number(
      f.database.sqlite.prepare("INSERT INTO tags(name,color) VALUES('Keep old','#a0471d')").run()
        .lastInsertRowid,
    );
    f.database.sqlite
      .prepare('INSERT INTO article_tags(article_id,tag_id) VALUES(?,?)')
      .run(ids[2], tag);
    await page.goto(`/letters/1/${ids[1]}?scope=all&sort=unread`);
    await expect(
      page.getByRole('button', { name: 'Mark letter unread', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Show original', exact: true }).click();
    const pane = page.getByRole('article', { name: 'Letter from Interface Letters', exact: true });
    await pane
      .getByRole('button', { name: 'More actions for Interface Letters', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Letter actions', exact: true })
      .getByRole('button', { name: 'Sender settings', exact: true })
      .click();
    const editor = page.getByRole('dialog', {
      name: 'Settings for Interface Letters',
      exact: true,
    });
    const retention = editor.getByLabel('Retention in days', { exact: true });
    await retention.fill('0');
    await expect(editor.getByRole('button', { name: 'Save sender', exact: true })).toBeDisabled();
    await retention.fill('1');
    await editor
      .getByRole('combobox', { name: 'Goes to Brew', exact: true })
      .selectOption(String(f.weekend.id));
    await editor.getByLabel('Only in Brew', { exact: true }).check();
    f.library.updateSender(1, { favorite: true });
    const snapshot = () =>
      Object.fromEntries(
        ['feeds', 'articles', 'article_tags', 'tags', 'brew_configs'].map((table) => [
          table,
          f.database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ]),
      );
    const before = snapshot();
    await retention.focus();
    await page.keyboard.press('Enter');
    const review = page.getByRole('dialog', { name: 'Update Interface Letters?', exact: true });
    await expect(review).toContainText(
      '2 unstarred and untagged letters will be removed. 4 saved originals will be cleared',
    );
    await expect(
      review.getByRole('list', { name: 'Sender setting changes', exact: true }),
    ).not.toContainText('Favorite sender');
    await page.keyboard.press('Enter');
    await expect(retention).toHaveValue('1');
    await expect(retention).toBeFocused();
    expect(snapshot()).toEqual(before);
    await page.keyboard.press('Enter');
    await review.getByRole('button', { name: 'Save sender', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Show original', exact: true })).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Old starred', exact: true })).toBeVisible();
    expect(f.library.letter(ids[1]!)!.sender.settings).toMatchObject({
      favorite: true,
      retentionDays: 1,
      brewId: f.weekend.id,
      onlyInBrew: true,
    });
    expect(
      f.database.sqlite.prepare('SELECT id FROM articles WHERE id=?').get(ids[0]),
    ).toBeUndefined();
    expect(
      f.database.sqlite.prepare('SELECT raw_html AS raw FROM articles WHERE id=?').get(ids[1]),
    ).toEqual({ raw: null });
    await page
      .getByRole('region', { name: 'Action result', exact: true })
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Show cleaned', exact: true })).toBeEnabled();
    expect(snapshot()).toEqual(before);
    await expect(page).toHaveURL(`/letters/1/${ids[1]}?scope=all&sort=unread`);
  } finally {
    await f.close();
  }
});

test('an agent manages feed health through native More controls, retries fetches and restores a confirmed deletion with focus', async ({
  page,
}) => {
  const f = await newslettersFixture(page, {
    fetcher: async () =>
      new Response(
        '<rss version="2.0"><channel><title>Design journal</title><link>https://rss.fixture.test/</link><description>Fixture</description><item><guid>health-new</guid><title>Fetched health story</title><link>https://rss.fixture.test/new</link><pubDate>Tue, 24 Nov 2026 23:00:00 GMT</pubDate><description>New from fetch.</description></item></channel></rss>',
        { headers: { 'content-type': 'application/rss+xml' } },
      ),
  });
  try {
    const feed = f.database.sqlite
      .prepare("SELECT id FROM feeds WHERE title='Design journal'")
      .get() as { id: number };
    const changes = () =>
      (f.database.sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const before = changes();
    await page.goto('/feeds?section=health');
    const row = page.getByRole('article', { name: 'Design journal', exact: true });
    const more = row.getByRole('button', {
      name: 'More actions for feed Design journal',
      exact: true,
    });
    await expect(row.getByRole('link', { name: 'Design journal', exact: true })).toHaveAttribute(
      'href',
      `/feed/${feed.id}`,
    );
    await more.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('dialog', { name: 'Feed actions', exact: true });
    await expect(menu.getByRole('link', { name: 'Open articles', exact: true })).toHaveAttribute(
      'href',
      `/feed/${feed.id}`,
    );
    await menu.getByRole('button', { name: 'Rename', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Rename feed', exact: true });
    await editor.getByLabel('Feed name', { exact: true }).fill('Discarded health edit');
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();
    await page.keyboard.press('Enter');
    await menu.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Delete Design journal?', exact: true });
    await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(more).toBeFocused();
    expect(changes()).toBe(before);
    await page.keyboard.press('Enter');
    f.failNext('POST', `/api/feeds/${feed.id}/fetch`);
    await menu.getByRole('button', { name: 'Fetch now', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Temporary fixture failure');
    await expect(more).toBeFocused();
    await page.keyboard.press('Enter');
    await menu.getByRole('button', { name: 'Fetch now', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Library result', exact: true })).toContainText(
      'Fetched Design journal; 1 new.',
    );
    await expect(more).toBeFocused();
    const snapshot = () => ({
      feed: f.database.sqlite.prepare('SELECT * FROM feeds WHERE id=?').get(feed.id),
      articles: f.database.sqlite
        .prepare('SELECT * FROM articles WHERE feed_id=? ORDER BY id')
        .all(feed.id),
    });
    const fetched = snapshot();
    await page.keyboard.press('Enter');
    await menu.getByRole('button', { name: 'Delete', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0);
    const result = page.getByRole('region', { name: 'Action result', exact: true });
    await expect(result.getByRole('button', { name: 'Undo', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(more).toBeFocused();
    expect(snapshot()).toEqual(fetched);
    await page.reload();
    await expect(page).toHaveURL('/feeds?section=health');
    await expect(row).toContainText('Fetch status: 200');
  } finally {
    await f.close();
  }
});

test('an agent opens hidden content twins, distinguishes letters and unhides a numbered page without losing keyboard position', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const story = f.database.sqlite
      .prepare("SELECT id,feed_id AS feedId FROM articles WHERE title='Design story'")
      .get() as { id: number; feedId: number };
    const letter = f.database.sqlite
      .prepare("SELECT id,title FROM articles WHERE title='Forms should declare their tools'")
      .get() as { id: number; title: string };
    f.database.sqlite
      .prepare(
        "UPDATE articles SET hidden=1,read_at=?,starred_at=?,highlight_color='#a0471d' WHERE id=?",
      )
      .run(Date.parse('2026-11-25T08:00:00Z'), Date.parse('2026-11-25T08:00:00Z'), story.id);
    f.database.sqlite.prepare('UPDATE articles SET hidden=1 WHERE id=?').run(letter.id);
    const insert = f.database.sqlite.prepare(
      'INSERT INTO articles(feed_id,guid,hash,title,url,published_at,hidden) VALUES(?,?,?,?,?,?,1)',
    );
    f.database.sqlite.transaction(() => {
      for (let i = 0; i < 50; i++)
        insert.run(
          story.feedId,
          `hidden-more-${i}`,
          `hidden-more-${i}`,
          `Hidden newer ${i}`,
          `https://hidden.test/${i}`,
          Date.parse('2026-11-25T08:00:00Z') + i + 1,
        );
    })();
    await page.context().route('**/a/*', async (route) => {
      const url = new URL(route.request().url());
      if (!isArticleOutputPath(url.pathname)) return route.fallback();
      const response = await f.app.inject({ method: 'GET', url: url.pathname });
      return route.fulfill({
        status: response.statusCode,
        body: response.rawPayload,
        headers: { 'content-type': String(response.headers['content-type']) },
      });
    });
    const changes = () =>
      (f.database.sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const before = changes();
    await page.goto('/feeds?section=hidden&page=2');
    const view = page.getByRole('region', { name: 'Hidden articles', exact: true });
    await expect(view).toContainText('Showing 51–52 of 52 hidden articles');
    const storyRow = view.getByRole('article', { name: 'Design story', exact: true });
    const letterRow = view.getByRole('article', { name: letter.title, exact: true });
    await expect(storyRow).toHaveAttribute('data-brew-state', 'read starred highlighted');
    await expect(letterRow).toHaveAttribute('data-brew-kind', 'letter');
    const letterMore = letterRow.getByRole('button', {
      name: `More actions for hidden letter ${letter.title}`,
      exact: true,
    });
    await letterMore.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('dialog', { name: 'Hidden article actions', exact: true });
    await expect(menu.getByRole('link', { name: 'Open letter', exact: true })).toHaveAttribute(
      'href',
      `/a/${letter.id}`,
    );
    const [popup, response] = await Promise.all([
      page.waitForEvent('popup'),
      page.context().waitForEvent('response', {
        predicate: (response) => new URL(response.url()).pathname === `/a/${letter.id}.json`,
      }),
      menu.getByRole('link', { name: 'JSON', exact: true }).click(),
    ]);
    expect((await response.json()).title).toBe(letter.title);
    await expect(popup).toHaveURL(`/a/${letter.id}.json`);
    await popup.close();
    await page.keyboard.press('Escape');
    await expect(letterMore).toBeFocused();
    expect(changes()).toBe(before);
    await storyRow
      .getByRole('button', { name: 'More actions for hidden article Design story', exact: true })
      .click();
    f.failNext('POST', `/api/articles/${story.id}/unhide`);
    await menu.getByRole('button', { name: 'Unhide', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Temporary fixture failure');
    await expect(storyRow.getByRole('button', { name: 'Unhide', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(storyRow).toHaveCount(0);
    await expect(letterRow.getByRole('link', { name: letter.title, exact: true })).toBeFocused();
    await expect(page).toHaveURL('/feeds?section=hidden&page=2');
    await letterMore.click();
    await menu.getByRole('button', { name: 'Unhide', exact: true }).click();
    await expect(view.getByRole('heading', { name: 'Hidden articles', exact: true })).toBeFocused();
    await expect(view).toContainText('Showing 0 of 50 hidden articles');
    await view.getByRole('link', { name: 'First page', exact: true }).click();
    await expect(view).toContainText('Showing 1–50 of 50 hidden articles');
    await expect(view.getByRole('article')).toHaveCount(50);
  } finally {
    await f.close();
  }
});

test('an agent previews and cancels bulk OPML, recovers a lost import acknowledgement and undoes the actual records after reload', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const snapshot = () => ({
      feeds: f.database.sqlite.prepare('SELECT * FROM feeds ORDER BY id').all(),
      folders: f.database.sqlite.prepare('SELECT * FROM folders ORDER BY id').all(),
    });
    const original = snapshot();
    const changes = () =>
      (f.database.sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const before = changes();
    const xml =
      '<opml><head><title>private-import-note</title></head><body><outline text="Imported folder"><outline text="Imported dispatch" xmlUrl="https://private:secret@import.test/one?token=hidden-key"/><outline text="Duplicate" xmlUrl="https://private:secret@import.test/one?token=hidden-key"/></outline><outline text="Design"><outline text="Existing title is kept" xmlUrl="https://rss.fixture.test/0"/><outline text="Imported second" xmlUrl="https://import.test/two"/></outline></body></opml>';
    const file = { name: 'subscriptions.opml', mimeType: 'text/x-opml', buffer: Buffer.from(xml) };
    await page.goto('/feeds');
    const upload = page.getByRole('button', { name: 'Import OPML', exact: true });
    await expect(upload).toBeEnabled();
    await upload.focus();
    await page.getByLabel('Import OPML', { exact: true }).setInputFiles(file);
    const confirm = page.getByRole('dialog', { name: 'Import OPML?', exact: true });
    await expect(confirm).toContainText('2 new feeds · 2 existing or duplicate · 1 new folder');
    await expect(
      confirm.getByRole('list', { name: 'OPML subscriptions', exact: true }).getByRole('listitem'),
    ).toHaveCount(4);
    await expect(confirm).not.toContainText('hidden-key');
    await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    expect(changes()).toBe(before);
    await page.keyboard.press('Enter');
    await expect(confirm).not.toBeVisible();
    await expect(upload).toBeFocused();
    expect(snapshot()).toEqual(original);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
    await page.getByLabel('Import OPML', { exact: true }).setInputFiles(file);
    let drop = true;
    await page.context().route('**/api/actions', async (route) => {
      if (drop && route.request().method() === 'POST') {
        drop = false;
        const response = await f.app.inject({
          method: 'POST',
          url: '/api/actions',
          payload: route.request().postDataJSON(),
        });
        expect(response.statusCode).toBe(200);
        return route.abort('failed');
      }
      return route.fallback();
    });
    await confirm.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(confirm.getByRole('alert')).toContainText('may have finished');
    await confirm.getByRole('button', { name: 'Check result', exact: true }).click();
    await expect(confirm).not.toBeVisible();
    await expect(
      page.getByRole('article', { name: 'Imported dispatch', exact: true }),
    ).toBeVisible();
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 1,
    });
    await page.reload();
    const result = page.getByRole('region', { name: 'Action result', exact: true });
    await expect(result).toContainText('Imported 2 feeds');
    await result.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(result).toContainText('Undid local changes.');
    expect(snapshot()).toEqual(original);
    expect(
      JSON.stringify(
        f.database.sqlite
          .prepare('SELECT args_json,result_json,undo_json FROM agent_actions')
          .all(),
      ),
    ).not.toMatch(/private-import-note|hidden-key|secret|<opml/);
  } finally {
    await f.close();
  }
});

test('an agent keeps Compose OPML unassigned, undoes draft selections and protects saved source references', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const feed = f.database.sqlite
      .prepare("SELECT id FROM feeds WHERE title='Design journal'")
      .get() as { id: number };
    f.brews.updateComposition(f.morning.id, {
      ...f.morning,
      sections: [
        {
          ...newBrewSection('imports'),
          title: 'Imports',
          sources: [{ kind: 'feed', id: feed.id }],
        },
      ],
    });
    const file = {
      name: 'compose.opml',
      mimeType: 'text/x-opml',
      buffer: Buffer.from(
        '<opml><body><outline text="Compose imported" xmlUrl="https://import.test/compose"/></body></opml>',
      ),
    };
    await page.goto(`/b/${f.morning.id}/compose`);
    await page
      .getByRole('region', { name: 'Imports', exact: true })
      .getByRole('button', { name: '+ Source', exact: true })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Add a source to “Imports”', exact: true });
    await expect(sheet.getByRole('button', { name: 'Import OPML', exact: true })).toBeEnabled();
    await sheet.getByLabel('Import OPML file', { exact: true }).setInputFiles(file);
    const confirm = page.getByRole('dialog', { name: 'Import OPML?', exact: true });
    await confirm.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(confirm).not.toBeVisible();
    const imported = sheet.getByRole('checkbox', { name: 'Compose imported', exact: true });
    await expect(imported).not.toBeChecked();
    await imported.check();
    await expect(sheet.getByRole('button', { name: 'Add 2 sources', exact: true })).toBeEnabled();
    await sheet
      .getByRole('region', { name: 'Action result', exact: true })
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect(imported).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Add 1 source', exact: true })).toBeEnabled();
    expect(f.brews.composition(f.morning.id)!.sections[0]!.sources).toEqual([
      { kind: 'feed', id: feed.id },
    ]);
    await sheet.getByLabel('Import OPML file', { exact: true }).setInputFiles(file);
    await confirm.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(confirm).not.toBeVisible();
    await imported.check();
    await sheet.getByRole('button', { name: 'Add 2 sources', exact: true }).click();
    await expect(sheet).not.toBeVisible();
    await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
    expect(f.brews.composition(f.morning.id)!.sections[0]!.sources).toHaveLength(2);
    await page.goto('/feeds');
    await page
      .getByRole('region', { name: 'Action result', exact: true })
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText('now in use');
    await expect(
      page.getByRole('article', { name: 'Compose imported', exact: true }),
    ).toBeVisible();
    expect(f.brews.composition(f.morning.id)!.sections[0]!.sources).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test('an agent pages hidden articles beyond the old cap and refills the list after unhiding the last page', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const feed = f.database.sqlite
      .prepare("SELECT id FROM feeds WHERE title='Design journal'")
      .get() as { id: number };
    const insert = f.database.sqlite.prepare(
      'INSERT INTO articles(feed_id,guid,hash,title,url,published_at,hidden) VALUES(?,?,?,?,?,?,1)',
    );
    f.database.sqlite.transaction(() => {
      for (let i = 0; i < 501; i++)
        insert.run(
          feed.id,
          `paging-hidden-${i}`,
          `paging-hidden-${i}`,
          `Paging hidden ${String(i).padStart(3, '0')}`,
          `https://hidden.test/${i}`,
          1_000_000 + i,
        );
    })();
    const changes = () =>
      (f.database.sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const before = changes();
    await page.goto('/feeds?section=hidden');
    const view = page.getByRole('region', { name: 'Hidden articles', exact: true });
    await expect(view).toContainText('Showing 1–50 of 501 hidden articles');
    await expect(view.getByRole('article')).toHaveCount(50);
    const next = page.getByRole('link', { name: 'Next hidden articles', exact: true });
    await expect(next).toHaveAttribute('href', '/feeds?section=hidden&page=2');
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/feeds?section=hidden&page=2');
    await expect(view).toContainText('Showing 51–100 of 501 hidden articles');
    await page.reload();
    await expect(
      view.getByRole('article', { name: 'Paging hidden 450', exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Previous hidden articles', exact: true }).click();
    await expect(view).toContainText('Showing 1–50 of 501 hidden articles');
    await page.goto('/feeds?section=hidden&page=11');
    await expect(view).toContainText('Showing 501–501 of 501 hidden articles');
    const document = (await f.app.inject('/feeds.json?section=hidden&page=11')).json();
    expect(document.state).toEqual({ section: 'hidden', page: 11 });
    expect(document.sections[0].data).toMatchObject({
      total: 501,
      page: 11,
      showing: { from: 501, to: 501 },
    });
    await expect(
      page.getByRole('button', { name: 'Next hidden articles', exact: true }),
    ).toBeDisabled();
    expect(changes()).toBe(before);
    await view
      .getByRole('article', { name: 'Paging hidden 000', exact: true })
      .getByRole('button', { name: 'Unhide', exact: true })
      .click();
    await expect(view).toContainText('Showing 0 of 500 hidden articles');
    await expect(page.getByRole('link', { name: 'First page', exact: true })).toHaveAttribute(
      'href',
      '/feeds?section=hidden',
    );
    await page.getByRole('link', { name: 'First page', exact: true }).click();
    await expect(view).toContainText('Showing 1–50 of 500 hidden articles');
    await expect(view.getByRole('article')).toHaveCount(50);
    expect(
      f.database.sqlite.prepare('SELECT count(*) AS n FROM articles WHERE hidden=1').get(),
    ).toEqual({ n: 500 });
  } finally {
    await f.close();
  }
});

test('an agent edits feed and folder names and retention through native dialogs without overwriting other feed settings', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const source = f.database.sqlite
      .prepare(
        "SELECT id,folder_id AS folderId,retention_days AS days FROM feeds WHERE title='Design journal'",
      )
      .get() as { id: number; folderId: number; days: number };
    const otherFolder = f.database.sqlite
      .prepare("SELECT id FROM folders WHERE title='Engineering'")
      .get() as { id: number };
    const saved = () =>
      f.database.sqlite
        .prepare('SELECT title,folder_id AS folderId,retention_days AS days FROM feeds WHERE id=?')
        .get(source.id);
    const articleCount = f.database.sqlite.prepare('SELECT count(*) AS n FROM articles').get();
    await page.goto('/feeds');
    const row = page.getByRole('article', { name: 'Design journal', exact: true });
    await expect(row).toHaveAttribute('data-brew-kind', 'feed');
    const more = row.getByRole('button', {
      name: 'More actions for feed Design journal',
      exact: true,
    });
    await more.focus();
    await page.keyboard.press('Enter');
    let menu = page.getByRole('dialog', { name: 'Feed actions', exact: true });
    await expect(menu.getByRole('link', { name: 'Open articles', exact: true })).toHaveAttribute(
      'href',
      `/feed/${source.id}`,
    );
    await menu.getByRole('button', { name: 'Rename', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Rename feed', exact: true });
    await expect(dialog.getByLabel('Feed name', { exact: true })).toBeFocused();
    await dialog.getByLabel('Feed name', { exact: true }).fill('');
    await expect(dialog.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await dialog.getByLabel('Feed name', { exact: true }).fill('Cancelled name');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(more).toBeFocused();
    expect(saved()).toEqual({
      title: 'Design journal',
      folderId: source.folderId,
      days: source.days,
    });
    await page.keyboard.press('Enter');
    menu = page.getByRole('dialog', { name: 'Feed actions', exact: true });
    await menu.getByRole('button', { name: 'Rename', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Rename feed', exact: true });
    await dialog.getByLabel('Feed name', { exact: true }).fill('Design dispatch');
    // Simulate an independent folder assignment while this name-only editor is open.
    f.database.sqlite
      .prepare('UPDATE feeds SET folder_id=? WHERE id=?')
      .run(otherFolder.id, source.id);
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    expect(saved()).toEqual({
      title: 'Design dispatch',
      folderId: otherFolder.id,
      days: source.days,
    });
    const renamed = page.getByRole('article', { name: 'Design dispatch', exact: true });
    await expect(
      renamed.getByRole('link', { name: 'Design dispatch', exact: true }),
    ).toHaveAttribute('href', `/feed/${source.id}`);
    const result = page.getByRole('status', { name: 'Library result', exact: true });
    await expect(result).toContainText('Renamed feed to “Design dispatch”.');
    await expect(result).toHaveAttribute('aria-live', 'polite');
    await page.reload();
    await renamed
      .getByRole('button', { name: 'Edit retention for Design dispatch', exact: true })
      .click();
    dialog = page.getByRole('dialog', { name: 'Feed retention', exact: true });
    await expect(dialog.getByLabel('Retention in days', { exact: true })).toBeFocused();
    await dialog.getByLabel('Retention in days', { exact: true }).fill('0');
    await expect(dialog.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(saved()).toEqual({
      title: 'Design dispatch',
      folderId: otherFolder.id,
      days: source.days,
    });
    await renamed
      .getByRole('button', { name: 'More actions for feed Design dispatch', exact: true })
      .click();
    await menu.getByRole('button', { name: 'Retention', exact: true }).click();
    await dialog.getByLabel('Retention in days', { exact: true }).fill('30');
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    expect(saved()).toEqual({ title: 'Design dispatch', folderId: otherFolder.id, days: 30 });
    await expect(
      renamed.getByRole('button', { name: 'Edit retention for Design dispatch', exact: true }),
    ).toHaveText('Keep 30 days');
    await page.getByRole('button', { name: 'More actions for folder Design', exact: true }).click();
    const folderMenu = page.getByRole('dialog', { name: 'Folder actions', exact: true });
    await expect(
      folderMenu.getByRole('link', { name: 'Open articles', exact: true }),
    ).toHaveAttribute('href', `/f/${source.folderId}`);
    await folderMenu.getByRole('button', { name: 'Rename', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Rename folder', exact: true });
    await expect(dialog.getByLabel('Folder name', { exact: true })).toBeFocused();
    await dialog.getByLabel('Folder name', { exact: true }).fill('Design archive');
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(page.getByRole('link', { name: 'Design archive', exact: true })).toHaveAttribute(
      'href',
      `/f/${source.folderId}`,
    );
    await expect(
      renamed.getByRole('button', { name: 'Edit retention for Design dispatch', exact: true }),
    ).toHaveText('Keep 30 days');
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM articles').get()).toEqual(
      articleCount,
    );
  } finally {
    await f.close();
  }
});

test('an agent saves scoped search bookmarks by keyboard, cancels deletion, then recovers local Undo after reload', async ({
  page,
}, testInfo) => {
  const f = await newslettersFixture(page);
  try {
    const folder = f.database.sqlite
      .prepare("SELECT id FROM folders WHERE title='Design'")
      .get() as { id: number };
    const href = `/search?q=Design&scope=folder&folderId=${folder.id}&unread=true&sort=oldest`;
    const changes = () =>
      (f.database.sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const before = changes();
    await page.goto(href);
    await expect(page.getByRole('heading', { name: '“Design”', exact: true })).toBeVisible();
    const saveButton = page.getByRole('button', { name: 'Save search', exact: true });
    await saveButton.focus();
    await page.keyboard.press('Enter');
    let dialog = page.getByRole('dialog', { name: 'Save search', exact: true });
    await expect(dialog.getByLabel('Saved search name', { exact: true })).toBeFocused();
    await dialog.screenshot({ path: testInfo.outputPath('save-search-light.png') });
    await dialog.getByLabel('Saved search name', { exact: true }).fill('Cancelled bookmark');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(saveButton).toBeFocused();
    await expect(page.getByRole('link', { name: '⌕ Cancelled bookmark', exact: true })).toHaveCount(
      0,
    );
    await page.keyboard.press('Enter');
    dialog = page.getByRole('dialog', { name: 'Save search', exact: true });
    await dialog.getByLabel('Saved search name', { exact: true }).fill('   ');
    await expect(dialog.getByRole('button', { name: 'Save search', exact: true })).toBeDisabled();
    await dialog.getByLabel('Saved search name', { exact: true }).fill('Design picks');
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(saveButton).toBeFocused();
    const bookmark = page.getByRole('link', { name: '⌕ Design picks', exact: true });
    await expect(bookmark).toHaveAttribute('href', href);
    await expect(
      page.getByRole('region', { name: 'Saved search result', exact: true }),
    ).toContainText('Saved search “Design picks”.');
    await page.getByRole('button', { name: 'Close search', exact: true }).click();
    await bookmark.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(href);
    await expect(page.getByRole('button', { name: 'Current folder', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.reload();
    await expect(bookmark).toHaveAttribute('aria-current', 'page');
    const more = page.getByRole('button', {
      name: 'More actions for saved search Design picks',
      exact: true,
    });
    await more.focus();
    await page.keyboard.press('Enter');
    let menu = page.getByRole('dialog', { name: 'Saved search “Design picks”', exact: true });
    await menu.getByRole('button', { name: 'Delete saved search', exact: true }).click();
    let confirmation = page.getByRole('dialog', {
      name: 'Delete saved search “Design picks”?',
      exact: true,
    });
    await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await confirmation.screenshot({ path: testInfo.outputPath('delete-search-light.png') });
    await page.keyboard.press('Enter');
    await expect(confirmation).not.toBeVisible();
    await expect(more).toBeFocused();
    await expect(bookmark).toBeVisible();
    await page.keyboard.press('Enter');
    menu = page.getByRole('dialog', { name: 'Saved search “Design picks”', exact: true });
    await menu.getByRole('button', { name: 'Delete saved search', exact: true }).click();
    confirmation = page.getByRole('dialog', {
      name: 'Delete saved search “Design picks”?',
      exact: true,
    });
    await confirmation.getByRole('button', { name: 'Delete saved search', exact: true }).click();
    await expect(bookmark).toHaveCount(0);
    const result = page.getByRole('region', { name: 'Saved search result', exact: true });
    await expect(result).toHaveAttribute('aria-live', 'polite');
    const undo = result.getByRole('button', {
      name: 'Undo deletion of “Design picks”',
      exact: true,
    });
    await expect(undo).toBeFocused();
    await page.reload();
    await expect(bookmark).toHaveCount(0);
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect(bookmark).toBeFocused();
    await expect(result).toContainText('Restored saved search “Design picks”.');
    await result.getByRole('button', { name: 'Dismiss saved search result', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(result).toBeEmpty();
    await expect(bookmark).toBeFocused();
    await page.reload();
    await expect(bookmark).toBeVisible();
    expect(changes()).toBe(before);
  } finally {
    await f.close();
  }
});

test('an agent follows Brew rule attribution and retained rule query bookmarks to the saved definition', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const story = f.database.sqlite
      .prepare(
        "SELECT a.id,a.feed_id AS feedId,a.title FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE f.kind='rss' ORDER BY a.id LIMIT 1",
      )
      .get() as { id: number; feedId: number; title: string };
    const rules = new RulesService(f.database);
    const rule = rules.create({
      name: 'Attribution rule',
      enabled: true,
      scope: { feedIds: [story.feedId] },
      matchType: 'all',
      conditions: [{ field: 'title', operator: 'contains', value: story.title }],
      actions: [{ type: 'highlight', color: '#a0471d' }, { type: 'feature_in_brew' }],
      stopProcessing: false,
    });
    await rules.evaluateArticle(story.id);
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
    const issue = await f.brews.generateComposition(f.morning.id);
    await page.goto(`/b/${f.morning.id}/${issue.id}`);
    await page
      .getByRole('article', { name: story.title, exact: true })
      .getByRole('button', { name: story.title, exact: true })
      .focus();
    const attribution = page.getByRole('link', { name: `Rule · ${rule.name}`, exact: true });
    await expect(attribution).toHaveAttribute('href', `/rules/${rule.id}`);
    await attribution.click();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(rule.name);
    await page.reload();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(rule.name);
    await page.goto(`/?view=rules&rule=${rule.id}&tab=log`);
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(rule.name);
    await expect(
      page.getByRole('region', { name: 'Rule execution log', exact: true }),
    ).toContainText(story.title);
  } finally {
    await f.close();
  }
});

test('an agent navigates canonical sender and letter identities by native links and rejects a mismatched cached letter', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const title = 'Forms should declare their tools';
    await page.goto('/letters/2/1');
    await expect(page.getByRole('alert')).toContainText('does not belong to the requested sender');
    expect(f.library.letter(1)?.readAt).toBeNull();
    await page.getByRole('link', { name: 'Back to letters', exact: true }).click();
    await expect(page).toHaveURL('/letters/2');
    await page
      .getByRole('navigation', { name: 'Newsletter senders', exact: true })
      .getByRole('link', { name: /^All senders/ })
      .click();
    await expect(page).toHaveURL('/letters');
    const row = page.getByRole('link', { name: `Read ${title}`, exact: true });
    await expect(row).toHaveAttribute('href', '/letters/1/1?scope=all');
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/letters/1/1?scope=all');
    await expect(
      page.getByRole('article', { name: 'Letter from Interface Letters', exact: true }),
    ).toBeFocused();
    await expect.poll(() => f.library.letter(1)?.readAt).not.toBeNull();
    await page.goBack();
    await expect(page).toHaveURL('/letters');
    await page.goBack();
    await expect(page).toHaveURL('/letters/2');
    await page.goBack();
    await expect(page).toHaveURL('/letters/2/1');
    await expect(page.getByRole('alert')).toContainText('does not belong to the requested sender');
    await page.getByRole('link', { name: 'Back to letters', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Newsletter senders', exact: true })
      .getByRole('link', { name: /^Interface Letters/ })
      .click();
    await expect(page).toHaveURL('/letters/1');
    await page.reload();
    await expect(page.getByRole('link', { name: `Read ${title}`, exact: true })).toBeVisible();
    await page.getByRole('link', { name: `Read ${title}`, exact: true }).click();
    await expect(page).toHaveURL('/letters/1/1');
    await page.reload();
    await expect(
      page.getByRole('article', { name: 'Letter from Interface Letters', exact: true }),
    ).toBeVisible();
  } finally {
    await f.close();
  }
});

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
