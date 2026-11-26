import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { newslettersFixture } from './newsletters-fixture';
import { articles, feeds } from '../../targets/node/src/db/schema';

for (const theme of ['light', 'dark'] as const) {
  test(`shortcut help traps focus, restores its trigger and survives selection dragging in ${theme}`, async ({
    page,
  }, testInfo) => {
    const f = await newslettersFixture(page, { theme });
    try {
      await page.goto('/all?density=title');
      await expect(
        page.getByRole('button', { name: 'Open article · Design story', exact: true }),
      ).toBeVisible();
      const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
      const trigger = page.getByRole('button', { name: 'Keyboard shortcuts', exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
      const close = dialog.getByRole('button', { name: 'Close Keyboard shortcuts', exact: true });
      const done = dialog.getByRole('button', { name: 'Done', exact: true });
      expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(true);
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(done).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await page
        .getByRole('navigation', { name: 'Library', exact: true })
        .getByRole('link', { name: /^Today/ })
        .focus();
      await expect(close).toBeFocused();
      for (const key of ['j', 'm', 's', '1', 'g', 't', 'r', '?']) await page.keyboard.press(key);
      await expect(dialog).toBeVisible();
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/all?density=title');
      expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
      const box = (await dialog.boundingBox())!;
      await page.mouse.move(box.x + 45, box.y + 90);
      await page.mouse.down();
      await page.mouse.move(3, 3);
      await page.mouse.up();
      await expect(dialog).toBeVisible();
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      for (const button of [close, done]) {
        const target = (await button.boundingBox())!;
        expect(target.width).toBeGreaterThanOrEqual(24);
        expect(target.height).toBeGreaterThanOrEqual(24);
      }
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
          ['serious', 'critical'].includes(v.impact ?? ''),
        ),
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`shortcuts-${theme}.png`) });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(done).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`shortcuts-phone-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await page.keyboard.press('?');
      await done.click();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.mouse.click(3, 3);
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    } finally {
      await f.close();
    }
  });
}

test('legacy Feeds and Rules help buttons open the native Reader guide', async ({ page }) => {
  const f = await newslettersFixture(page);
  try {
    for (const path of ['/feeds', '/rules']) {
      await page.goto(path);
      const trigger = page.getByRole('button', { name: 'Keyboard shortcuts', exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
      await expect(dialog.getByRole('link', { name: 'Open Reader', exact: true })).toHaveAttribute(
        'href',
        '/all',
      );
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    }
    await page.keyboard.press('?');
    await page
      .getByRole('dialog', { name: 'Keyboard shortcuts', exact: true })
      .getByRole('link', { name: 'Open Reader', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'All articles', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true })).toHaveCount(
      0,
    );
  } finally {
    await f.close();
  }
});

for (const search of [false, true]) {
  const path = search
    ? '/search?q=story&density=title&sort=oldest'
    : '/all?density=title&sort=oldest';
  const endpoint = search ? '/api/search' : '/api/articles';
  const subject = search ? 'search results' : 'articles';
  const retryLabel = search ? 'Retry search' : 'Retry articles';
  test(`${subject} initial loading and failed retries never claim an empty result`, async ({
    page,
  }, testInfo) => {
    const f = await newslettersFixture(page, { theme: search ? 'dark' : 'light' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let failing = true;
    await page.route(`**${endpoint}?**`, async (route) => {
      if (!failing) return route.fallback();
      await gate;
      await route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    });
    try {
      const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
      await page.goto(path);
      await expect(
        page.getByRole('status', { name: `${subject} read status`, exact: true }),
      ).toHaveText(`Loading ${subject}…`);
      await expect(
        page.getByText(
          search
            ? 'No matching articles. Try fewer or broader words.'
            : 'Nothing here yet. A quiet inbox is a good inbox.',
          { exact: true },
        ),
      ).toHaveCount(0);
      if (search)
        await expect(page.getByLabel('Search summary', { exact: true })).toHaveText('Searching…');
      release();
      const retry = page.getByRole('button', { name: retryLabel, exact: true });
      await expect(retry).toBeEnabled();
      await expect(page.getByRole('alert')).toContainText(`Could not load ${subject}.`);
      if (search)
        await expect(page.getByLabel('Search summary', { exact: true })).toHaveText(
          'Results unavailable',
        );
      await retry.focus();
      await page.keyboard.press('Enter');
      await expect(retry).toBeEnabled();
      await expect(retry).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`${search ? 'search' : 'reader'}-read-error.png`),
      });
      failing = false;
      await retry.click();
      await expect(retry).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
      await expect(
        page.getByRole('button', { name: 'Open article · Design story', exact: true }),
      ).toBeVisible();
      expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(path);
      expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    } finally {
      release();
      await f.close();
    }
  });

  test(`${subject} refresh failures retain loaded rows and identify stale ranges`, async ({
    page,
  }) => {
    const f = await newslettersFixture(page);
    let failing = false;
    await page.route(`**${endpoint}?**`, (route) =>
      failing ? route.fulfill({ status: 503, json: {} }) : route.fallback(),
    );
    try {
      await page.goto(path);
      const story = page.getByRole('button', { name: 'Open article · Design story', exact: true });
      await expect(story).toBeVisible();
      failing = true;
      await page.keyboard.press('r');
      const retry = page.getByRole('button', { name: retryLabel, exact: true });
      await expect(retry).toBeEnabled();
      await expect(story).toBeVisible();
      await expect(page.getByRole('region', { name: 'Reader page', exact: true })).toContainText(
        'Last loaded',
      );
      await expect(page.getByRole('alert')).toContainText(
        `Could not refresh ${subject}. The last loaded result is still shown.`,
      );
      failing = false;
      await retry.click();
      await expect(retry).toHaveCount(0);
      await expect(
        page.getByRole('region', { name: 'Reader page', exact: true }),
      ).not.toContainText('Last loaded');
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    } finally {
      await f.close();
    }
  });

  test(`${subject} stop automatic paging after failure and explicitly retry the same cursor`, async ({
    page,
  }) => {
    const f = await newslettersFixture(page, { empty: true });
    const feed = f.database.db
      .insert(feeds)
      .values({ title: 'Recovery source', url: 'https://recovery.test/feed' })
      .returning()
      .get();
    f.database.db
      .insert(articles)
      .values(
        Array.from({ length: 80 }, (_, i) => ({
          feedId: feed.id,
          guid: `recovery-${i}`,
          hash: `recovery-${i}`,
          title: `Recovery story ${String(i).padStart(2, '0')}`,
          url: `https://recovery.test/${i}`,
          publishedAt: new Date(2026, 10, 25, 0, i),
        })),
      )
      .run();
    let failing = true;
    const attempts: string[] = [];
    await page.route(`**${endpoint}?**`, (route) => {
      const params = new URL(route.request().url()).searchParams;
      const cursor = search ? params.get('offset') : params.get('cursor');
      if (search ? cursor !== '0' : !!cursor) {
        attempts.push(cursor!);
        if (failing) return route.fulfill({ status: 503, json: {} });
      }
      return route.fallback();
    });
    try {
      await page.goto(search ? '/search?q=Recovery&density=title' : '/all?density=title');
      await expect(page.getByRole('region', { name: 'Reader page', exact: true })).toContainText(
        'Showing 1–50 of 80',
      );
      const scroll = page.getByTestId(search ? 'virtual-search-results' : 'virtual-article-list');
      await scroll.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const retry = page.getByRole('button', {
        name: search ? 'Retry more results' : 'Retry more articles',
        exact: true,
      });
      await expect(retry).toBeEnabled();
      const failedAttempts = attempts.length;
      expect(failedAttempts).toBe(2);
      // Keep interacting while the retry backoff would have fired in the old loop.
      await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('region', { name: 'Reader page', exact: true })).toContainText(
        'Showing 1–50 of 80 · Last loaded',
      );
      expect(attempts).toHaveLength(failedAttempts);
      failing = false;
      await retry.click();
      await expect(retry).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Reader page', exact: true })).toContainText(
        'Showing 1–80 of 80',
      );
      expect(attempts).toHaveLength(failedAttempts + 1);
      expect(new Set(attempts).size).toBe(1);
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    } finally {
      await f.close();
    }
  });
}

