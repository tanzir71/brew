import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';
import { composeFixture } from './compose-fixture';
import { BrewService } from '../../targets/node/src/services/brew-service';

for (const theme of ['light', 'dark'] as const)
  test(`bulk read reviews have exact counts, keyboard focus and accessible phone layout in ${theme}`, async ({
    page,
  }, testInfo) => {
    const f = await newslettersFixture(page, { theme });
    try {
      const feed = (
        f.database.sqlite.prepare("SELECT id FROM feeds WHERE title='Design journal'").get() as {
          id: number;
        }
      ).id;
      await page.goto(`/feed/${feed}`);
      const trigger = page.getByRole('button', { name: 'Mark all read', exact: true });
      await expect(trigger).toBeEnabled();
      await trigger.focus();
      await page.keyboard.press('Enter');
      const review = page.getByRole('dialog', { name: 'Mark all articles read?', exact: true });
      await expect(review).toContainText('1 unread story');
      await expect(review.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      for (const button of await review.getByRole('button').all())
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(24);
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
          ['serious', 'critical'].includes(v.impact ?? ''),
        ),
      ).toEqual([]);
      await review.screenshot({ path: testInfo.outputPath(`bulk-review-desktop-${theme}.png`) });
      await page.setViewportSize({ width: 390, height: 844 });
      await review.screenshot({ path: testInfo.outputPath(`bulk-review-phone-${theme}.png`) });
      expect((await review.boundingBox())!.width).toBeLessThanOrEqual(390);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
        n: 0,
      });
    } finally {
      await f.close();
    }
  });

test('stale bulk reviews reject new unread rows and conflicting Undo never rewinds another read change', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const feed = (
      f.database.sqlite.prepare("SELECT id FROM feeds WHERE title='Design journal'").get() as {
        id: number;
      }
    ).id;
    await page.goto(`/feed/${feed}`);
    const trigger = page.getByRole('button', { name: 'Mark all read', exact: true });
    await trigger.click();
    const review = page.getByRole('dialog', { name: 'Mark all articles read?', exact: true });
    await expect(review).toContainText('1 unread story');
    f.database.sqlite
      .prepare('INSERT INTO articles(feed_id,guid,url,title,hash,published_at) VALUES(?,?,?,?,?,?)')
      .run(
        feed,
        'later-bulk',
        'https://rss.fixture.test/later-bulk',
        'New arrival',
        'later-bulk',
        Date.parse('2026-11-25T07:00:00Z'),
      );
    await review.getByRole('button', { name: 'Mark all read', exact: true }).click();
    await expect(review.getByRole('alert')).toContainText('review the scope again');
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
    await review.getByRole('button', { name: 'Close', exact: true }).click();
    await trigger.click();
    await expect(review).toContainText('2 unread stories');
    await review.getByRole('button', { name: 'Mark all read', exact: true }).click();
    const result = page.getByRole('status', { name: 'Bulk read result', exact: true });
    await expect(result).toContainText('Marked 2 read.');
    f.database.sqlite
      .prepare('UPDATE articles SET read_at=read_at+1000 WHERE feed_id=? AND guid=?')
      .run(feed, 'later-bulk');
    const changed = f.database.sqlite
      .prepare('SELECT id,read_at FROM articles WHERE feed_id=? ORDER BY id')
      .all(feed);
    await result.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('changed after the action');
    expect(
      f.database.sqlite
        .prepare('SELECT id,read_at FROM articles WHERE feed_id=? ORDER BY id')
        .all(feed),
    ).toEqual(changed);
    await expect(result.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  } finally {
    await f.close();
  }
});

