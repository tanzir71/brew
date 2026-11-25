import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { composeFixture } from './compose-fixture';
import { sourceNetwork } from './source-fixture';
import { BrewService } from '../../targets/node/src/services/brew-service';
import { nodeCapabilities } from '../../targets/node/src/capabilities';
const active: Array<Awaited<ReturnType<typeof composeFixture>>> = [];
test.afterEach(async () => {
  for (const fixture of active.splice(0)) await fixture.close();
});
async function setup(page: Page, theme = 'light') {
  const network = sourceNetwork();
  const fixture = await composeFixture(page, theme, network.fetcher);
  active.push(fixture);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/b/1/compose?section=design');
  await expect(page.getByRole('article', { name: 'Web preview' })).toBeVisible();
  await page.getByRole('button', { name: '+ Source', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a source to “Design & craft”' });
  await expect(sheet.getByLabel('URL or search', { exact: true })).toBeFocused();
  return { ...fixture, network, sheet };
}
for (const theme of ['light', 'dark'])
  test(`Figma Add source in ${theme}: discovered feeds, native library controls and mail gate`, async ({
    page,
  }) => {
    const remote: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:4401/')) remote.push(request.url());
    });
    const { sheet } = await setup(page, theme);
    await sheet.getByLabel('URL or search', { exact: true }).fill('lowtide.news');
    await expect(sheet.getByText('Found 2 feeds on lowtide.news')).toBeVisible();
    await sheet.getByRole('checkbox', { name: 'Low Tide · Essays', exact: true }).check();
    await expect(
      sheet.getByRole('checkbox', { name: 'Low Tide · Links', exact: true }),
    ).not.toBeChecked();
    await expect(sheet.getByRole('button', { name: 'Copy address', exact: true })).toBeDisabled();
    await expect(sheet.getByText('Low Tide is also a newsletter')).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await sheet.getByLabel('URL or search', { exact: true }).focus();
    expect(await sheet.boundingBox()).toMatchObject({ x: 400, y: 96, width: 640 });
    await expect(page).toHaveScreenshot(`source-sheet-${theme}.png`, { animations: 'disabled' });
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ['serious', 'critical'].includes(item.impact ?? ''),
      ),
    ).toEqual([]);
    expect(remote).toEqual([]);
  });
