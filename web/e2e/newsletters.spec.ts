import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newslettersFixture, newsletterTitle } from './newsletters-fixture';

test.use({ viewport: { width: 1440, height: 960 }, timezoneId: 'UTC' });
const fixtures: Array<Awaited<ReturnType<typeof newslettersFixture>>> = [];
test.afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});
async function setup(page: import('@playwright/test').Page, theme: 'light' | 'dark' = 'light') {
  const fixture = await newslettersFixture(page, { theme });
  fixtures.push(fixture);
  await page.goto('/letters');
  await expect(page.getByRole('heading', { name: newsletterTitle, exact: true })).toBeVisible();
  return fixture;
}
for (const theme of ['light', 'dark'] as const)
  test(`Newsletters matches its three-pane Figma layout in ${theme}`, async ({ page }) => {
    await setup(page, theme);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await expect(page.getByRole('img', { name: 'An arch in lavender' })).toBeVisible();
    const geometry = await page.evaluate(() => {
      const box = (selector: string) => {
        const { width, height } = document.querySelector(selector)!.getBoundingClientRect();
        return { width, height };
      };
      return {
        senders: box('.letters-senders'),
        list: box('.letters-list'),
        letter: box('.letters-letter'),
        header: box('.letters-topbar'),
        toolbar: box('.letters-toolbar'),
        image: box('.letters-html img'),
      };
    });
    expect(geometry.senders.width).toBe(248);
    expect(geometry.list.width).toBe(368);
    expect(geometry.letter.width).toBe(558);
    expect(geometry.header.height).toBe(56);
    expect(geometry.toolbar.height).toBe(52);
    expect(geometry.image).toEqual({ width: 446, height: 200 });
    const findings = (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
      ['serious', 'critical'].includes(item.impact ?? ''),
    );
    expect(findings).toEqual([]);
    await expect(page).toHaveScreenshot(`newsletters-${theme}.png`, {
      animations: 'disabled',
      maxDiffPixelRatio: 0.001,
    });
  });
