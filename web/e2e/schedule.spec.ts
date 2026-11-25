import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { composeFixture } from './compose-fixture';
import { BrewService } from '../../targets/node/src/services/brew-service';
import type { OutboundMailPort } from '../../packages/core/src/types/delivery';
const clock = { now: () => new Date('2026-11-25T00:00:00Z'), monotonic: () => performance.now() };
const active: Array<Awaited<ReturnType<typeof composeFixture>>> = [];
test.afterEach(async () => {
  for (const fixture of active.splice(0)) await fixture.close();
});
async function setup(page: Page, theme = 'light', outboundMail?: OutboundMailPort) {
  const fixture = await composeFixture(page, theme, undefined, { clock, outboundMail });
  active.push(fixture);
  const brews = new BrewService(fixture.database, clock);
  const config = brews.composition(1)!;
  brews.updateComposition(1, { ...config, delivery: { ...config.delivery, email: undefined } });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/b/1/compose?section=design');
  await expect(page.getByRole('article', { name: 'Web preview' })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Schedule summary' })
      .getByRole('link', { name: 'Set up', exact: true }),
  ).toHaveAttribute('href', '/settings/runs#setup-delivery');
  await page
    .getByRole('region', { name: 'Schedule summary' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Schedule & delivery', exact: true });
  await expect(sheet.getByRole('radio', { name: 'Weekdays', exact: true })).toBeFocused();
  await expect(sheet.locator('.schedule-next')).toContainText('Next issue');
  return { ...fixture, sheet, brews };
}
for (const theme of ['light', 'dark'])
  test(`Figma Schedule & delivery in ${theme}`, async ({ page }) => {
    const remote: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:4401/')) remote.push(request.url());
    });
    const { sheet } = await setup(page, theme);
    expect(await sheet.boundingBox()).toEqual({ x: 972, y: 8, width: 460, height: 1064 });
    expect(
      await sheet
        .locator('.schedule-days button')
        .evaluateAll((elements) =>
          elements.map((element) => [
            element.getBoundingClientRect().width,
            element.getBoundingClientRect().height,
          ]),
        ),
    ).toEqual(Array(7).fill([34, 34]));
    const stepper = await sheet
      .getByRole('group', { name: 'Skip threshold', exact: true })
      .boundingBox();
    expect(stepper && [stepper.width, stepper.height]).toEqual([84, 30]);
    expect((await sheet.locator(':scope > footer').boundingBox())?.height).toBe(69);
    const inBrew = sheet
      .locator('.schedule-channel')
      .filter({ has: page.getByRole('heading', { name: 'In Brew', exact: true }) });
    const row = await inBrew.boundingBox();
    const badge = await inBrew.getByText('Works here', { exact: true }).boundingBox();
    expect(row?.height).toBe(65);
    expect(row && badge && row.x + row.width - badge.x - badge.width).toBe(14);
    await expect(sheet.getByRole('switch', { name: 'Email', exact: true })).toBeDisabled();
    await expect(
      sheet.getByRole('switch', { name: 'Atom and JSON feed', exact: true }),
    ).toBeEnabled();
    await expect(sheet.getByRole('switch', { name: 'Webhook', exact: true })).toBeDisabled();
    await expect(sheet.getByRole('switch', { name: 'Public page', exact: true })).toBeDisabled();
    await expect(
      sheet.getByRole('button', { name: 'Send a test now', exact: true }),
    ).toBeDisabled();
    await expect(sheet.getByRole('combobox', { name: 'Time zone', exact: true })).toHaveValue(
      'Asia/Dhaka',
    );
    await expect(sheet.getByText('Always on. Each issue is kept for 30 days.')).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await expect(page).toHaveScreenshot(`schedule-${theme}.png`, { animations: 'disabled' });
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ['serious', 'critical'].includes(item.impact ?? ''),
      ),
    ).toEqual([]);
    expect(remote).toEqual([]);
  });
