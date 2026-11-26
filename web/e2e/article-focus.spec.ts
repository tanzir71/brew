import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { newslettersFixture } from './newsletters-fixture';

for (const theme of ['light', 'dark'] as const) {
  test(`native article overlay contains focus and restores nested actions in ${theme}`, async ({
    page,
  }, testInfo) => {
    const f = await newslettersFixture(page, { theme });
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/all?density=title');
      const opener = page.getByRole('button', { name: 'Open article · Design story', exact: true });
      await opener.focus();
      await page.keyboard.press('Enter');
      const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
      await expect(reader).toHaveAttribute('aria-modal', 'true');
      expect(await reader.evaluate((element) => element.matches(':modal'))).toBe(true);
      await expect(
        reader.getByRole('article', { name: 'Design story', exact: true }),
      ).toBeFocused();
      await page
        .getByRole('navigation', { name: 'Library', exact: true })
        .getByRole('link', { name: /^Today/ })
        .focus();
      await expect(
        reader.getByRole('article', { name: 'Design story', exact: true }),
      ).toBeFocused();
      const more = reader.getByRole('button', { name: 'More article actions', exact: true });
      for (const name of ['Reader font', 'Reader width', 'Reader line height']) {
        const box = await reader.getByLabel(name, { exact: true }).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(24);
        expect(box!.width).toBeGreaterThanOrEqual(24);
      }
      for (let i = 0; i < 22; i++) {
        await page.keyboard.press('Tab');
        expect(await reader.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
      }
      await more.click();
      const actions = page.getByRole('dialog', { name: 'Article actions', exact: true });
      await expect(actions).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(more).toBeFocused();
      await expect(reader).toBeVisible();
      await more.click();
      await actions.getByRole('button', { name: 'Tag', exact: true }).click();
      await expect(reader.getByRole('region', { name: 'Article tags', exact: true })).toBeFocused();
      const tag = reader.getByLabel('New tag', { exact: true });
      await tag.fill('smtv');
      await expect(tag).toHaveValue('smtv');
      await expect(reader.getByRole('button', { name: '☆ Star', exact: true })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      );
      expect(violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`article-overlay-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(reader).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    } finally {
      await f.close();
    }
  });
}

test('desktop pane docks beside usable rows, opens the next item and leaves navigation focus alone', async ({
  page,
}, testInfo) => {
  const f = await newslettersFixture(page);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/all?density=title');
    await page.getByLabel('Open articles', { exact: true }).selectOption('pane');
    const first = page.getByRole('button', { name: 'Open article · Design story', exact: true });
    await first.click();
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(reader).toHaveAttribute('aria-modal', 'false');
    expect(await reader.evaluate((element) => element.matches(':modal'))).toBe(false);
    const next = page.getByRole('button', {
      name: 'Open article · Engineering story',
      exact: true,
    });
    const row = await next.boundingBox();
    const pane = await reader.boundingBox();
    expect(row!.x + row!.width).toBeLessThanOrEqual(pane!.x);
    await next.click();
    await expect(
      reader.getByRole('article', { name: 'Engineering story', exact: true }),
    ).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('article-docked-pane.png') });
    await page.keyboard.press('Escape');
    await expect(next).toBeFocused();
    await next.click();
    const today = page
      .getByRole('navigation', { name: 'Library', exact: true })
      .getByRole('link', { name: /^Today/ });
    await today.click();
    await expect(reader).toHaveCount(0);
    await expect(today).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  } finally {
    await f.close();
  }
});

test('pane preference becomes a native modal on phones and returns to a docked pane on resize', async ({
  page,
}, testInfo) => {
  const f = await newslettersFixture(page, { theme: 'dark' });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/all?density=title');
    await page.getByLabel('Open articles', { exact: true }).selectOption('pane');
    await page.getByRole('button', { name: 'Open article · Design story', exact: true }).click();
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(reader).toHaveAttribute('aria-modal', 'true');
    await expect(reader.getByRole('article', { name: 'Design story', exact: true })).toBeFocused();
    expect(await reader.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    );
    expect(violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('article-phone.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(reader).toHaveAttribute('aria-modal', 'false');
    await expect(reader.getByRole('article', { name: 'Design story', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await reader.getByRole('button', { name: 'Tag', exact: true }).click();
    await reader.getByLabel('New tag', { exact: true }).fill('Resize draft');
    const more = reader.getByRole('button', { name: 'More article actions', exact: true });
    const actions = page.getByRole('dialog', { name: 'Article actions', exact: true });
    await more.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(reader).toHaveAttribute('aria-modal', 'true');
    await expect(actions).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect(reader.getByLabel('New tag', { exact: true })).toHaveValue('Resize draft');
    await more.click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(actions).toHaveCount(0);
    await expect(more).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await page.setViewportSize({ width: 390, height: 844 });
    await more.click();
    await page.goto('/rules');
    await expect(page.getByRole('heading', { name: 'Rules', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    expect(await page.evaluate(() => localStorage.getItem('brew:article-open-mode'))).toBe('pane');
  } finally {
    await f.close();
  }
});

test('article retry, rejected clipboard and cancellation keep honest feedback and focus', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  const story = f.database.sqlite
    .prepare("SELECT id FROM articles WHERE title='Design story'")
    .get() as { id: number };
  let fail = true;
  let held = false;
  let release!: () => void;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.route(`**/api/articles/${story.id}`, (route) =>
      fail && route.request().method() === 'GET'
        ? route.fulfill({ status: 503, json: { error: 'Unavailable' } })
        : route.fallback(),
    );
    await page.goto(`/a/${story.id}`);
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(reader.getByRole('alert')).toContainText('Could not open this article.');
    fail = false;
    await reader.getByRole('button', { name: 'Retry article', exact: true }).click();
    await expect(reader.getByRole('article', { name: 'Design story', exact: true })).toBeFocused();
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error('Denied');
          },
        },
      }),
    );
    await reader.getByRole('button', { name: 'Copy link', exact: true }).click();
    await expect(reader.getByRole('status')).toContainText('Could not copy the link.');
    await page.route(`**/api/articles/${story.id}/full-text`, async (route) => {
      held = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return route.fulfill({ status: 503, json: { error: 'Late extraction failure' } });
    });
    await reader.getByRole('button', { name: 'Load full article', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    const cancelled = page.waitForEvent('requestfailed', (request) =>
      request.url().endsWith(`/api/articles/${story.id}/full-text`),
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'All articles', exact: true })).toBeFocused();
    await cancelled;
    release();
    await expect(page.getByRole('main')).not.toContainText('Late extraction failure');
    expect(errors).toEqual([]);
  } finally {
    release?.();
    await f.close();
  }
});

test('a late unread refresh repairs a removed opener without taking focus from another control', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  const stories = f.database.sqlite
    .prepare(
      "SELECT a.id,a.title FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE f.kind='rss' ORDER BY a.id DESC LIMIT 3",
    )
    .all() as { id: number; title: string }[];
  let hold = false;
  let pending: (() => void)[] = [];
  try {
    await page.route('**/api/articles?**', async (route) => {
      if (hold)
        await new Promise<void>((resolve) => {
          pending.push(resolve);
        });
      return route.fallback();
    });
    await page.goto('/all?density=title&unread=true');
    for (const index of [0, 1]) {
      const opener = page.getByRole('button', {
        name: `Open article · ${stories[index]!.title}`,
        exact: true,
      });
      await expect(opener).toBeVisible();
      hold = true;
      await opener.click();
      const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
      await expect(
        reader.getByRole('article', { name: stories[index]!.title, exact: true }),
      ).toBeFocused();
      await expect.poll(() => pending.length).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
      const search = page.getByLabel('Search', { exact: true });
      if (index === 1) await search.focus();
      hold = false;
      const releases = pending;
      pending = [];
      releases.forEach((release) => release());
      await expect(opener).toHaveCount(0);
      await expect(
        index === 1
          ? search
          : page.getByRole('button', {
              name: `Open article · ${stories[index + 1]!.title}`,
              exact: true,
            }),
      ).toBeFocused();
    }
  } finally {
    hold = false;
    pending.forEach((release) => release());
    await f.close();
  }
});

test('the tag shortcut waits for content and dragging a selection outside the article does not close it', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  const story = f.database.sqlite
    .prepare("SELECT id FROM articles WHERE title='Video story'")
    .get() as { id: number };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  try {
    await page.route(`**/api/articles/${story.id}`, async (route) => {
      if (route.request().method() === 'GET') {
        held = true;
        await gate;
      }
      return route.fallback();
    });
    await page.goto('/all?density=title');
    const opener = page.getByRole('button', { name: 'Open article · Video story', exact: true });
    await opener.focus();
    await page.keyboard.press('t');
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(reader.getByRole('status')).toContainText('Opening article…');
    await expect.poll(() => held).toBe(true);
    release();
    await expect(reader.getByRole('region', { name: 'Article tags', exact: true })).toBeFocused();
    const title = await reader
      .getByRole('heading', { name: 'Video story', exact: true })
      .boundingBox();
    await page.mouse.move(title!.x + 5, title!.y + title!.height / 2);
    await page.mouse.down();
    await page.mouse.move(4, title!.y + title!.height / 2);
    await page.mouse.up();
    await expect(reader).toBeVisible();
    await page.mouse.click(4, title!.y + title!.height / 2);
    await expect(reader).toHaveCount(0);
    await expect(opener).toBeFocused();
  } finally {
    release?.();
    await f.close();
  }
});

test('modal Tab wrapping retains the native audio controls', async ({ page }) => {
  const f = await newslettersFixture(page);
  try {
    f.database.sqlite
      .prepare(
        "UPDATE articles SET enclosure_url='https://rss.fixture.test/episode.mp3',enclosure_type='audio/mpeg' WHERE title='Design story'",
      )
      .run();
    await page.goto('/all?density=title');
    const opener = page.getByRole('button', { name: 'Open article · Design story', exact: true });
    await opener.click();
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(reader.getByRole('article', { name: 'Design story', exact: true })).toBeFocused();
    const audio = reader.getByLabel('Listen to Design story', { exact: true });
    await reader.getByRole('button', { name: 'Load full article', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(audio).toBeFocused();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      await expect
        .poll(() =>
          reader.evaluate((element) =>
            element.contains(document.activeElement) ? 'inside' : document.activeElement?.tagName,
          ),
        )
        .toBe('inside');
    }
    await reader.getByRole('button', { name: 'Close article', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(audio).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  } finally {
    await f.close();
  }
});
