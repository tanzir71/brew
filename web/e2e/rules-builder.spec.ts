import { expect, test } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';
import { feeds, folders } from '../../targets/node/src/db/schema';

test('builds a sentence rule with live dry-run preview', async ({ page }) => {
  const f = await newslettersFixture(page, { empty: true });
  try {
    const folder = f.database.db.insert(folders).values({ title: 'Design' }).returning().get();
    f.database.db
      .insert(feeds)
      .values({ title: 'Design Notes', url: 'https://design.test/feed', folderId: folder.id })
      .run();
    await page.route('**/api/rules/preview*', async (route) => {
      const body = route.request().postDataJSON() as { conditions: Array<{ value: string }> };
      const match = body.conditions.some((condition) =>
        condition.value.toLowerCase().includes('figma'),
      );
      return route.fulfill({
        json: {
          total: match ? 1 : 0, limit: 50, items: match
            ? [
                {
                  id: 7,
                  title: 'Figma releases variables',
                  feedTitle: 'Design Notes',
                  publishedAt: '2026-07-10T03:00:00.000Z',
                },
              ]
            : [],
        },
      });
    });

    await page.goto('/');
    await page.getByRole('link', { name: 'Rules', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Rules' })).toBeVisible();
    await page.getByRole('button', { name: 'Mute keyword' }).click();
    await expect(page.getByLabel('Rule name')).toHaveValue('Mute a keyword');
    await expect(page.getByLabel('Action 1', { exact: true })).toHaveValue('hide');
    await page.getByRole('button', { name: 'New' }).click();
    await expect(page.getByText('When an article in')).toBeVisible();
    await page.getByLabel('Rule name').fill('Figma tools');
    await page.getByLabel('Rule scope').selectOption('folder');
    await page.getByLabel('Scope folder').selectOption('1');
    await page.getByLabel('Condition 1 field').selectOption('title');
    await page.getByLabel('Condition 1 operator').selectOption('contains');
    await page.getByLabel('Condition 1 value').fill('figma');
    await expect(page.getByText('Figma releases variables')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Would match 1' })).toBeVisible();
    await page.getByRole('button', { name: '+ Add action' }).click();
    await page.getByLabel('Action 2', { exact: true }).selectOption('add_tag');
    await page.getByLabel('Tag name').fill('Tools');
    await page.getByText('Stop processing later rules').click();
    await page.getByRole('button', { name: 'Save rule' }).click();
    await expect(page.getByRole('status', { name: 'Rule editor result' })).toContainText(
      'Rule saved.',
    );
    await expect(page.getByText('Figma tools', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByText('Figma tools copy', { exact: true })).toBeVisible();
    expect((await f.app.inject('/api/rules')).json()).toHaveLength(2);
  } finally {
    await f.close();
  }
});