test('library failure preserves Reader content and navigation cancels obsolete reads without stealing focus', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  let failing = true;
  await page.route('**/api/reader/navigation', (route) =>
    failing ? route.fulfill({ status: 503, json: {} }) : route.fallback(),
  );
  try {
    await page.goto('/all?density=title');
    const retry = page.getByRole('button', { name: 'Retry library', exact: true });
    await expect(retry).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Open article · Design story', exact: true }),
    ).toBeVisible();
    failing = false;
    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Library', exact: true })).toBeFocused();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/articles?**', async (route) => {
      if (new URL(route.request().url()).searchParams.get('view') !== 'all')
        return route.fallback();
      await gate;
      await route.fulfill({ status: 503, json: {} });
    });
    await Promise.all([
      page.waitForRequest((request) => new URL(request.url()).pathname === '/api/articles'),
      page.keyboard.press('r'),
    ]);
    const aborted = page.waitForEvent('requestfailed', {
      predicate: (request) => new URL(request.url()).pathname === '/api/articles',
    });
    const today = page
      .getByRole('navigation', { name: 'Library', exact: true })
      .getByRole('link', { name: /^Today/ });
    await today.click();
    await aborted;
    release();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await expect(today).toBeFocused();
    await expect(page.getByRole('button', { name: 'Retry articles', exact: true })).toHaveCount(0);
  } finally {
    await f.close();
  }
});
