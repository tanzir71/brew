import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { newslettersFixture } from './newsletters-fixture';

for (const theme of ['light', 'dark'] as const)
  test(`tag failures retain the draft and recover lost creation and assignment acknowledgements in ${theme}`, async ({
    page,
  }, testInfo) => {
    const f = await newslettersFixture(page, { theme });
    const story = f.database.sqlite
      .prepare("SELECT id FROM articles WHERE title='Design story'")
      .get() as { id: number };
    const name = 'Thoughtful interface notes for the next edition';
    let failRead = true;
    let loseCreation = true;
    let creates = 0;
    let writes = 0;
    let assignment: 'fail' | 'lost' | 'ok' = 'fail';
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.route('**/api/tags', async (route) => {
        if (route.request().method() === 'GET' && failRead)
          return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
        if (route.request().method() === 'POST') {
          creates++;
          if (loseCreation) {
            loseCreation = false;
            const result = await f.app.inject({
              method: 'POST',
              url: '/api/tags',
              payload: route.request().postDataJSON(),
            });
            expect(result.statusCode).toBe(201);
            return route.abort('failed');
          }
        }
        return route.fallback();
      });
      await page.route(`**/api/articles/${story.id}/tags`, async (route) => {
        writes++;
        expect(route.request().method()).toBe('PATCH');
        if (assignment === 'fail')
          return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
        if (assignment === 'lost') {
          assignment = 'ok';
          const result = await f.app.inject({
            method: 'PATCH',
            url: `/api/articles/${story.id}/tags`,
            payload: route.request().postDataJSON(),
          });
          expect(result.statusCode).toBe(200);
          return route.abort('failed');
        }
        return route.fallback();
      });
      await page.goto('/all?density=title');
      await page.getByRole('button', { name: 'Open article · Design story', exact: true }).click();
      const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
      await reader.getByRole('button', { name: 'Tag', exact: true }).click();
      const editor = reader.getByRole('region', { name: 'Article tags', exact: true });
      await expect(editor.getByRole('alert')).toContainText('Could not load tags.');
      await expect(editor).not.toContainText('No tags yet.');
      const input = editor.getByLabel('New tag', { exact: true });
      await input.fill(name);
      await expect(editor.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
      failRead = false;
      await editor.getByRole('button', { name: 'Retry tags', exact: true }).click();
      const add = editor.getByRole('button', { name: 'Add', exact: true });
      await expect(add).toBeEnabled();
      await input.fill('   ');
      await input.press('Enter');
      await expect(editor.getByRole('alert')).toContainText('Enter a tag name.');
      expect(creates).toBe(0);
      await input.fill(name);
      await input.press('Enter');
      await expect(editor.getByRole('alert')).toContainText('Could not confirm this tag.');
      await expect(input).toHaveValue(name);
      expect(writes).toBe(0);
      await editor.getByRole('button', { name: 'Retry tag change', exact: true }).click();
      await expect(editor.getByRole('alert')).toContainText('available in your library');
      await expect(input).toHaveValue(name);
      await expect(editor.getByRole('button', { name, exact: true })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await expect(editor.getByRole('button', { name, exact: true })).toHaveAttribute(
        'data-brew-id',
        String(story.id),
      );
      expect(
        f.database.sqlite
          .prepare('SELECT count(*) AS n FROM article_tags WHERE article_id=?')
          .get(story.id),
      ).toEqual({ n: 0 });
      await reader.getByRole('button', { name: 'More article actions', exact: true }).click();
      const more = page.getByRole('dialog', { name: 'Article actions', exact: true });
      await expect(more.getByRole('alert')).toContainText('available in your library');
      if (theme === 'dark') await page.setViewportSize({ width: 390, height: 844 });
      const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      );
      expect(violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`tag-retry-${theme}.png`) });
      assignment = 'lost';
      await more.getByRole('button', { name: 'Retry tag change', exact: true }).click();
      await expect(more.getByRole('alert')).toContainText('Could not confirm');
      expect(
        f.database.sqlite
          .prepare('SELECT count(*) AS n FROM article_tags WHERE article_id=?')
          .get(story.id),
      ).toEqual({ n: 1 });
      const beforeReplay = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
      await more.getByRole('button', { name: 'Retry tag change', exact: true }).click();
      await expect(more.getByRole('status', { name: 'Tag result', exact: true })).toHaveText(
        'Tags saved.',
      );
      await expect(more.getByRole('alert')).toHaveCount(0);
      expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(beforeReplay);
      expect(creates).toBe(2);
      expect(writes).toBe(3);
      expect(
        f.database.sqlite.prepare('SELECT count(*) AS n FROM tags WHERE name=?').get(name),
      ).toEqual({ n: 1 });
      await page.keyboard.press('Escape');
      await expect(input).toHaveValue('');
      await expect(editor.getByRole('button', { name, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(errors).toEqual([]);
    } finally {
      await f.close();
    }
  });

test('article More shows real read/star progress, failures, success and field-specific retry', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  const story = f.database.sqlite
    .prepare("SELECT id FROM articles WHERE title='Design story'")
    .get() as { id: number };
  let failStar = true;
  let failRead = false;
  try {
    await page.route(`**/api/articles/${story.id}`, (route) => {
      if (route.request().method() === 'PATCH') {
        const value = route.request().postDataJSON();
        if ((value.starred !== undefined && failStar) || (value.read !== undefined && failRead)) {
          failStar = false;
          failRead = false;
          return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
        }
      }
      return route.fallback();
    });
    await page.goto('/all?density=title');
    await page.getByRole('button', { name: 'Open article · Design story', exact: true }).click();
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(reader.getByRole('button', { name: 'Mark unread', exact: true })).toBeVisible();
    await reader.getByRole('button', { name: 'More article actions', exact: true }).click();
    const more = page.getByRole('dialog', { name: 'Article actions', exact: true });
    await more.getByRole('button', { name: 'Star', exact: true }).click();
    await expect(more.getByRole('alert')).toContainText('Could not update article.');
    await more.getByRole('button', { name: 'Retry star change', exact: true }).click();
    await expect(
      more.getByRole('status', { name: 'Article action result', exact: true }),
    ).toContainText('Saved article to Starred.');
    await expect(more.getByRole('alert')).toHaveCount(0);
    failRead = true;
    await more.getByRole('button', { name: 'Mark unread', exact: true }).click();
    await expect(
      more.getByRole('button', { name: 'Retry read change', exact: true }),
    ).toBeVisible();
    await more.getByRole('button', { name: 'Unstar', exact: true }).click();
    await expect(
      more.getByRole('status', { name: 'Article action result', exact: true }),
    ).toContainText('Removed article from Starred.');
    await expect(
      more.getByRole('button', { name: 'Retry read change', exact: true }),
    ).toBeVisible();
    await more.getByRole('button', { name: 'Retry read change', exact: true }).click();
    await expect(
      more.getByRole('status', { name: 'Article action result', exact: true }),
    ).toContainText('Marked article unread.');
    expect(
      f.database.sqlite.prepare('SELECT read_at,starred_at FROM articles WHERE id=?').get(story.id),
    ).toEqual({ read_at: null, starred_at: null });
    await page.keyboard.press('Escape');
    await expect(
      reader.getByRole('status', { name: 'Article action result', exact: true }),
    ).toHaveText('Marked article unread.');
  } finally {
    await f.close();
  }
});

