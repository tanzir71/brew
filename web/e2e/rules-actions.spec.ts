import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { newslettersFixture } from './newsletters-fixture';
import { RulesService } from '../../targets/node/src/services/rules-service';

function seed(f: Awaited<ReturnType<typeof newslettersFixture>>) {
  const service = new RulesService(f.database);
  const rule = service.create({
    name: 'Saved design',
    enabled: false,
    matchType: 'all',
    scope: {},
    conditions: [{ field: 'title', operator: 'contains', value: 'Forms' }],
    actions: [{ type: 'star' }],
    stopProcessing: false,
  });
  return { service, rule };
}
test('a stale Copy is rejected, and refreshing the saved list preserves the editor draft', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const { service, rule } = seed(f);
    await page.goto(`/rules/${rule.id}`);
    const row = page.getByRole('article', { name: 'Saved design', exact: true });
    await expect(row.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
    service.update(rule.id, { ...rule, name: 'Changed in another client' });
    await page.getByLabel('Rule name', { exact: true }).fill('My unsaved draft');
    await row.getByRole('button', { name: 'Copy', exact: true }).click();
    const recovery = page.getByRole('dialog', { name: 'Copy Saved design?', exact: true });
    await expect(recovery.getByRole('alert')).toContainText('saved rule changed');
    expect(service.list()).toHaveLength(1);
    await recovery.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh rules', exact: true }).click();
    await expect(
      page.getByRole('article', { name: 'Changed in another client', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('My unsaved draft');
  } finally {
    await f.close();
  }
});
test('unsupported durable actions retain disabled Copy and setup guidance inside More', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    seed(f);
    const capabilities = (await f.app.inject('/api/capabilities')).json();
    await page.route('**/api/capabilities', (route) =>
      route.fulfill({
        json: { ...capabilities, actions: { ...capabilities.actions, undo: false } },
      }),
    );
    await page.goto('/rules');
    await expect(
      page
        .getByRole('article', { name: 'Saved design', exact: true })
        .getByRole('button', { name: 'Copy', exact: true }),
    ).toBeDisabled();
    await page
      .getByRole('button', { name: 'More actions for rule Saved design', exact: true })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Rule actions', exact: true });
    await expect(sheet.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
    await expect(
      sheet.getByRole('link', { name: 'Set up agent access', exact: true }),
    ).toHaveAttribute('href', '/settings/runs#setup-agents');
    expect((await f.app.inject('/api/actions')).json()).toEqual([]);
  } finally {
    await f.close();
  }
});
for (const theme of ['light', 'dark'] as const) {
  test(`rule More is native, keyboard accessible and visible at phone size in ${theme}`, async ({
    page,
  }, info) => {
    const f = await newslettersFixture(page, { theme });
    try {
      const { rule } = seed(f);
      await page.goto('/rules?agent=1');
      const opener = page.getByRole('button', {
        name: 'More actions for rule Saved design',
        exact: true,
      });
      const box = (await opener.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
      await opener.focus();
      await page.keyboard.press('Enter');
      const sheet = page.getByRole('dialog', { name: 'Rule actions', exact: true });
      await expect(sheet.getByRole('link', { name: 'Edit rule', exact: true })).toHaveAttribute(
        'href',
        `/rules/${rule.id}?agent=1`,
      );
      await expect(
        sheet.getByRole('link', { name: 'Execution logs', exact: true }),
      ).toHaveAttribute('href', `/rules/${rule.id}?tab=log&agent=1`);
      await expect(sheet.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
      expect(
        await sheet.evaluate(
          (dialog) => dialog instanceof HTMLDialogElement && dialog.matches(':modal'),
        ),
      ).toBe(true);
      await page.keyboard.press('Tab');
      expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`rules-more-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
      await page.setViewportSize({ width: 390, height: 844 });
      await opener.click();
      await expect(sheet).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`rules-more-phone-${theme}.png`) });
      await sheet.getByRole('button', { name: 'Delete', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: 'Delete Saved design?', exact: true });
      await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(opener).toBeFocused();
      expect((await f.app.inject('/api/actions')).json()).toEqual([]);
    } finally {
      await f.close();
    }
  });
}
test('Copy works without browser digest support, recovers once and reloads durable Undo while retaining a newer draft', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    await page.addInitScript(() =>
      Object.defineProperty(crypto, 'subtle', { configurable: true, value: undefined }),
    );
    const { service } = seed(f);
    let lost = true;
    const identities: string[] = [];
    await page.route('**/api/actions', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const payload = route.request().postDataJSON();
      identities.push(payload.requestId);
      const response = await f.app.inject({ method: 'POST', url: '/api/actions', payload });
      if (lost) {
        lost = false;
        return route.abort('failed');
      }
      return route.fulfill({ status: response.statusCode, json: response.json() });
    });
    await page.goto('/rules');
    await page
      .getByRole('button', { name: 'More actions for rule Saved design', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Rule actions' })
      .getByRole('button', { name: 'Copy', exact: true })
      .click();
    const recovery = page.getByRole('dialog', { name: 'Copy Saved design?', exact: true });
    await expect(recovery.getByRole('button', { name: 'Check result', exact: true })).toBeEnabled();
    expect(service.list()).toHaveLength(2);
    await recovery.getByRole('button', { name: 'Check result', exact: true }).click();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('Saved design copy');
    expect(identities).toHaveLength(2);
    expect(new Set(identities).size).toBe(1);
    await page.reload();
    await page.getByLabel('Rule name', { exact: true }).fill('My unsaved copy draft');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Saved design copy', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue(
      'My unsaved copy draft',
    );
    await expect(page).toHaveURL(/\/rules$/);
    expect(service.list()).toHaveLength(1);
  } finally {
    await f.close();
  }
});
test('a missing saved rule explains the unavailable editor and New opens a usable draft', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    await page.goto('/rules/999999');
    await expect(
      page.getByRole('status', { name: 'Rule editor result', exact: true }),
    ).toContainText('Rule not found');
    await expect(page.getByLabel('Rule name', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByLabel('Rule name', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('New rule');
    expect((await f.app.inject('/api/rules')).json()).toEqual([]);
  } finally {
    await f.close();
  }
});
test('late Copy and Save acknowledgements retain a newer editor draft and focus', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  const releases: Array<() => void> = [];
  try {
    seed(f);
    let release!: () => void;
    let started!: () => void;
    let reached = new Promise<void>((resolve) => {
      started = resolve;
    });
    let blocked = new Promise<void>((resolve) => {
      release = resolve;
      releases.push(resolve);
    });
    await page.route('**/api/actions', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/actions',
        payload: route.request().postDataJSON(),
      });
      started();
      await blocked;
      await route.fulfill({ status: response.statusCode, json: response.json() });
    });
    await page.goto('/rules');
    await page
      .getByRole('article', { name: 'Saved design', exact: true })
      .getByRole('button', { name: 'Copy', exact: true })
      .click();
    await reached;
    await page.getByLabel('Rule name', { exact: true }).fill('Keep this draft');
    release();
    await expect(
      page.getByRole('article', { name: 'Saved design copy', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('Keep this draft');
    await expect(page.getByLabel('Rule name', { exact: true })).toBeFocused();
    reached = new Promise<void>((resolve) => {
      started = resolve;
    });
    blocked = new Promise<void>((resolve) => {
      release = resolve;
      releases.push(resolve);
    });
    await page.route('**/api/rules', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/rules',
        payload: route.request().postDataJSON(),
      });
      started();
      await blocked;
      await route.fulfill({ status: response.statusCode, json: response.json() });
    });
    await page.getByLabel('Condition 1 value', { exact: true }).fill('Forms');
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await reached;
    await page.getByLabel('Rule name', { exact: true }).fill('Typed while saving');
    release();
    await expect(page.getByRole('button', { name: 'Save rule', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('Typed while saving');
    await expect(page.getByLabel('Rule name', { exact: true })).toBeFocused();
    await expect(page.getByRole('article', { name: 'Keep this draft', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save rule', exact: true }).click();
    await expect(
      page.getByRole('article', { name: 'Typed while saving', exact: true }),
    ).toBeVisible();
    expect((await f.app.inject('/api/rules')).json()).toHaveLength(3);
  } finally {
    releases.forEach((release) => release());
    await f.close();
  }
});
test('duplicate filter waits for acknowledgement and retries the same persisted value after a lost response', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    let writes = 0;
    await page.route('**/api/rules/duplicate-filter', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      writes++;
      const response = await f.app.inject({
        method: 'PUT',
        url: '/api/rules/duplicate-filter',
        payload: route.request().postDataJSON(),
      });
      if (writes === 1) {
        await blocked;
        return route.abort('failed');
      }
      await route.fulfill({ status: response.statusCode, json: response.json() });
    });
    await page.goto('/rules');
    const filter = page.getByLabel('Hide near-duplicate titles (3 days)', { exact: true });
    await expect(filter).toBeEnabled();
    await filter.click();
    await expect(filter).not.toBeChecked();
    await expect(filter).toBeDisabled();
    await expect(
      page.getByRole('status', { name: 'Duplicate filter result', exact: true }),
    ).toHaveText('Saving duplicate filter…');
    release();
    await page.getByRole('button', { name: 'Retry duplicate filter save', exact: true }).click();
    await expect(filter).toBeChecked();
    await expect(filter).toBeEnabled();
    expect((await f.app.inject('/api/rules/duplicate-filter')).json()).toEqual({ enabled: true });
    expect(writes).toBe(2);
    await page.reload();
    await expect(filter).toBeChecked();
  } finally {
    release();
    await f.close();
  }
});
test('failed rules, filter, preview and logs reads show retry instead of false empty claims', async ({
  page,
}) => {
  const f = await newslettersFixture(page);
  try {
    const { rule } = seed(f);
    let failing = true;
    await page.route('**/api/rules', (route) =>
      failing ? route.fulfill({ status: 503, json: { error: 'Offline rules' } }) : route.fallback(),
    );
    await page.route('**/api/rules/duplicate-filter', (route) =>
      failing
        ? route.fulfill({ status: 503, json: { error: 'Offline setting' } })
        : route.fallback(),
    );
    await page.route('**/api/rules/preview', (route) =>
      failing
        ? route.fulfill({ status: 503, json: { error: 'Offline preview' } })
        : route.fallback(),
    );
    await page.route(`**/api/rules/${rule.id}/logs`, (route) =>
      failing ? route.fulfill({ status: 503, json: { error: 'Offline logs' } }) : route.fallback(),
    );
    await page.goto(`/rules/${rule.id}?tab=log`);
    await expect(page.getByText('No rules yet.', { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Preview unavailable', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('No matches yet.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('No executions yet.', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry executions', exact: true })).toBeVisible();
    failing = false;
    await page.getByRole('button', { name: 'Retry rules', exact: true }).click();
    await expect(page.getByLabel('Rule name', { exact: true })).toHaveValue('Saved design');
    await page.getByRole('button', { name: 'Retry duplicate filter read', exact: true }).click();
    await expect(
      page.getByLabel('Hide near-duplicate titles (3 days)', { exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Retry executions', exact: true }).click();
    await expect(page.getByText('No executions yet.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Would match 1', exact: true })).toBeVisible();
  } finally {
    await f.close();
  }
});
for (const outcome of ['granted', 'denied', 'default', 'failure', 'unsupported'] as const) {
  test(`notification permission reports ${outcome} without silent failures`, async ({ page }) => {
    const f = await newslettersFixture(page);
    try {
      await page.addInitScript((outcome) => {
        Object.defineProperty(window, 'Notification', {
          configurable: true,
          value:
            outcome === 'unsupported'
              ? undefined
              : {
                  permission: 'default',
                  requestPermission: async () => {
                    if (outcome === 'failure') throw new Error('Permission failed');
                    return outcome;
                  },
                },
        });
      }, outcome);
      await page.goto('/rules');
      const status = page.getByRole('status', { name: 'Notification permission', exact: true });
      if (outcome === 'unsupported') {
        await expect(
          page.getByRole('button', { name: 'Notifications unavailable', exact: true }),
        ).toBeDisabled();
        await expect(status).toContainText('does not support');
      } else {
        await page.getByRole('button', { name: 'Enable notifications', exact: true }).click();
        await expect(status).toContainText(
          outcome === 'granted'
            ? 'Notifications enabled.'
            : outcome === 'denied'
              ? 'blocked'
              : outcome === 'default'
                ? 'not granted'
                : 'Could not request',
        );
        if (outcome === 'denied')
          await expect(
            page.getByRole('button', { name: 'Notifications blocked', exact: true }),
          ).toBeDisabled();
      }
    } finally {
      await f.close();
    }
  });
}
