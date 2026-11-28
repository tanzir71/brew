import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { composeFixture } from './compose-fixture';
import { BrewService } from '../../targets/node/src/services/brew-service';
const active: Array<Awaited<ReturnType<typeof composeFixture>>> = [];
test.afterEach(async () => {
  for (const fixture of active.splice(0)) await fixture.close();
});
async function setup(page: Parameters<typeof composeFixture>[0], theme = 'light') {
  const fixture = await composeFixture(page, theme);
  active.push(fixture);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(`/b/${fixture.config.id}/compose?section=design`);
  await expect(page.getByRole('article', { name: 'Web preview' })).toBeVisible();
  return fixture;
}
for (const theme of ['light', 'dark'])
  test(`Figma Compose in ${theme}: real Node preview, native art and accessible controls`, async ({
    page,
  }) => {
    const remote: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:4401/')) remote.push(request.url());
    });
    const fixture = await setup(page, theme);
    await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
    await expect(page.getByText('Matches 4 of 4 unread now')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send test', exact: true })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Brief', exact: true })).toBeDisabled();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    const hero = await page.locator('.compose-preview-hero img').evaluate((element) => {
      const image = element as HTMLImageElement;
      return {
        natural: [image.naturalWidth, image.naturalHeight],
        rendered: [image.getBoundingClientRect().width, image.getBoundingClientRect().height],
        available: image.parentElement!.clientWidth,
        filter: getComputedStyle(image).filter,
      };
    });
    expect(hero.natural).toEqual([468, 190]);
    expect(hero.filter).toBe('none');
    expect(hero.rendered[0]).toBeCloseTo(hero.available, 0);
    expect(hero.rendered[0]! / hero.rendered[1]!).toBeCloseTo(468 / 190, 2);
    expect(
      await page.locator('.compose-preview-thumbnail img').evaluateAll((elements) =>
        elements.map((element) => {
          const image = element as HTMLImageElement;
          return [
            image.naturalWidth,
            image.naturalHeight,
            image.getBoundingClientRect().width,
            image.getBoundingClientRect().height,
          ];
        }),
      ),
    ).toEqual([
      [84, 58, 84, 58],
      [84, 58, 84, 58],
    ]);
    await expect(page).toHaveScreenshot(`compose-${theme}.png`, { animations: 'disabled' });
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((value) =>
        ['serious', 'critical'].includes(value.impact ?? ''),
      ),
    ).toEqual([]);
    expect(remote).toEqual([]);
    expect(new BrewService(fixture.database).history(fixture.config.id)).toEqual([]);
  });