test('closing during tag creation prevents a later assignment and keeps another article undisturbed', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  let release!: () => void;
  let held = false;
  let assignments = 0;
  try {
    await page.route('**/api/tags', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/tags',
        payload: route.request().postDataJSON(),
      });
      held = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return route.fulfill({ status: response.statusCode, json: response.json() });
    });
    await page.route('**/api/articles/*/tags', (route) => {
      assignments++;
      return route.fallback();
    });
    await page.goto('/all?density=title');
    await page.getByRole('button', { name: 'Open article · Design story', exact: true }).click();
    let reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await reader.getByRole('button', { name: 'Tag', exact: true }).click();
    await reader.getByLabel('New tag', { exact: true }).fill('Created before closing');
    await expect(reader.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
    await reader.getByLabel('New tag', { exact: true }).press('Enter');
    await expect.poll(() => held).toBe(true);
    await expect(reader.getByRole('status', { name: 'Tag result', exact: true })).toHaveText(
      'Saving tags…',
    );
    await expect(reader.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
    await reader.getByRole('button', { name: 'Close article', exact: true }).click();
    await page
      .getByRole('button', { name: 'Open article · Engineering story', exact: true })
      .click();
    reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(
      reader.getByRole('article', { name: 'Engineering story', exact: true }),
    ).toBeFocused();
    const acknowledged = page.waitForResponse(
      (response) => response.url().endsWith('/api/tags') && response.request().method() === 'POST',
    );
    release();
    await acknowledged;
    await reader.getByRole('button', { name: 'Tag', exact: true }).click();
    await expect(
      reader.getByRole('button', { name: 'Created before closing', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(assignments).toBe(0);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM article_tags').get()).toEqual({
      n: 0,
    });
  } finally {
    release?.();
    await f.close();
  }
});

