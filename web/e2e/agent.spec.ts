import { expect, test } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';
import { newBrewSection } from '../../packages/core/src/composition-model';
import { isArticleOutputPath } from '../../packages/core/src/article-outputs';

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
        page
          .context()
          .waitForEvent('response', {
            predicate: (response) =>
              new URL(response.url()).pathname === `/a/${story.id}.${format}`,
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
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
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
