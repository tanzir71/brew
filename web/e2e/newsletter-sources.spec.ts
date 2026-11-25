import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';
import { ArticleService } from '../../targets/node/src/services/article-service';
import { newBrewSection, sectionWithSources } from '../../packages/core/src/composition-model';
import type { BrewSourceRef } from '../../packages/core/src/types/brew';

test.use({ viewport: { width: 1440, height: 960 }, timezoneId: 'UTC' });
const fixtures: Array<Awaited<ReturnType<typeof newslettersFixture>>> = [];
test.afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});
async function setup(
  page: Page,
  theme: 'light' | 'dark' = 'light',
  sources: BrewSourceRef[] = [{ kind: 'newsletters' }],
  options: { empty?: boolean } = {},
) {
  const fixture = await newslettersFixture(page, { theme, ...options });
  fixtures.push(fixture);
  const state = new ArticleService(fixture.database);
  const tag = state.createTag('Design notes');
  if (!options.empty) {
    state.setTags(2, [tag.id]);
    state.setTags(8, [tag.id]);
  }
  fixture.brews.updateComposition(fixture.morning.id, {
    ...fixture.morning,
    sections: [
      {
        ...sectionWithSources(newBrewSection('letters'), sources),
        title: 'From your newsletters',
        onlyUnread: false,
      },
    ],
  });
  const url = `/b/${fixture.morning.id}/compose?section=letters&sheet=add-source`;
  const sheet = page.getByRole('dialog', {
    name: 'Add a source to “From your newsletters”',
    exact: true,
  });
  return {
    ...fixture,
    tag,
    url,
    sheet,
    config: () => fixture.brews.composition(fixture.morning.id)!,
  };
}
for (const theme of ['light', 'dark'] as const)
  test(`newsletter source picker reuses the Figma sheet and controls in ${theme}`, async ({
    page,
  }) => {
    const fixture = await setup(page, theme);
    await page.goto(fixture.url);
    await expect(
      fixture.sheet.getByRole('checkbox', { name: 'All newsletter senders', exact: true }),
    ).toBeChecked();
    await expect(
      fixture.sheet.getByRole('checkbox', { name: 'Sender: Interface Letters', exact: true }),
    ).toBeEnabled();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ['serious', 'critical'].includes(item.impact ?? ''),
      ),
    ).toEqual([]);
    await expect(fixture.sheet).toHaveScreenshot(`newsletter-sources-${theme}.png`, {
      animations: 'disabled',
    });
  });