test('Compose controls update the saved config and all three live formats', async ({ page }) => {
  const fixture = await setup(page);
  const card = page.locator('[data-brew-id=design]');
  await card.getByRole('radio', { name: 'Grid', exact: true }).click();
  await expect(page.locator('[data-preview-section=design]')).toHaveAttribute(
    'data-layout',
    'grid',
  );
  await card.getByRole('radio', { name: 'Full text', exact: true }).click();
  await expect(page.getByText('Full article 0. A careful look at everyday tools.')).toBeVisible();
  await card.getByRole('switch', { name: 'Images', exact: true }).click();
  await expect(page.locator('.compose-preview-hero img')).toHaveCount(0);
  await expect(page.locator('.compose-preview-thumbnail img')).toHaveCount(0);
  await card.getByRole('combobox', { name: 'Section order' }).selectOption('oldest');
  await card.getByRole('spinbutton', { name: 'Items at most' }).fill('2');
  await expect(page.getByText('Matches 4 of 4 unread now')).toBeVisible();
  await card.getByRole('textbox', { name: 'Condition 1 value' }).fill('missing');
  await card.getByRole('combobox', { name: 'Condition 2 match' }).selectOption('all');
  await expect(page.getByText('Matches 0 of 4 unread now')).toBeVisible();
  await expect(
    page.locator('[data-preview-section=design]').getByText('No matching stories for this issue.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Section title', exact: true }).fill('A short note');
  await page
    .getByRole('textbox', { name: 'Note · Markdown' })
    .fill('Read **slowly**. [Source](https://example.test/note)');
  await expect(page.locator('.compose-note-preview strong')).toHaveText('slowly');
  await page.getByRole('radio', { name: 'Phone', exact: true }).click();
  await expect(page.locator('.compose-paper')).toHaveAttribute('data-device', 'phone');
  await page.getByRole('radio', { name: 'Email', exact: true }).click();
  await expect(
    page.frameLocator('iframe[title="Email preview"]').getByText('A short note', { exact: true }),
  ).toBeVisible();
  await expect(page.frameLocator('iframe[title="Email preview"]').locator('strong')).toHaveText(
    'slowly',
  );
  await page.getByRole('radio', { name: 'Feed', exact: true }).click();
  await expect(page.getByLabel('Atom feed preview')).toContainText(
    '<feed xmlns="http://www.w3.org/2005/Atom">',
  );
  await expect(page.getByLabel('Atom feed preview')).toContainText('A short note');
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  const saved = new BrewService(fixture.database).composition(fixture.config.id)!;
  expect(saved.sections[0]).toMatchObject({
    layout: 'grid',
    depth: 'full',
    images: false,
    sort: 'oldest',
    maxItems: 2,
    filter: { match: 'all' },
  });
  expect(saved.sections.at(-1)?.note).toContain('**slowly**');
});
test('section reordering works with Alt+Arrow, visible buttons and drag; preview links select cards; remove has Undo', async ({
  page,
}) => {
  const fixture = await setup(page);
  const card = page.locator('[data-brew-id=design]');
  const ids = () =>
    page
      .locator('.brew-section-card')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-brew-id')));
  await card.getByRole('button', { name: 'Drag Design & craft to reorder' }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(ids).toEqual(['letters', 'design', 'engineering', 'weekly', 'note']);
  await expect(card.getByRole('button', { name: 'Drag Design & craft to reorder' })).toBeFocused();
  await card.getByRole('button', { name: 'Move Design & craft up' }).click();
  await expect.poll(ids).toEqual(['design', 'letters', 'engineering', 'weekly', 'note']);
  await page.getByRole('button', { name: 'Drag Engineering to reorder', exact: true }).dragTo(card);
  await expect.poll(ids).toEqual(['engineering', 'design', 'letters', 'weekly', 'note']);
  await page.getByRole('button', { name: 'Edit Engineering', exact: true }).click();
  await expect(page.locator('[data-brew-id=engineering]')).toHaveAttribute('data-expanded', 'true');
  await expect(page.locator('[data-preview-section=engineering]')).toHaveAttribute(
    'data-editing',
    'true',
  );
  await page.getByRole('button', { name: 'Section options', exact: true }).click();
  await page.getByRole('button', { name: 'Remove section', exact: true }).click();
  await page.getByRole('button', { name: 'Remove section', exact: true }).click();
  await expect(page.locator('[data-brew-id=engineering]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(ids).toEqual(['engineering', 'design', 'letters', 'weekly', 'note']);
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  expect(
    new BrewService(fixture.database)
      .composition(fixture.config.id)!
      .sections.map((section) => section.id),
  ).toEqual(await ids());
});
test('autosave serializes edits, retries failure, and flushes before navigating to Read', async ({
  page,
}) => {
  const fixture = await setup(page);
  let release!: () => void;
  fixture.holdSave(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const title = page.getByRole('textbox', { name: 'Section title', exact: true });
  await title.fill('First edit');
  await expect.poll(() => fixture.puts.length).toBe(1);
  await title.fill('Latest edit');
  expect(fixture.puts[0]!.sections[0]!.title).toBe('First edit');
  await expect(page.getByLabel('Autosave')).not.toHaveText('All changes saved');
  release();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  expect(fixture.puts.at(-1)!.sections[0]!.title).toBe('Latest edit');
  fixture.failNextSave();
  await title.fill('Retry this');
  await expect(page.getByLabel('Autosave')).toHaveText('Save unavailable. Try again.');
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  await title.fill('Saved before leaving');
  await page.getByRole('radio', { name: 'Read', exact: true }).click();
  await expect(page).toHaveURL(/\/b\/1$/);
  expect(new BrewService(fixture.database).composition(fixture.config.id)!.sections[0]!.title).toBe(
    'Saved before leaving',
  );
});
test('obsolete previews cannot rewind newer edits, and preview errors are retryable', async ({
  page,
}) => {
  const fixture = await setup(page);
  let release!: () => void;
  let held = false;
  fixture.holdPreview(() => {
    held = true;
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  const title = page.getByRole('textbox', { name: 'Section title', exact: true });
  await title.fill('Obsolete title');
  await expect.poll(() => held).toBe(true);
  await title.fill('Current title');
  await expect(page.locator('[data-preview-section=design] h2')).toHaveText('Current title');
  release();
  await expect(page.locator('[data-preview-section=design] h2')).toHaveText('Current title');
  fixture.failNextPreview();
  await title.fill('Retry preview title');
  await expect(page.getByRole('alert')).toContainText('Preview unavailable.');
  await page.getByRole('button', { name: 'Retry preview', exact: true }).click();
  await expect(page.locator('[data-preview-section=design] h2')).toHaveText('Retry preview title');
});
test('source changes persist and Make one now flushes unsaved sections into a frozen Read issue', async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByRole('button', { name: '+ Source', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a source to “Design & craft”' });
  await sheet.getByRole('radio', { name: 'Folders', exact: true }).click();
  await sheet.getByRole('checkbox', { name: 'Design', exact: true }).uncheck();
  await sheet.getByRole('checkbox', { name: 'Independent', exact: true }).uncheck();
  await sheet.getByRole('checkbox', { name: 'Engineering', exact: true }).check();
  await sheet.getByRole('button', { name: 'Add 1 source', exact: true }).click();
  await expect(
    page.locator('[data-brew-id=design]').getByText('Matches 1 of 1 unread now'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Expand Note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note · Markdown' }).fill('A **fresh** edition.');
  await page.getByRole('button', { name: 'Make one now', exact: true }).click();
  await expect(page).toHaveURL(/\/b\/1\/1$/);
  await expect(page.locator('.brew-edition-note strong')).toHaveText('fresh');
  const issue = new BrewService(fixture.database).snapshot(1)!;
  expect(issue).toMatchObject({ version: 2, issueNumber: 1 });
  expect(issue.sections[0]!.items.map((item) => item.title)).toEqual([
    'SQLite in the browser is finally boring',
  ]);
});
