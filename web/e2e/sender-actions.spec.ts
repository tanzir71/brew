import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { newslettersFixture, newsletterTitle } from './newsletters-fixture';

for (const theme of ['light', 'dark'] as const)
  test(`letter More and native sender review retain focus, drafts and accessible phone layout in ${theme}`, async ({
    page,
  }, testInfo) => {
    const f = await newslettersFixture(page, { theme });
    try {
      await page.setViewportSize({ width: 1440, height: 960 });
      await page.goto('/letters');
      await expect(page.getByRole('heading', { name: newsletterTitle, exact: true })).toBeVisible();
      const more = page.getByRole('button', {
        name: 'More actions for Interface Letters',
        exact: true,
      });
      expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(24);
      await more.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('dialog', { name: 'Letter actions', exact: true });
      await expect(menu.getByRole('link', { name: 'Markdown', exact: true })).toHaveAttribute(
        'href',
        '/a/1.md',
      );
      await menu.screenshot({ path: testInfo.outputPath(`letter-more-${theme}.png`) });
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
          ['serious', 'critical'].includes(item.impact ?? ''),
        ),
      ).toEqual([]);
      await menu.getByRole('button', { name: 'Mark letter read', exact: true }).click();
      await expect(page.getByRole('status', { name: 'Letter result', exact: true })).toContainText(
        'Marked letter read.',
      );
      await expect(
        page.getByRole('button', { name: 'Mark letter unread', exact: true }),
      ).toBeEnabled();
      expect(
        (await page.getByRole('button', { name: 'Mark letter unread', exact: true }).boundingBox())!
          .height,
      ).toBeGreaterThanOrEqual(24);
      await more.click();
      await menu.getByRole('button', { name: 'Save to Starred', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Saved to Starred', exact: true }),
      ).toBeVisible();
      await more.click();
      await menu.getByRole('button', { name: 'Tag this letter', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Tag this letter', exact: true })
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await expect(more).toBeFocused();
      await page.keyboard.press('Enter');
      await menu.getByRole('button', { name: 'Sender settings', exact: true }).click();
      const editor = page.getByRole('dialog', {
        name: 'Settings for Interface Letters',
        exact: true,
      });
      const original = f.database.sqlite.prepare('SELECT * FROM feeds WHERE id=1').get();
      await editor.getByLabel('Retention in days', { exact: true }).fill('0');
      await expect(editor.getByRole('button', { name: 'Save sender', exact: true })).toBeDisabled();
      await editor.getByLabel('Retention in days', { exact: true }).fill('1');
      await editor.getByText('Cleaning overrides', { exact: true }).click();
      await editor.getByLabel('Sponsor selectors', { exact: true }).fill('[');
      await editor.getByRole('button', { name: 'Save sender', exact: true }).click();
      await expect(editor.getByRole('alert')).toContainText('Invalid newsletter cleaning selector');
      await expect(editor.getByLabel('Sponsor selectors', { exact: true })).toHaveValue('[');
      await editor.getByLabel('Sponsor selectors', { exact: true }).fill('.sponsor');
      await editor.getByRole('button', { name: 'Save sender', exact: true }).click();
      const review = page.getByRole('dialog', { name: 'Update Interface Letters?', exact: true });
      await expect(review).toContainText('Retention: 90 days → 1 day');
      await expect(review.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      expect(
        (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
          ['serious', 'critical'].includes(item.impact ?? ''),
        ),
      ).toEqual([]);
      await page.setViewportSize({ width: 390, height: 844 });
      await review.screenshot({ path: testInfo.outputPath(`sender-review-phone-${theme}.png`) });
      const box = await review.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.width).toBeLessThanOrEqual(390);
      await page.keyboard.press('Escape');
      await expect(editor.getByLabel('Retention in days', { exact: true })).toHaveValue('1');
      await expect(editor.getByLabel('Sponsor selectors', { exact: true })).toHaveValue('.sponsor');
      await editor.screenshot({ path: testInfo.outputPath(`sender-editor-phone-${theme}.png`) });
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Newsletters', exact: true })).toBeFocused();
      expect(f.database.sqlite.prepare('SELECT * FROM feeds WHERE id=1').get()).toEqual(original);
      expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
        n: 0,
      });
    } finally {
      await f.close();
    }
  });

test('stale sender review rejects all writes and a fresh review keeps a later unrelated preference', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    await page.goto('/letters');
    await page.getByRole('button', { name: 'Block', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Update Interface Letters?', exact: true });
    await expect(review).toContainText('Block new mail');
    f.library.updateSender(1, { favorite: true });
    await review.getByRole('button', { name: 'Save sender', exact: true }).click();
    await expect(review.getByRole('alert')).toContainText('review the settings again');
    expect(f.library.letter(1)!.sender.settings).toMatchObject({ favorite: true, blocked: false });
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
    await review.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Block', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await review.getByRole('button', { name: 'Save sender', exact: true }).click();
    await expect(review).not.toBeVisible();
    expect(f.library.letter(1)!.sender.settings).toMatchObject({ favorite: true, blocked: true });
    await page
      .getByRole('region', { name: 'Action result', exact: true })
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Favorite', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(f.library.letter(1)!.sender.settings.blocked).toBe(false);
  } finally {
    await f.close();
  }
});