test('the native letter tag form cancels without writes, preserves unrelated tags and reuses an existing name', async ({
  page,
}, testInfo) => {
  const f = await newslettersFixture(page);
  const first = f.database.sqlite
    .prepare("INSERT INTO tags(name,color) VALUES('First','#a0471d')")
    .run();
  f.database.sqlite.prepare("INSERT INTO tags(name,color) VALUES('Second','#a0471d')").run();
  const extra = f.database.sqlite
    .prepare("INSERT INTO tags(name,color) VALUES('Other tab','#a0471d')")
    .run();
  f.database.sqlite
    .prepare('INSERT INTO article_tags(article_id,tag_id) VALUES(1,?)')
    .run(first.lastInsertRowid);
  let concurrent = true;
  let creates = 0;
  try {
    await page.route('**/api/tags', (route) => {
      if (route.request().method() === 'POST') creates++;
      return route.fallback();
    });
    await page.route('**/api/articles/1/tags', (route) => {
      if (concurrent) {
        concurrent = false;
        f.database.sqlite
          .prepare('INSERT INTO article_tags(article_id,tag_id) VALUES(1,?)')
          .run(extra.lastInsertRowid);
        f.database.sqlite
          .prepare('UPDATE articles SET starred_at=? WHERE id=1')
          .run(Date.parse('2026-11-25T09:00:00Z'));
      }
      return route.fallback();
    });
    await page.goto('/letters/1/1');
    const letter = page.getByRole('article', {
      name: 'Letter from Interface Letters',
      exact: true,
    });
    await expect(
      letter.getByRole('button', { name: 'Mark letter unread', exact: true }),
    ).toBeVisible();
    const trigger = letter.getByRole('button', { name: 'Tag', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Tag this letter', exact: true });
    await expect(dialog.getByRole('checkbox', { name: 'First', exact: true })).toBeChecked();
    const beforeCancel = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    await dialog.getByRole('checkbox', { name: 'First', exact: true }).uncheck();
    await dialog.getByLabel('New tag', { exact: true }).fill('Cancelled draft');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(beforeCancel);
    await trigger.click();
    await dialog.getByRole('checkbox', { name: 'First', exact: true }).uncheck();
    await dialog.getByRole('checkbox', { name: 'Second', exact: true }).check();
    await dialog.getByLabel('New tag', { exact: true }).fill('Created from a letter');
    expect(
      await dialog
        .getByRole('checkbox', { name: 'First', exact: true })
        .evaluate((element) => element.closest('label')!.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(24);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact ?? ''),
      ),
    ).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('letter-tag-form.png') });
    await dialog.getByLabel('New tag', { exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(letter.getByRole('status', { name: 'Letter result', exact: true })).toHaveText(
      'Tags saved.',
    );
    const names = () =>
      f.database.sqlite
        .prepare(
          'SELECT t.name FROM tags t JOIN article_tags a ON a.tag_id=t.id WHERE a.article_id=1 ORDER BY t.name',
        )
        .all();
    expect(names()).toEqual([
      { name: 'Created from a letter' },
      { name: 'Other tab' },
      { name: 'Second' },
    ]);
    expect(f.database.sqlite.prepare('SELECT starred_at FROM articles WHERE id=1').get()).toEqual({
      starred_at: Date.parse('2026-11-25T09:00:00Z'),
    });
    await expect(letter.getByLabel('Letter tags', { exact: true })).toContainText('Other tab');
    await trigger.click();
    await dialog.getByRole('checkbox', { name: 'Created from a letter', exact: true }).uncheck();
    await dialog.getByLabel('New tag', { exact: true }).fill('Created from a letter');
    const beforeReplay = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    await dialog.getByLabel('New tag', { exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(beforeReplay);
    expect(creates).toBe(1);
    expect(names()).toEqual([
      { name: 'Created from a letter' },
      { name: 'Other tab' },
      { name: 'Second' },
    ]);
  } finally {
    await f.close();
  }
});
