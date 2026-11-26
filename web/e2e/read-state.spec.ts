import { expect, test, type Page } from '@playwright/test';
import { composeFixture } from './compose-fixture';
import { BrewService } from '../../targets/node/src/services/brew-service';

const title = 'The quiet structure behind interfaces that feel inevitable';
const secondTitle = 'Why the best local-first apps still ship a server';
const fixtures: Array<Awaited<ReturnType<typeof setup>>> = [];
test.afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});
async function setup(page: Page) {
  const clock = { now: () => new Date('2026-11-25T01:00:00Z') };
  await page.clock.setFixedTime(clock.now());
  const fixture = await composeFixture(page, 'light', undefined, { clock });
  const service = new BrewService(fixture.database, clock);
  await service.generateComposition(fixture.config.id);
  await service.generateComposition(fixture.config.id);
  await page.route('**/api/events', (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: 'event: heartbeat\ndata: {}\n\n' }),
  );
  const frozen = () =>
    fixture.database.sqlite.prepare('SELECT id,payload_json FROM brews ORDER BY id').all();
  const original = frozen();
  const state = (id = 1) =>
    fixture.database.sqlite
      .prepare('SELECT read_at,starred_at FROM articles WHERE id=?')
      .get(id) as { read_at: number | null; starred_at: number | null };
  const readCount = () =>
    (
      fixture.database.sqlite
        .prepare('SELECT count(*) AS count FROM articles WHERE read_at IS NOT NULL')
        .get() as { count: number }
    ).count;
  const result = { ...fixture, service, frozen, original, state, readCount };
  fixtures.push(result);
  return result;
}
async function openBrew(page: Page) {
  const card = page.getByRole('region', { name: 'Design & craft', exact: true }).getByRole('article', { name: title, exact: true });
  await card.getByRole('button', { name: title, exact: true }).click();
  await card.getByRole('button', { name: 'Open', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Article reader', exact: true });
  await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return { card, dialog };
}
async function openReader(page: Page, name = title) {
  await page
    .getByTestId('virtual-article-list')
    .locator('article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .click();
  return page.getByRole('dialog', { name: 'Article reader', exact: true });
}

test('opening in either view and marking unread updates the other view and archived issues', async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.goto('/b/1/2');
  const { dialog } = await openBrew(page);
  await expect(dialog.getByRole('button', { name: 'Mark unread', exact: true })).toBeVisible();
  await expect.poll(() => fixture.state().read_at).not.toBeNull();
  await dialog.getByRole('button', { name: 'Close article', exact: true }).click();
  await page.getByRole('link', { name: /^All articles/ }).click();
  const reader = await openReader(page);
  await expect(reader.getByRole('button', { name: 'Mark unread', exact: true })).toBeVisible();
  await reader.getByRole('button', { name: 'Mark unread', exact: true }).click();
  await expect.poll(() => fixture.state().read_at).toBeNull();
  await reader.getByRole('button', { name: 'Close article', exact: true }).click();
  const second = await openReader(page, secondTitle);
  await expect(second.getByRole('button', { name: 'Mark unread', exact: true })).toBeVisible();
  await expect.poll(() => fixture.state(2).read_at).not.toBeNull();
  await second.getByRole('button', { name: 'Close article', exact: true }).click();
  await page.getByRole('link', { name: 'The Brew', exact: true }).click();
  await expect(page.getByRole('article', { name: title, exact: true })).toHaveAttribute(
    'data-brew-state',
    'unread',
  );
  await expect(page.getByRole('article', { name: secondTitle, exact: true })).toHaveAttribute(
    'data-brew-state',
    'read',
  );
  await expect(page.getByRole('progressbar', { name: 'Brew reading progress' })).toHaveAttribute(
    'value',
    '1',
  );
  expect(
    fixture.service.readState(1)!.articles.find((item) => item.id === 2)!.readAt,
  ).not.toBeNull();
  expect(fixture.frozen()).toEqual(fixture.original);
});

test('Brew opens before a held read write and rapid unread/star choices win after it completes', async ({
  page,
}) => {
  const fixture = await setup(page);
  let release!: () => void;
  let held = false;
  const bodies: unknown[] = [];
  await page.route('**/api/articles/1', async (route) => {
    if (route.request().method() === 'PATCH') {
      bodies.push(route.request().postDataJSON());
      if (!held) {
        held = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    }
    return route.fallback();
  });
  await page.goto('/b/1/2');
  const { card, dialog } = await openBrew(page);
  await expect.poll(() => held).toBe(true);
  expect(fixture.state().read_at).toBeNull();
  await dialog.getByRole('button', { name: 'Mark unread', exact: true }).click();
  await dialog.getByRole('button', { name: '☆ Star', exact: true }).click();
  release();
  await expect.poll(() => bodies).toEqual([{ read: true }, { read: false }, { starred: true }]);
  await expect.poll(() => fixture.state().starred_at).not.toBeNull();
  expect(fixture.state().read_at).toBeNull();
  await dialog.getByRole('button', { name: 'Close article', exact: true }).click();
  await expect(card).toHaveAttribute('data-brew-state', 'unread starred');
  expect(fixture.frozen()).toEqual(fixture.original);
});

test('a failed automatic read keeps content open, restores unread state and supports explicit retry', async ({
  page,
}) => {
  const fixture = await setup(page);
  let fail = true;
  await page.route('**/api/articles/1', (route) => {
    if (route.request().method() === 'PATCH' && fail) {
      fail = false;
      return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    }
    return route.fallback();
  });
  await page.goto('/b/1/2');
  const { card, dialog } = await openBrew(page);
  await expect(dialog.getByRole('status')).toContainText('Could not update article. Try again.');
  await expect(dialog.getByRole('button', { name: 'Mark read', exact: true })).toBeVisible();
  expect(fixture.state().read_at).toBeNull();
  await expect(card).toHaveAttribute('data-brew-state', 'unread');
  await dialog.getByRole('button', { name: 'Mark read', exact: true }).click();
  await expect.poll(() => fixture.state().read_at).not.toBeNull();
  await dialog.getByRole('button', { name: 'Close article', exact: true }).click();
  await expect(card).toHaveAttribute('data-brew-state', 'read');
  expect(fixture.frozen()).toEqual(fixture.original);
});

test('Reader bulk read and Undo recover from failures and keep Brew state and frozen issues consistent', async ({
  page,
}) => {
  const fixture = await setup(page);
  for (const path of ['mark-all-read', 'mark-all-read/undo']) {
    let fail = true;
    await page.route(`**/api/articles/${path}`, (route) => {
      if (fail) {
        fail = false;
        return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      }
      return route.fallback();
    });
  }
  await page.goto('/?view=reader&scope=all');
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
  await page.getByRole('dialog', { name: 'Mark all articles read?' }).getByRole('button', { name: 'Mark all read', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not mark articles read.');
  expect(fixture.readCount()).toBe(0);
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
  await page.getByRole('dialog', { name: 'Mark all articles read?' }).getByRole('button', { name: 'Mark all read', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Marked 5 read.' })).toBeVisible();
  expect(fixture.readCount()).toBe(5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not undo the read update.');
  expect(fixture.readCount()).toBe(5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(fixture.readCount).toBe(0);
  await page.getByRole('link', { name: 'The Brew', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Brew reading progress' })).toHaveAttribute(
    'value',
    '0',
  );
  expect(fixture.frozen()).toEqual(fixture.original);
});

test('failed read-on-scroll updates roll back and retry into Brew without marking unseen articles', async ({
  page,
}) => {
  const fixture = await setup(page);
  let fail = true;
  await page.route('**/api/articles/*', (route) => {
    if (route.request().method() === 'PATCH' && fail)
      return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    return route.fallback();
  });
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto('/?view=reader&scope=all');
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByLabel('Read on scroll').check();
  await page.getByTestId('virtual-article-list').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const retry = page.getByRole('button', { name: 'Retry read updates', exact: true });
  await expect(retry).toBeVisible();
  expect(fixture.readCount()).toBe(0);
  fail = false;
  await retry.click();
  await expect(retry).not.toBeVisible();
  const count = fixture.readCount();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(5);
  await page.getByRole('link', { name: 'The Brew', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: 'Brew reading progress' })).toHaveAttribute(
    'value',
    String(count),
  );
  expect(fixture.frozen()).toEqual(fixture.original);
});