test('discovery and Cancel make no writes; library tabs filter and preserve section selection', async ({
  page,
}) => {
  const fixture = await setup(page);
  const initial = JSON.stringify(new BrewService(fixture.database).composition(1));
  await fixture.sheet.getByLabel('URL or search', { exact: true }).fill('lowtide.news');
  await expect(fixture.sheet.getByText('Found 2 feeds on lowtide.news')).toBeVisible();
  await fixture.sheet.getByRole('checkbox', { name: 'Low Tide · Essays', exact: true }).check();
  await fixture.sheet.getByRole('radio', { name: 'Folders', exact: true }).click();
  await expect(fixture.sheet.getByRole('checkbox', { name: 'Design', exact: true })).toBeChecked();
  await fixture.sheet.getByLabel('Filter folders', { exact: true }).fill('Engineering');
  await expect(fixture.sheet.getByRole('checkbox')).toHaveCount(3); // two discovery results and one matching folder
  await fixture.sheet.getByRole('radio', { name: 'Newsletters', exact: true }).click();
  await expect(
    fixture.sheet.getByRole('checkbox', { name: 'All newsletter senders' }),
  ).toBeDisabled();
  await fixture.sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(JSON.stringify(new BrewService(fixture.database).composition(1))).toBe(initial);
  expect(fixture.database.sqlite.prepare('SELECT count(*) AS count FROM feeds').get()).toEqual({
    count: 4,
  });
  expect(fixture.puts).toEqual([]);
  await expect(page.getByRole('button', { name: '+ Source', exact: true })).toBeFocused();
});
test('multi-select adds real feeds, survives a partial failure, and retains exact selected IDs without duplicates', async ({
  page,
}) => {
  const fixture = await setup(page);
  await fixture.sheet.getByLabel('URL or search', { exact: true }).fill('lowtide.news');
  await expect(fixture.sheet.getByText('Found 2 feeds on lowtide.news')).toBeVisible();
  await fixture.sheet.getByRole('checkbox', { name: 'Low Tide · Essays', exact: true }).check();
  await fixture.sheet.getByRole('checkbox', { name: 'Low Tide · Links', exact: true }).check();
  let fail = true;
  await page.route('**/api/feeds', (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postDataJSON().url.endsWith('/links.xml') &&
      fail
    ) {
      fail = false;
      return route.fulfill({ status: 503, json: { error: 'Feed server unavailable.' } });
    }
    return route.fallback();
  });
  await fixture.sheet.getByRole('button', { name: 'Add 4 sources', exact: true }).click();
  await expect(fixture.sheet.getByRole('alert')).toContainText('retry to finish this section');
  expect(new BrewService(fixture.database).composition(1)!.sections[0]!.sources).toHaveLength(2);
  await fixture.sheet.getByRole('button', { name: 'Add 4 sources', exact: true }).click();
  await expect(fixture.sheet).not.toBeVisible();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  const stored = new BrewService(fixture.database).composition(1)!;
  expect(stored.sections[0]!.sources).toHaveLength(4);
  expect(
    fixture.database.sqlite
      .prepare('SELECT url FROM feeds WHERE url LIKE ? ORDER BY url')
      .all('https://lowtide.news/%'),
  ).toEqual([
    { url: 'https://lowtide.news/essays.xml' },
    { url: 'https://lowtide.news/links.xml' },
  ]);
});
test('OPML import updates the library, reports invalid files, and imports without assigning feeds implicitly', async ({
  page,
}) => {
  const fixture = await setup(page);
  const file = fixture.sheet.getByLabel('Import OPML file');
  await file.setInputFiles({
    name: 'bad.opml',
    mimeType: 'text/xml',
    buffer: Buffer.from('<wrong/>'),
  });
  await expect(fixture.sheet.getByRole('alert')).toContainText('Invalid OPML');
  await file.setInputFiles({
    name: 'quiet.opml',
    mimeType: 'text/xml',
    buffer: Buffer.from(
      '<opml version="2.0"><body><outline text="Imported"><outline text="New Dispatch" type="rss" xmlUrl="https://example.test/dispatch.xml"/></outline></body></opml>',
    ),
  });
  await expect(
    fixture.sheet.getByRole('status').filter({ hasText: 'Imported 1 feed' }),
  ).toBeVisible();
  await fixture.sheet.getByLabel('Filter feeds', { exact: true }).fill('New Dispatch');
  await expect(
    fixture.sheet.getByRole('checkbox', { name: 'New Dispatch', exact: true }),
  ).not.toBeChecked();
  await fixture.sheet.getByRole('checkbox', { name: 'New Dispatch', exact: true }).check();
  await fixture.sheet.getByRole('button', { name: 'Add 3 sources', exact: true }).click();
  await expect(fixture.sheet).not.toBeVisible();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  const stored = new BrewService(fixture.database).composition(1)!;
  expect(stored.sections[0]!.sources).toHaveLength(3);
});
test('saved searches persist from browser storage and produce real FTS-backed preview sources', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'brew:saved-searches',
      JSON.stringify([{ id: 'figma-local', name: 'Figma mentions', query: 'figma' }]),
    ),
  );
  const fixture = await setup(page);
  await fixture.sheet.getByRole('radio', { name: 'Folders', exact: true }).click();
  await fixture.sheet.getByRole('checkbox', { name: 'Design', exact: true }).uncheck();
  await fixture.sheet.getByRole('checkbox', { name: 'Independent', exact: true }).uncheck();
  await fixture.sheet.getByRole('radio', { name: 'Searches', exact: true }).click();
  await fixture.sheet.getByRole('checkbox', { name: 'Figma mentions', exact: true }).check();
  await fixture.sheet.getByRole('button', { name: 'Add 1 source', exact: true }).click();
  await expect(
    page.locator('[data-brew-id=design]').getByText('Matches 1 of 1 unread now'),
  ).toBeVisible();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  expect(new BrewService(fixture.database).composition(1)!.sections[0]!.sources).toEqual([
    { kind: 'saved_search', id: 1 },
  ]);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Edit source Figma mentions', exact: true }),
  ).toBeVisible();
});
test('Copy address uses a configured active address and the sheet traps and restores keyboard focus', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const fixture = await setup(page);
  fixture.database.sqlite.exec(
    "INSERT INTO inbound_addresses(id,address,mechanism,active) VALUES(1,'letters@example.test','imap',1)",
  );
  await fixture.sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: { ...nodeCapabilities(), inboundMail: 'imap' } }),
  );
  await page.reload();
  await page.getByRole('button', { name: '+ Source', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a source to “Design & craft”' });
  await sheet.getByLabel('URL or search', { exact: true }).fill('lowtide.news');
  await expect(sheet.getByText('Found 2 feeds on lowtide.news')).toBeVisible();
  await sheet.getByRole('button', { name: 'Copy address', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('letters@example.test');
  await sheet.getByRole('button', { name: 'Add 2 sources', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(
    sheet.getByRole('button', { name: 'Close Add a source to “Design & craft”' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '+ Source', exact: true })).toBeFocused();
});
test('library load failures and discovery failures offer retries, and late discovery cannot replace the current URL', async ({
  page,
}) => {
  const network = sourceNetwork();
  const fixture = await composeFixture(page, 'light', network.fetcher);
  active.push(fixture);
  let failLibrary = true;
  await page.route('**/api/feeds', (route) => {
    if (route.request().method() === 'GET' && failLibrary)
      return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    return route.fallback();
  });
  await page.goto('/b/1/compose?section=design&sheet=add-source');
  const sheet = page.getByRole('dialog', { name: 'Add a source to “Design & craft”' });
  await expect(sheet.getByRole('alert')).toContainText('Could not load every library source.');
  await expect(sheet.getByRole('button', { name: 'Add 2 sources', exact: true })).toBeDisabled();
  failLibrary = false;
  await sheet.getByRole('button', { name: 'Retry library', exact: true }).click();
  await expect(sheet.getByRole('checkbox', { name: 'Quiet Systems', exact: true })).toBeVisible();
  let failDiscovery = true;
  let release!: () => void;
  let held = false;
  let replied = false;
  await page.route('**/api/sources/discover', async (route) => {
    if (failDiscovery) {
      failDiscovery = false;
      return route.fulfill({ status: 503, json: { error: 'Discovery unavailable.' } });
    }
    if (route.request().postDataJSON().url === 'lowtide.news') {
      held = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({
        json: {
          inputUrl: 'https://lowtide.news/',
          kind: 'web',
          candidates: [{ url: 'https://old.test/rss', title: 'Old result', type: 'rss' }],
        },
      });
      replied = true;
      return;
    }
    return route.fallback();
  });
  const url = sheet.getByLabel('URL or search', { exact: true });
  await url.fill('lowtide.news');
  await expect(sheet.getByRole('alert')).toContainText('Discovery unavailable.');
  await sheet.getByRole('button', { name: 'Retry discovery', exact: true }).click();
  await expect.poll(() => held).toBe(true);
  await expect(url).toHaveAccessibleName('URL or search');
  await url.fill('https://lowtide.news/essays.xml');
  await expect(sheet.getByText('Found 1 feed on lowtide.news')).toBeVisible();
  release();
  await expect.poll(() => replied).toBe(true);
  await expect(sheet.getByText('Found 1 feed on lowtide.news')).toBeVisible();
  await expect(sheet.getByRole('checkbox', { name: 'Old result', exact: true })).toHaveCount(0);
});
test('Tags, Rules and Starred sources can be selected by keyboard and use the real library', async ({
  page,
}) => {
  const network = sourceNetwork();
  const fixture = await composeFixture(page, 'light', network.fetcher);
  active.push(fixture);
  fixture.database.sqlite.exec(
    `INSERT INTO tags(id,name,color) VALUES(1,'Design notes','#a0471d');INSERT INTO article_tags VALUES(1,1);UPDATE articles SET featured_in_brew=1 WHERE id=2;UPDATE articles SET starred_at=1795564800000 WHERE id=3;INSERT INTO rules(name,match_type,scope_json,conditions_json,actions_json) VALUES('Feature ideas','all','{}','[]','[{"type":"feature_in_brew"}]')`,
  );
  await page.goto('/b/1/compose?section=design&sheet=add-source');
  const sheet = page.getByRole('dialog', { name: 'Add a source to “Design & craft”' });
  await sheet.getByRole('radio', { name: 'Feeds', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(sheet.getByRole('radio', { name: 'Folders', exact: true })).toBeFocused();
  await sheet.getByRole('checkbox', { name: 'Design', exact: true }).focus();
  await page.keyboard.press('Space');
  await sheet.getByRole('checkbox', { name: 'Independent', exact: true }).focus();
  await page.keyboard.press('Space');
  await sheet.getByRole('radio', { name: 'Folders', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await sheet.getByRole('checkbox', { name: 'Design notes', exact: true }).focus();
  await page.keyboard.press('Space');
  await sheet.getByRole('radio', { name: 'Rules', exact: true }).focus();
  await page.keyboard.press('Space');
  await sheet.getByRole('checkbox', { name: 'Featured by rules', exact: true }).focus();
  await page.keyboard.press('Space');
  await sheet.getByRole('radio', { name: 'Rules', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await sheet.getByRole('checkbox', { name: 'Starred', exact: true }).focus();
  await page.keyboard.press('Space');
  await sheet.getByRole('button', { name: 'Add 3 sources', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(sheet).not.toBeVisible();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  await expect(
    page.locator('[data-brew-id=design]').getByText('Matches 3 of 3 unread now'),
  ).toBeVisible();
  expect(new BrewService(fixture.database).composition(1)!.sections[0]!.sources).toEqual([
    { kind: 'tag', id: 1 },
    { kind: 'featured' },
    { kind: 'starred' },
  ]);
});