test('sender actions, Starred, tags, routing, retention and Only in Brew persist through the real API', async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.getByRole('button', { name: 'Favorite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Favorite', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('radio', { name: 'Favorites', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Read / })).toHaveCount(2);
  await page.getByRole('button', { name: 'Tag', exact: true }).click();
  const tags = page.getByRole('dialog', { name: 'Tag this letter' });
  await tags.getByLabel('New tag', { exact: true }).fill('Design notes');
  await tags.getByRole('button', { name: 'Save tags', exact: true }).click();
  await expect(tags).not.toBeVisible();
  await expect(page.getByLabel('Letter tags')).toContainText('Design notes');
  await page.getByRole('button', { name: 'Save to Starred', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved to Starred', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change sender Brew', exact: true }).click();
  const settings = page.getByRole('dialog', {
    name: 'Settings for Interface Letters',
    exact: true,
  });
  await settings
    .getByRole('combobox', { name: 'Goes to Brew', exact: true })
    .selectOption(String(fixture.weekend.id));
  await settings.getByLabel('Retention in days', { exact: true }).fill('30');
  await settings.getByLabel('Only in Brew', { exact: true }).check();
  await settings.getByRole('button', { name: 'Save sender', exact: true }).click();
  await expect(settings).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Change sender Brew', exact: true })).toContainText(
    'Weekend',
  );
  await expect(
    page.getByRole('button', { name: 'Change sender retention', exact: true }),
  ).toContainText('30 days');
  await expect(page.getByRole('switch', { name: 'Only in Brew', exact: true })).toBeChecked();
  expect(fixture.library.letter(1)?.sender.settings).toMatchObject({
    favorite: true,
    brewId: fixture.weekend.id,
    retentionDays: 30,
    onlyInBrew: true,
  });
  await page.getByRole('button', { name: 'Skip sender', exact: true }).click();
  await page.getByRole('radio', { name: 'Skipped', exact: true }).click();
  await page.getByRole('button', { name: `Read ${newsletterTitle}`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unskip sender', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Block', exact: true }).click();
  await page.getByRole('radio', { name: 'Blocked', exact: true }).click();
  await page.getByRole('button', { name: `Read ${newsletterTitle}`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unblock', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unblock', exact: true }).click();
  await page.reload();
  expect(fixture.library.letter(1)?.sender.settings.blocked).toBe(false);
});
test('Show original and Open original are inert, retain uncleaned text, and respect retention', async ({
  page,
}) => {
  const fixture = await setup(page);
  const remote: string[] = [];
  page.context().on('request', (request) => {
    if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      remote.push(request.url());
  });
  await page.getByRole('button', { name: 'Show original', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Original letter from Interface Letters"]');
  await expect(frame.getByText('A sponsor block in the original', { exact: true })).toBeVisible();
  await expect(frame.getByText('Unsubscribe from this letter', { exact: true })).toBeVisible();
  expect(await frame.locator('script,img,iframe,[onclick],a[href]').count()).toBe(0);
  expect(await page.evaluate(() => 'letterScript' in window)).toBe(false);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open original', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await expect(popup.getByText('A sponsor block in the original')).toBeVisible();
  expect(await popup.locator('script,img,iframe,[onclick],a[href]').count()).toBe(0);
  await popup.close();
  expect(remote).toEqual([]);
  await page.getByRole('button', { name: 'Show cleaned', exact: true }).click();
  fixture.database.sqlite.prepare('UPDATE articles SET raw_html=NULL WHERE id=1').run();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Show original', exact: true })).toBeDisabled();
  await expect(page.getByText(/original expired with this sender/)).toBeVisible();
});

test('sender and letter failures retry without false success; originals have a recoverable error', async ({
  page,
}) => {
  const fixture = await setup(page);
  fixture.failNext('PATCH', '/api/newsletters/senders/1');
  await page.getByRole('button', { name: 'Favorite', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save Interface Letters');
  expect(fixture.library.letter(1)?.sender.settings.favorite).toBe(false);
  await page.getByRole('button', { name: 'Retry sender settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Favorite', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fixture.failNext('PATCH', '/api/articles/1');
  await page.getByRole('button', { name: `Read ${newsletterTitle}`, exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Retry letter update', exact: true }),
  ).toBeVisible();
  expect(fixture.library.letter(1)?.readAt).toBeNull();
  await page.getByRole('button', { name: 'Retry letter update', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark letter unread', exact: true })).toBeEnabled();
  await expect.poll(() => fixture.library.letter(1)?.readAt).not.toBeNull();
  fixture.failNext('GET', '/api/newsletters/letters/1/original', 2);
  await page.getByRole('button', { name: 'Show original', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry original', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry original', exact: true }).click();
  await expect(
    page.frameLocator('iframe').getByText('A sponsor block in the original'),
  ).toBeVisible();
});

test('address copying and Gmail instructions use the configured receiving address without connecting an account', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page);
  await page.getByRole('button', { name: 'Copy receiving address', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Address copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('k7f3@in.example.test');
  await page.getByRole('button', { name: 'Forward from Gmail', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Forward from Gmail', exact: true });
  await expect(dialog).toContainText('k7f3@in.example.test');
  await expect(dialog).toContainText('verification email');
  await expect(dialog).toContainText('Leave forwarding for all mail off');
  await expect(dialog).toContainText('new matching messages');
  await expect(
    dialog.getByRole('link', { name: 'Gmail forwarding instructions', exact: true }),
  ).toHaveAttribute('href', 'https://support.google.com/mail/answer/10957?hl=en');
  expect(
    (await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations.filter((item) =>
      ['serious', 'critical'].includes(item.impact ?? ''),
    ),
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Forward from Gmail', exact: true })).toBeFocused();
});

test('an empty unconfigured instance keeps mail setup visible and Calm hides decorative counts', async ({
  page,
}) => {
  fixtures.push(await newslettersFixture(page, { configured: false, empty: true, calm: true }));
  await page.goto('/letters');
  await expect(
    page.getByRole('heading', { name: 'No letters in your Inbox', exact: true }),
  ).toBeVisible();
  const card = page.getByRole('region', { name: 'Your Brew address', exact: true });
  await expect(
    card.getByRole('button', { name: 'Copy receiving address', exact: true }),
  ).toBeDisabled();
  await expect(card).toContainText('Needs mail add-on');
  await expect(card.getByRole('link', { name: 'Set up mail', exact: true })).toHaveAttribute(
    'href',
    '/settings/runs#setup-newsletters',
  );
  await expect(page.getByText('0 unread', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Forward from Gmail', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Forward from Gmail', exact: true })).toContainText(
    'Connect mail first',
  );
});

test('mobile keyboard navigation keeps local URL state and shares read state with Reader and Brew', async ({
  page,
}) => {
  const fixture = await newslettersFixture(page);
  fixtures.push(fixture);
  const issue = await fixture.brews.generateComposition(fixture.morning.id);
  const frozen = JSON.stringify(fixture.brews.snapshot(issue.id));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/letters');
  const row = page.getByRole('button', { name: `Read ${newsletterTitle}`, exact: true });
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/letters\/1$/);
  const pane = page.getByRole('article', { name: 'Letter from Interface Letters', exact: true });
  await expect(pane.getByRole('heading', { name: newsletterTitle, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark letter unread', exact: true })).toBeEnabled();
  await pane.focus();
  await page.keyboard.press('m');
  await expect.poll(() => fixture.library.letter(1)?.readAt).toBeNull();
  await page.getByRole('button', { name: 'Favorite', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Favorite', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Back to letters', exact: true }).click();
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Senders', exact: true }).click();
  await page.getByRole('button', { name: /^Low Tide/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/sender=7/);
  await expect(
    page.getByRole('button', { name: 'Read The consent prompt is the product', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/a/1');
  const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
  await expect(reader.getByRole('button', { name: 'Mark unread', exact: true })).toBeVisible();
  await reader.getByRole('button', { name: 'Mark unread', exact: true }).click();
  await expect.poll(() => fixture.library.letter(1)?.readAt).toBeNull();
  // The default preview does not mark a letter read until it is opened explicitly.
  await page.goto('/letters');
  await expect(page.getByRole('button', { name: 'Mark letter read', exact: true })).toBeVisible();
  const live = (await fixture.app.inject(`/api/brews/${issue.id}/state`)).json();
  expect(live.articles.find((article: { id: number }) => article.id === 1).readAt).toBeNull();
  expect(JSON.stringify(fixture.brews.snapshot(issue.id))).toBe(frozen);
});
