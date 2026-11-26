import { expect, test } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';

test('Reader alternate links preserve query filters and return after closing an article', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const story = f.database.sqlite
      .prepare(
        "SELECT a.id,a.title,a.feed_id AS feedId FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE f.kind='rss' ORDER BY a.id LIMIT 1",
      )
      .get() as { id: number; title: string; feedId: number };
    await page.goto(`/feed/${story.feedId}?density=title&unread=true&sort=oldest`);
    const md = page.locator('head link[rel="alternate"][type="text/markdown"]');
    const json = page.locator('head link[rel="alternate"][type="application/json"]');
    await expect(md).toHaveAttribute(
      'href',
      `/feed/${story.feedId}.md?density=title&unread=true&sort=oldest`,
    );
    await expect(json).toHaveAttribute(
      'href',
      `/feed/${story.feedId}.json?density=title&unread=true&sort=oldest`,
    );
    await page
      .getByRole('article', { name: story.title, exact: true })
      .getByRole('button', { name: `Open article · ${story.title}`, exact: true })
      .click();
    await expect(md).toHaveAttribute('href', `/a/${story.id}.md`);
    await page
      .getByRole('dialog', { name: 'Article reader', exact: true })
      .getByRole('button', { name: 'Close article', exact: true })
      .click();
    await expect(md).toHaveAttribute(
      'href',
      `/feed/${story.feedId}.md?density=title&unread=true&sort=oldest`,
    );
    await page.getByLabel('Search', { exact: true }).fill('Design');
    await page.getByLabel('Search', { exact: true }).press('Enter');
    await expect(md).toHaveAttribute(
      'href',
      `/search.md?q=Design&feedId=${story.feedId}&density=title&unread=true&sort=oldest`,
    );
    await page.reload();
    await expect(md).toHaveAttribute(
      'href',
      `/search.md?q=Design&feedId=${story.feedId}&density=title&unread=true&sort=oldest`,
    );
    await page.goto('/?view=reader');
    await expect(page.getByRole('heading', { name: 'The Brew', exact: true })).toBeVisible();
  } finally {
    await f.close();
  }
});
import { newBrewSection } from '../../packages/core/src/composition-model';
import { nodeCapabilities } from '../../targets/node/src/capabilities';

test('article discovery takes precedence over its Brew and restores the selected issue when closed', async ({
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
      delivery: { ...f.morning.delivery, feed: true },
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
    const md = page.locator('head link[rel="alternate"][type="text/markdown"]');
    const json = page.locator('head link[rel="alternate"][type="application/json"]');
    await expect(md).toHaveAttribute('href', `/b/${f.morning.id}/${issue.id}.md`);
    const card = page.getByRole('article', { name: story.title, exact: true });
    await card.getByRole('button', { name: story.title, exact: true }).click();
    await card.getByRole('button', { name: 'Open', exact: true }).click();
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(reader.getByRole('article', { name: story.title, exact: true })).toBeVisible();
    await expect(md).toHaveCount(1);
    await expect(md).toHaveAttribute('href', `/a/${story.id}.md`);
    await expect(json).toHaveAttribute('href', `/a/${story.id}.json`);
    await expect(page.locator('head link[type="application/atom+xml"]')).toHaveAttribute(
      'href',
      `/b/${f.morning.id}.atom`,
    );
    await reader.getByRole('button', { name: 'Close article', exact: true }).click();
    await expect(md).toHaveAttribute('href', `/b/${f.morning.id}/${issue.id}.md`);
    await expect(json).toHaveAttribute('href', `/b/${f.morning.id}/${issue.id}.json`);
    await page.goto(`/a/${story.id}`);
    await expect(page.getByRole('dialog', { name: 'Article reader', exact: true })).toBeVisible();
    await expect(md).toHaveAttribute('href', `/a/${story.id}.md`);
  } finally {
    await f.close();
  }
});

test('unavailable article formats stay visible with setup and do not advertise working twins', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    await page.route('**/api/capabilities', (route) =>
      route.fulfill({
        json: { ...nodeCapabilities(), outputs: { twins: false, feed: false, webhook: false } },
      }),
    );
    await page.goto('/a/1');
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await reader.getByRole('button', { name: 'More article actions', exact: true }).click();
    const actions = page.getByRole('dialog', { name: 'Article actions', exact: true });
    await expect(
      actions.getByRole('link', { name: 'Set up article outputs', exact: true }),
    ).toHaveAttribute('href', '/settings/runs');
    await expect(
      actions.getByRole('button', { name: 'Markdown · Needs setup', exact: true }),
    ).toBeDisabled();
    await expect(
      actions.getByRole('button', { name: 'JSON · Needs setup', exact: true }),
    ).toBeDisabled();
    await expect(page.locator('head link[rel="alternate"][type="text/markdown"]')).toHaveCount(0);
    await page.goto('/all');
    const formats = page.getByRole('navigation', { name: 'Reader text formats', exact: true });
    await expect(formats.getByRole('button', { name: 'Markdown', exact: true })).toBeDisabled();
    await expect(formats.getByRole('button', { name: 'JSON', exact: true })).toBeDisabled();
    await expect(formats.getByRole('link', { name: 'Set up', exact: true })).toHaveAttribute(
      'href',
      '/settings/runs',
    );
    await expect(page.locator('head link[rel="alternate"][type="text/markdown"]')).toHaveCount(0);
  } finally {
    await f.close();
  }
});