test('unsupported sender writes and letter formats stay visible with active setup links and no requests', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const caps = (await f.app.inject('/api/capabilities')).json();
    await page.context().route('**/api/capabilities', (route) =>
      route.fulfill({
        json: {
          ...caps,
          actions: { ...caps.actions, undo: false },
          outputs: { ...caps.outputs, twins: false },
        },
      }),
    );
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') requests.push(new URL(request.url()).pathname);
    });
    await page.goto('/letters');
    await expect(page.getByRole('button', { name: 'Favorite', exact: true })).toBeDisabled();
    await page
      .getByRole('button', { name: 'More actions for Interface Letters', exact: true })
      .click();
    const menu = page.getByRole('dialog', { name: 'Letter actions', exact: true });
    await expect(menu.getByRole('button', { name: 'Block', exact: true })).toBeDisabled();
    await expect(
      menu.getByRole('button', { name: 'Markdown Twins need setup', exact: true }),
    ).toBeDisabled();
    await expect(
      menu.getByRole('link', { name: 'Set up sender actions', exact: true }),
    ).toHaveAttribute('href', '/settings/runs#setup-agents');
    await expect(
      menu.getByRole('link', { name: 'Set up letter outputs', exact: true }),
    ).toHaveAttribute('href', '/settings/runs#setup-outputs');
    await menu.getByRole('button', { name: 'Sender settings', exact: true }).click();
    const editor = page.getByRole('dialog', {
      name: 'Settings for Interface Letters',
      exact: true,
    });
    await expect(editor.getByLabel('Retention in days', { exact: true })).toBeDisabled();
    await expect(editor.getByRole('button', { name: 'Save sender', exact: true })).toBeDisabled();
    await expect(
      editor.getByRole('link', { name: 'Set up sender actions', exact: true }),
    ).toBeVisible();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(requests).toEqual([]);
  } finally {
    await f.close();
  }
});

test('a removed assigned Brew keeps Only in Brew disabled until a real Brew is selected', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    f.database.sqlite.prepare('DELETE FROM brew_configs WHERE id=?').run(f.morning.id);
    await page.goto('/letters');
    await expect(page.getByRole('switch', { name: 'Only in Brew', exact: true })).toBeDisabled();
    await page
      .getByRole('button', { name: 'More actions for Interface Letters', exact: true })
      .click();
    const menu = page.getByRole('dialog', { name: 'Letter actions', exact: true });
    await expect(menu.getByRole('button', { name: 'Only in Brew', exact: true })).toBeDisabled();
    await expect(menu).toContainText('Choose a Brew in sender settings');
    await menu.getByRole('button', { name: 'Sender settings', exact: true }).click();
    const editor = page.getByRole('dialog', {
      name: 'Settings for Interface Letters',
      exact: true,
    });
    await expect(editor.getByLabel('Only in Brew', { exact: true })).toBeDisabled();
    await editor
      .getByRole('combobox', { name: 'Goes to Brew', exact: true })
      .selectOption(String(f.weekend.id));
    await expect(editor.getByLabel('Only in Brew', { exact: true })).toBeEnabled();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(f.library.letter(1)!.sender.settings.onlyInBrew).toBe(false);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
  } finally {
    await f.close();
  }
});

test('cancelled and obsolete sender previews cannot perform a later write', async ({ page }) => {
  const f = await newslettersFixture(page);
  let release: (() => void) | undefined;
  try {
    let started: (() => void) | undefined;
    let seen = new Promise<void>((resolve) => {
      started = resolve;
    });
    await page.context().route('**/api/newsletters/senders/1/preview', async (route) => {
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      started?.();
      await wait;
      try {
        const result = await f.app.inject({
          method: 'POST',
          url: '/api/newsletters/senders/1/preview',
          payload: route.request().postDataJSON(),
        });
        await route.fulfill({ status: result.statusCode, json: result.json() });
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    await page.goto('/letters');
    const favorite = page.getByRole('button', { name: 'Favorite', exact: true });
    await favorite.click();
    await seen;
    await page.getByRole('button', { name: 'Cancel review', exact: true }).click();
    await expect(favorite).toBeEnabled();
    await expect(favorite).toBeFocused();
    release?.();
    seen = new Promise<void>((resolve) => {
      started = resolve;
    });
    await favorite.click();
    await seen;
    const sort = page.getByRole('combobox', { name: 'Sort senders', exact: true });
    await sort.focus();
    await sort.selectOption('name');
    release?.();
    await expect(page).toHaveURL('/letters?sort=name');
    await expect(favorite).toBeEnabled();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expect(sort).toBeFocused();
    seen = new Promise<void>((resolve) => {
      started = resolve;
    });
    await favorite.click();
    await seen;
    await page.getByRole('radio', { name: 'Skipped', exact: true }).click();
    release?.();
    await expect(page).toHaveURL('/letters?view=skipped&sort=name');
    await expect(page.getByRole('radio', { name: 'Skipped', exact: true })).toBeChecked();
    await expect(
      page.getByRole('dialog', { name: 'Update Interface Letters?', exact: true }),
    ).toHaveCount(0);
    expect(f.library.letter(1)!.sender.settings.favorite).toBe(false);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
  } finally {
    release?.();
    await f.close();
  }
});
