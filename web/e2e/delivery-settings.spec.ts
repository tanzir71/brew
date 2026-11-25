import { expect, test, type Page } from '@playwright/test';
import { composeFixture } from './compose-fixture';
import { BrewService } from '../../targets/node/src/services/brew-service';
import { defaultDelivery } from '../../packages/core/src/composition-model';
import { nodeCapabilities } from '../../targets/node/src/capabilities';

const fixtures: Array<Awaited<ReturnType<typeof setup>>> = [];
test.afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});
async function setup(page: Page) {
  let sends = 0;
  const fixture = await composeFixture(page, 'light', undefined, {
    outboundMail: {
      kind: 'smtp',
      send: async () => {
        sends++;
        throw new Error('Unexpected send');
      },
    },
  });
  const service = new BrewService(fixture.database);
  const config = service.composition(fixture.config.id)!;
  service.updateComposition(config.id, { ...config, delivery: defaultDelivery() });
  // Exercise the shared capability contract, including the future public-copy preference.
  // The underlying Node adapter still cannot publish a static copy.
  let available = true;
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({
      json: {
        ...nodeCapabilities(),
        emailDelivery: available ? 'smtp' : null,
        publicCopy: available,
        outputs: { twins: true, feed: available, webhook: available },
      },
    }),
  );
  const stored = () =>
    JSON.parse(
      (
        fixture.database.sqlite
          .prepare('SELECT delivery_json AS value FROM brew_configs WHERE id=?')
          .get(config.id) as { value: string }
      ).value,
    );
  const result = {
    ...fixture,
    service,
    config,
    stored,
    sends: () => sends,
    capability: (ready: boolean) => {
      available = ready;
    },
  };
  fixtures.push(result);
  await page.goto(`/b/${config.id}/compose?section=design&sheet=schedule`);
  await expect(
    page.getByRole('dialog', { name: 'Schedule & delivery', exact: true }),
  ).toBeVisible();
  return result;
}
async function openSheet(page: Page) {
  await page
    .getByRole('region', { name: 'Schedule summary' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Schedule & delivery', exact: true });
}
const channels = ['Atom and JSON feed', 'Email', 'Webhook', 'Public page'] as const;
const selected = {
  web: true,
  feed: true,
  email: { to: 'saved@example.test' },
  webhook: { url: 'https://receiver.example.test/hook?key=fixture' },
  publicCopy: true,
};
async function selectAll(sheet: ReturnType<Page['getByRole']>) {
  for (const name of channels) await sheet.getByRole('switch', { name, exact: true }).check();
  await sheet
    .getByRole('textbox', { name: 'Email recipient', exact: true })
    .fill(selected.email.to);
  await sheet.getByRole('textbox', { name: 'Webhook URL', exact: true }).fill(selected.webhook.url);
}

test('failed Save then Cancel cannot leak discarded channels into a later autosave', async ({
  page,
}) => {
  const fixture = await setup(page);
  const sheet = page.getByRole('dialog', { name: 'Schedule & delivery', exact: true });
  await selectAll(sheet);
  fixture.failNextSave();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('Save unavailable. Try again.');
  expect(fixture.stored()).toEqual(defaultDelivery());
  await page.keyboard.press('Escape');
  await expect(sheet).not.toBeVisible();
  await page.getByRole('textbox', { name: 'Section title', exact: true }).fill('An unrelated edit');
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  expect(fixture.stored()).toEqual(defaultDelivery());
  expect(fixture.service.composition(fixture.config.id)!.sections[0]!.title).toBe(
    'An unrelated edit',
  );
  const reopened = await openSheet(page);
  for (const name of channels)
    await expect(reopened.getByRole('switch', { name, exact: true })).not.toBeChecked();
  expect(fixture.sends()).toBe(0);
});

test('every channel persists to SQLite on Save and reload, and off channels omit their destinations', async ({
  page,
}) => {
  const fixture = await setup(page);
  let sheet = page.getByRole('dialog', { name: 'Schedule & delivery', exact: true });
  await selectAll(sheet);
  for (const [name, field, value] of [
    ['Email', 'Email recipient', selected.email.to],
    ['Webhook', 'Webhook URL', selected.webhook.url],
  ] as const) {
    await sheet.getByRole('switch', { name, exact: true }).uncheck();
    await sheet.getByRole('switch', { name, exact: true }).check();
    await expect(sheet.getByRole('textbox', { name: field, exact: true })).toHaveValue(value);
  }
  expect(fixture.stored()).toEqual(defaultDelivery());
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  expect(fixture.stored()).toEqual(selected);
  await page.reload();
  sheet = await openSheet(page);
  for (const name of channels)
    await expect(sheet.getByRole('switch', { name, exact: true })).toBeChecked();
  await expect(sheet.getByRole('textbox', { name: 'Email recipient', exact: true })).toHaveValue(
    selected.email.to,
  );
  await expect(sheet.getByRole('textbox', { name: 'Webhook URL', exact: true })).toHaveValue(
    selected.webhook.url,
  );
  for (const name of channels) await sheet.getByRole('switch', { name, exact: true }).uncheck();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  expect(fixture.stored()).toEqual(defaultDelivery());
  await page.reload();
  sheet = await openSheet(page);
  for (const name of channels)
    await expect(sheet.getByRole('switch', { name, exact: true })).not.toBeChecked();
  await expect(sheet.getByRole('textbox', { name: 'Email recipient', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('textbox', { name: 'Webhook URL', exact: true })).toHaveCount(0);
  expect(fixture.sends()).toBe(0);
});

test('a failed candidate stays in the sheet for retry and becomes current only after acknowledgement', async ({
  page,
}) => {
  const fixture = await setup(page);
  const sheet = page.getByRole('dialog', { name: 'Schedule & delivery', exact: true });
  await selectAll(sheet);
  fixture.failNextSave();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.getByRole('alert')).toContainText('Save unavailable. Try again.');
  for (const name of channels)
    await expect(sheet.getByRole('switch', { name, exact: true })).toBeChecked();
  await expect(sheet.getByRole('textbox', { name: 'Email recipient', exact: true })).toHaveValue(
    selected.email.to,
  );
  let release!: () => void;
  fixture.holdSave(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fixture.puts.length).toBe(2);
  expect(fixture.stored()).toEqual(defaultDelivery());
  await expect(page.locator('.compose-delivery')).not.toContainText('Email');
  await expect(sheet.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  release();
  await expect(sheet).not.toBeVisible();
  expect(fixture.stored()).toEqual(selected);
  await expect(page.getByRole('region', { name: 'Schedule summary' })).toContainText('Email');
  expect(fixture.sends()).toBe(0);
});

test('unavailable saved preferences survive schedule edits and can be explicitly removed without losing other channels', async ({
  page,
}) => {
  const fixture = await setup(page);
  let sheet = page.getByRole('dialog', { name: 'Schedule & delivery', exact: true });
  await selectAll(sheet);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  fixture.capability(false);
  await page.reload();
  sheet = await openSheet(page);
  for (const name of channels) {
    await expect(sheet.getByRole('switch', { name, exact: true })).toBeDisabled();
    await expect(sheet.getByRole('switch', { name, exact: true })).toBeChecked();
  }
  await expect(sheet.getByRole('textbox', { name: 'Email recipient', exact: true })).toBeDisabled();
  await expect(sheet.getByRole('textbox', { name: 'Webhook URL', exact: true })).toHaveValue(
    selected.webhook.url,
  );
  await sheet.getByRole('combobox', { name: 'Time', exact: true }).selectOption('08:17');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  expect(fixture.stored()).toEqual(selected);
  expect(fixture.service.composition(fixture.config.id)!.schedule.time).toBe('08:17');
  sheet = await openSheet(page);
  await sheet.getByRole('button', { name: 'Disable Email preference', exact: true }).click();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  expect(fixture.stored()).toEqual({
    web: true,
    feed: true,
    webhook: selected.webhook,
    publicCopy: true,
  });
  expect(fixture.sends()).toBe(0);
});

test('a settings save waits for earlier section autosave and adopts channels only after acknowledgement', async ({
  page,
}) => {
  const fixture = await setup(page);
  await page.keyboard.press('Escape');
  let release!: () => void;
  fixture.holdSave(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await page
    .getByRole('textbox', { name: 'Section title', exact: true })
    .fill('An earlier section edit');
  await expect.poll(() => fixture.puts.length).toBe(1);
  const sheet = await openSheet(page);
  await selectAll(sheet);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  expect(fixture.puts).toHaveLength(1);
  expect(fixture.stored()).toEqual(defaultDelivery());
  release();
  await expect(sheet).not.toBeVisible();
  expect(fixture.stored()).toEqual(selected);
  expect(fixture.service.composition(fixture.config.id)!.sections[0]!.title).toBe(
    'An earlier section edit',
  );
  expect(fixture.puts).toHaveLength(2);
  expect(fixture.puts[1]!.delivery).toEqual(selected);
  expect(fixture.sends()).toBe(0);
});