test('weekly day chips, arbitrary minutes and IANA zones persist, with truthful next issue and skip threshold', async ({
  page,
}) => {
  const { sheet, brews } = await setup(page);
  await sheet.getByRole('radio', { name: 'Weekly', exact: true }).click();
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
    await sheet.getByRole('button', { name: day, exact: true }).click();
  await sheet.getByRole('button', { name: 'Sunday', exact: true }).click();
  await sheet.getByRole('combobox', { name: 'Time', exact: true }).selectOption('08:17');
  await sheet
    .getByRole('combobox', { name: 'Time zone', exact: true })
    .selectOption('Europe/Paris');
  await sheet.getByRole('spinbutton', { name: 'Skip threshold', exact: true }).fill('2');
  await expect(sheet.locator('.schedule-next')).toContainText('Sun 29 Nov, 08:17');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  expect(brews.composition(1)).toMatchObject({
    timezone: 'Europe/Paris',
    scheduleCron: '17 8 * * 0',
    schedule: { kind: 'weekly', time: '08:17', days: [0], skipIfFewerThan: 2 },
  });
  await page.reload();
  await page
    .getByRole('region', { name: 'Schedule summary' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await expect(sheet.getByRole('button', { name: 'Sunday', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(sheet.getByRole('combobox', { name: 'Time', exact: true })).toHaveValue('08:17');
});
test('monthly validation, disabling the skip threshold and pausing scheduling work without losing other settings', async ({
  page,
}) => {
  const fixture = await setup(page);
  const { sheet, brews } = fixture;
  await sheet.getByRole('radio', { name: 'Monthly', exact: true }).click();
  await sheet.getByRole('spinbutton', { name: 'Day of month', exact: true }).fill('32');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.getByRole('alert')).toHaveText('Choose a day from 1–31.');
  expect(fixture.puts).toHaveLength(0);
  await sheet.getByRole('spinbutton', { name: 'Day of month', exact: true }).fill('31');
  await sheet.getByRole('combobox', { name: 'Time zone', exact: true }).selectOption('UTC');
  await expect(sheet.locator('.schedule-next')).toContainText('31 Dec');
  await sheet.getByRole('switch', { name: 'Skip small issues', exact: true }).click();
  await expect(
    sheet.getByRole('spinbutton', { name: 'Skip threshold', exact: true }),
  ).toBeDisabled();
  await sheet.getByRole('switch', { name: 'Scheduled', exact: true }).click();
  await expect(sheet.locator('.schedule-next')).toHaveText('Schedule paused');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  expect(brews.composition(1)).toMatchObject({
    enabled: false,
    timezone: 'UTC',
    schedule: { kind: 'monthly', dayOfMonth: 31, skipIfFewerThan: 0 },
  });
  expect(brews.composition(1)!.sections).toHaveLength(5);
});
test('Escape cancels local changes and keyboard focus remains trapped and restored', async ({
  page,
}) => {
  const { sheet, brews, database } = await setup(page);
  const before = JSON.stringify(brews.composition(1));
  const writes = database.sqlite.prepare('SELECT total_changes() AS count').get();
  await sheet.getByRole('radio', { name: 'Daily', exact: true }).click();
  await sheet.getByRole('combobox', { name: 'Time', exact: true }).selectOption('11:45');
  await sheet.getByRole('button', { name: 'Save', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(
    sheet.getByRole('button', { name: 'Close Schedule & delivery', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).not.toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Schedule summary' })
      .getByRole('button', { name: 'Edit', exact: true }),
  ).toBeFocused();
  expect(JSON.stringify(brews.composition(1))).toBe(before);
  expect(database.sqlite.prepare('SELECT total_changes() AS count').get()).toEqual(writes);
});
test('failed next-run checks and saves are retryable, and late schedule responses cannot rewind edits', async ({
  page,
}) => {
  const fixture = await setup(page);
  const { sheet, brews } = fixture;
  let fail = true;
  let release!: () => void;
  let held = false;
  let replied = false;
  await page.route('**/api/brew-configs/1/schedule-preview', async (route) => {
    if (fail) {
      fail = false;
      return route.fulfill({ status: 503, json: { error: 'Schedule unavailable.' } });
    }
    if (route.request().postDataJSON().schedule.time === '11:23') {
      held = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({
        json: {
          now: '2026-11-25T00:00:00Z',
          nextAt: '2026-11-25T05:23:00Z',
          timezone: 'Asia/Dhaka',
        },
      });
      replied = true;
      return;
    }
    return route.fallback();
  });
  const time = sheet.getByRole('combobox', { name: 'Time', exact: true });
  await time.selectOption('11:22');
  await expect(sheet.locator('.schedule-next')).toContainText('Schedule unavailable.');
  await sheet.getByRole('button', { name: 'Retry schedule', exact: true }).click();
  await expect(sheet.locator('.schedule-next')).toContainText('11:22');
  await time.selectOption('11:23');
  await expect.poll(() => held).toBe(true);
  await time.selectOption('11:24');
  await expect(sheet.locator('.schedule-next')).toContainText('11:24');
  release();
  await expect.poll(() => replied).toBe(true);
  await expect(sheet.locator('.schedule-next')).toContainText('11:24');
  fixture.failNextSave();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('Save unavailable. Try again.');
  expect(brews.composition(1)!.schedule.time).toBe('07:00');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  expect(brews.composition(1)!.schedule.time).toBe('11:24');
});
test('test email uses the actual unsaved preview, waits for provider acknowledgement, retries failure and never saves an issue', async ({
  page,
}) => {
  const sent: Parameters<OutboundMailPort['send']>[0][] = [];
  let fail = true;
  const { sheet, brews, database, puts } = await setup(page, 'light', {
    kind: 'smtp',
    send: async (message) => {
      sent.push(message);
      if (fail) {
        fail = false;
        throw new Error('SMTP temporary failure.');
      }
      return { messageId: 'sent-2' };
    },
  });
  await sheet.getByRole('switch', { name: 'Email', exact: true }).click();
  await sheet
    .getByRole('textbox', { name: 'Email recipient', exact: true })
    .fill('test@example.test');
  await sheet.getByRole('button', { name: 'Send a test now', exact: true }).click();
  await expect(sheet.getByRole('alert')).toHaveText('SMTP temporary failure.');
  await sheet.getByRole('button', { name: 'Send a test now', exact: true }).click();
  await expect(
    sheet.getByRole('status').filter({ hasText: 'Test sent to test@example.test.' }),
  ).toBeVisible();
  expect(sent).toHaveLength(2);
  expect(sent[1]).toMatchObject({ to: 'test@example.test', subject: 'Test · Morning' });
  expect(sent[1]!.html).toContain('The quiet structure behind interfaces that feel inevitable');
  expect(database.sqlite.prepare('SELECT count(*) AS count FROM brews').get()).toEqual({
    count: 0,
  });
  expect(brews.composition(1)!.delivery.email).toBeUndefined();
  expect(puts).toHaveLength(0);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  expect(brews.composition(1)!.delivery.email?.to).toBe('test@example.test');
});
test('delivery availability fails closed and its setup guide is reachable', async ({ page }) => {
  const { sheet } = await setup(page);
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  );
  await page.reload();
  await expect(sheet.getByRole('alert')).toContainText('Could not check delivery availability.');
  await expect(sheet.getByRole('switch', { name: 'Email', exact: true })).toBeDisabled();
  await expect(sheet.getByRole('button', { name: 'Retry delivery', exact: true })).toBeVisible();
  await sheet
    .locator('.schedule-channel')
    .filter({ hasText: 'Atom and JSON feed' })
    .getByRole('link', { name: 'Set up', exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/runs#setup-outputs$/);
  await expect(
    page.getByRole('heading', { name: 'Publishing outputs', exact: true }),
  ).toBeVisible();
});
