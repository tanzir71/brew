import { expect, test } from '@playwright/test';

test('builds a sentence rule with live dry-run preview', async ({ page }) => {
  let rules: Array<Record<string, unknown>> = [];
  let nextId = 1;
  await page.route('**/api/reader/navigation', (route) => route.fulfill({ json: { counts: { all: 0, today: 0, starred: 0 }, folders: [{ id: 1, title: 'Design', unreadCount: 0, feeds: [{ id: 1, folderId: 1, title: 'Design Notes', unreadCount: 0, muted: false }] }], unfiled: [] } }));
  await page.route('**/api/rules/duplicate-filter', async (route) => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/rules', async (route) => { if (route.request().method() === 'GET') return route.fulfill({ json: rules }); const body = route.request().postDataJSON() as Record<string, unknown>; const created = { ...body, id: nextId++, position: rules.length }; rules.push(created); return route.fulfill({ status: 201, json: created }); });
  await page.route('**/api/rules/*', async (route) => { const id = Number(new URL(route.request().url()).pathname.split('/').at(-1)); if (route.request().method() === 'DELETE') { rules = rules.filter((rule) => rule.id !== id); return route.fulfill({ status: 204 }); } const body = route.request().postDataJSON() as Record<string, unknown>; const updated = { ...body, id, position: 0 }; rules = rules.map((rule) => rule.id === id ? updated : rule); return route.fulfill({ json: updated }); });
  await page.route('**/api/rules/preview', async (route) => { const body = route.request().postDataJSON() as { conditions: Array<{ value: string }> }; const match = body.conditions.some((condition) => condition.value.toLowerCase().includes('figma')); return route.fulfill({ json: { items: match ? [{ id: 7, title: 'Figma releases variables', feedTitle: 'Design Notes', publishedAt: '2026-07-10T03:00:00.000Z' }] : [] } }); });

  await page.goto('/');
  await page.getByRole('link', { name: 'Rules', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rules' })).toBeVisible();
  await page.getByRole('button',{name:'Mute keyword'}).click();
  await expect(page.getByLabel('Rule name')).toHaveValue('Mute a keyword');
  await expect(page.getByLabel('Action 1',{exact:true})).toHaveValue('hide');
  await page.getByRole('button',{name:'New'}).click();
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
  await expect(page.getByRole('status')).toContainText('Rule saved.');
  await expect(page.getByText('Figma tools', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Figma tools copy', { exact: true })).toBeVisible();
  expect(rules).toHaveLength(2);
});