test('keyboard source selection saves sender/tag unions, defaults letters to Grid, and preserves later layout choices', async ({
  page,
}) => {
  const fixture = await setup(page, 'light', [{ kind: 'today' }]);
  await page.goto(fixture.url);
  await fixture.sheet.getByRole('radio', { name: 'Starred', exact: true }).click();
  const today = fixture.sheet.getByRole('checkbox', { name: 'Today', exact: true });
  await expect(today).toBeChecked();
  await today.focus();
  await page.keyboard.press('Space');
  await fixture.sheet.getByRole('radio', { name: 'Newsletters', exact: true }).focus();
  await page.keyboard.press('Space');
  const sender = fixture.sheet.getByRole('checkbox', {
    name: 'Sender: Interface Letters',
    exact: true,
  });
  await expect(sender).toBeEnabled();
  await sender.focus();
  await page.keyboard.press('Space');
  await fixture.sheet.getByLabel('Filter newsletters', { exact: true }).fill('Design notes');
  const tag = fixture.sheet.getByRole('checkbox', {
    name: 'Newsletter tag: Design notes',
    exact: true,
  });
  await tag.focus();
  await page.keyboard.press('Space');
  await fixture.sheet.getByLabel('Filter newsletters', { exact: true }).fill('');
  await expect(sender).toBeChecked();
  await fixture.sheet.getByRole('button', { name: 'Add 1 source', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(fixture.sheet).not.toBeVisible();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  expect(fixture.config().sections[0]).toMatchObject({
    layout: 'grid',
    sources: [{ kind: 'newsletters', senderIds: [1], tagIds: [fixture.tag.id] }],
  });
  const preview = page.getByRole('article', { name: 'Web preview', exact: true });
  await expect(
    preview.getByText('The consent prompt is the product', { exact: true }),
  ).toBeVisible();
  await expect(preview.getByText('Annotations are documentation', { exact: true })).toBeVisible();
  await expect(preview.getByText('Design story', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Grid', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Magazine', exact: true }).click();
  await page.getByRole('button', { name: '+ Source', exact: true }).click();
  await expect(
    fixture.sheet.getByRole('checkbox', { name: 'Sender: Interface Letters', exact: true }),
  ).toBeChecked();
  await fixture.sheet
    .getByRole('checkbox', { name: 'All newsletter senders', exact: true })
    .check();
  await expect(
    fixture.sheet.getByRole('checkbox', { name: 'Sender: Interface Letters', exact: true }),
  ).not.toBeChecked();
  await fixture.sheet.getByRole('button', { name: 'Add 1 source', exact: true }).click();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  expect(fixture.config().sections[0]).toMatchObject({
    layout: 'magazine',
    sources: [{ kind: 'newsletters' }],
  });
  await page.getByRole('button', { name: 'Make one now', exact: true }).click();
  await expect(page).toHaveURL(/\/b\/1\/1$/);
  expect(fixture.brews.snapshot(1)?.sections[0]?.items).toHaveLength(5); // configured section item limit
});

test('newsletter library errors retry; missing IDs remain selected until explicitly removed; Cancel makes no writes', async ({
  page,
}) => {
  const fixture = await setup(page, 'light', [
    { kind: 'newsletters', senderIds: [999], tagIds: [999] },
  ]);
  const before = JSON.stringify(fixture.config());
  fixture.failNext('GET', '/api/newsletters/overview', 100);
  await page.goto(fixture.url);
  await expect(
    fixture.sheet.getByRole('button', { name: 'Retry newsletter senders', exact: true }),
  ).toBeVisible();
  fixture.failNext('GET', '/api/newsletters/overview', 0);
  await fixture.sheet
    .getByRole('button', { name: 'Retry newsletter senders', exact: true })
    .click();
  await expect(
    fixture.sheet.getByRole('checkbox', { name: 'Unavailable sender 999', exact: true }),
  ).toBeChecked();
  await expect(
    fixture.sheet.getByRole('checkbox', { name: 'Unavailable newsletter tag 999', exact: true }),
  ).toBeChecked();
  await fixture.sheet
    .getByRole('checkbox', { name: 'All newsletter senders', exact: true })
    .check();
  await fixture.sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(JSON.stringify(fixture.config())).toBe(before);
  await page.getByRole('button', { name: '+ Source', exact: true }).click();
  await fixture.sheet
    .getByRole('checkbox', { name: 'Unavailable sender 999', exact: true })
    .click();
  await expect(
    fixture.sheet.getByRole('checkbox', { name: 'Unavailable sender 999', exact: true }),
  ).toHaveCount(0);
  await fixture.sheet
    .getByRole('checkbox', { name: 'Unavailable newsletter tag 999', exact: true })
    .click();
  await expect(
    fixture.sheet.getByRole('button', { name: 'Add 0 sources', exact: true }),
  ).toBeDisabled();
  await fixture.sheet
    .getByRole('checkbox', { name: 'All newsletter senders', exact: true })
    .check();
  await fixture.sheet.getByRole('button', { name: 'Add 1 source', exact: true }).click();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  expect(fixture.config().sections[0]?.sources).toEqual([{ kind: 'newsletters' }]);
});

test('a connected mailbox can select future senders before its first letter arrives', async ({
  page,
}) => {
  const fixture = await setup(page, 'light', [{ kind: 'today' }], { empty: true });
  await page.goto(fixture.url);
  await fixture.sheet.getByRole('radio', { name: 'Newsletters', exact: true }).click();
  await expect(
    fixture.sheet.getByText('No newsletter senders yet.', { exact: true }),
  ).toBeVisible();
  await expect(
    fixture.sheet.getByRole('checkbox', { name: 'All newsletter senders', exact: true }),
  ).toBeEnabled();
  await fixture.sheet
    .getByRole('checkbox', { name: 'All newsletter senders', exact: true })
    .check();
  await fixture.sheet.getByRole('button', { name: 'Add 2 sources', exact: true }).click();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  expect(fixture.config().sections[0]?.sources).toContainEqual({ kind: 'newsletters' });
});