test('preview failure retries the same scope and cancelled or obsolete reads cannot submit a later bulk write', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  let release: (() => void) | undefined;
  try {
    let mode: 'fail' | 'normal' | 'hold' = 'fail';
    let started: (() => void) | undefined;
    let seen = new Promise<void>((resolve) => {
      started = resolve;
    });
    let writes = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/actions')
        writes++;
    });
    await page.context().route('**/api/actions/mark-read/preview', async (route) => {
      if (mode === 'fail') {
        mode = 'normal';
        return route.fulfill({ status: 503, json: { error: 'Temporary preview failure.' } });
      }
      if (mode === 'hold') {
        const waiting = new Promise<void>((resolve) => {
          release = resolve;
        });
        started?.();
        await waiting;
      }
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/actions/mark-read/preview',
        payload: route.request().postDataJSON(),
      });
      await route
        .fulfill({ status: response.statusCode, json: response.json() })
        .catch(() => undefined);
    });
    await page.goto('/all');
    const trigger = page.getByRole('button', { name: 'Mark all read', exact: true });
    await trigger.click();
    await expect(page.getByRole('alert')).toContainText('Temporary preview failure.');
    await page.getByRole('button', { name: 'Retry read review', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Mark all articles read?', exact: true });
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    mode = 'hold';
    await trigger.click();
    await seen;
    await page.getByRole('button', { name: 'Cancel review', exact: true }).click();
    await expect(trigger).toBeFocused();
    release?.();
    seen = new Promise<void>((resolve) => {
      started = resolve;
    });
    await trigger.click();
    await seen;
    await page.getByRole('combobox', { name: 'Sort articles', exact: true }).selectOption('oldest');
    release?.();
    await expect(page).toHaveURL('/all?sort=oldest');
    await expect(trigger).toBeEnabled();
    await expect(review).toHaveCount(0);
    expect(writes).toBe(0);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
  } finally {
    release?.();
    await f.close();
  }
});

test('unsupported bulk writes stay visible and disabled in Reader and Brew with setup guidance and no POSTs', async ({
  page,
}) => {
  const f = await composeFixture(page);
  try {
    const issue = await new BrewService(f.database).generateComposition(f.config.id);
    const caps = (await f.app.inject('/api/capabilities')).json();
    await page.route('**/api/capabilities', (route) =>
      route.fulfill({ json: { ...caps, actions: { ...caps.actions, undo: false } } }),
    );
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') posts.push(new URL(request.url()).pathname);
    });
    await page.goto(`/b/${f.config.id}/${issue.id}`);
    await expect(page.getByRole('button', { name: 'Mark all read', exact: true })).toBeDisabled();
    await expect(
      page
        .getByRole('region', { name: 'Design & craft', exact: true })
        .getByRole('button', { name: 'Mark section read', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Set up actions', exact: true })).toHaveAttribute(
      'href',
      '/settings/runs',
    );
    await page.goto('/all');
    await expect(page.getByRole('button', { name: 'Mark all read', exact: true })).toBeDisabled();
    await page.keyboard.press('Shift+A');
    await expect(
      page.getByRole('dialog', { name: 'Mark all articles read?', exact: true }),
    ).toHaveCount(0);
    expect(posts).toEqual([]);
  } finally {
    await f.close();
  }
});

test('a completed bulk write followed by a read outage reports the distinction and Reload does not repeat the write', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    let failReads = false;
    let writes = 0;
    await page.context().route('**/api/actions', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/actions',
        payload: route.request().postDataJSON(),
      });
      writes++;
      failReads = true;
      await route.fulfill({ status: response.statusCode, json: response.json() });
    });
    await page
      .context()
      .route('**/api/articles?**', (route) =>
        failReads
          ? route.fulfill({ status: 503, json: { error: 'List unavailable.' } })
          : route.fallback(),
      );
    await page.goto('/all');
    await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Mark all articles read?', exact: true })
      .getByRole('button', { name: 'Mark all read', exact: true })
      .click();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'The action finished, but the view could not refresh.' }),
    ).toBeVisible();
    await expect(page.getByRole('status', { name: 'Bulk read result', exact: true })).toContainText(
      'Marked',
    );
    failReads = false;
    await page.getByRole('link', { name: 'Reload view', exact: true }).click();
    await expect(
      page
        .getByRole('status', { name: 'Bulk read result', exact: true })
        .getByRole('button', { name: 'Undo', exact: true }),
    ).toBeEnabled();
    expect(writes).toBe(1);
  } finally {
    await f.close();
  }
});
