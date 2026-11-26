import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { agentAccessFixture } from './agent-access-fixture';

test.use({ timezoneId: 'UTC' });
for (const theme of ['light', 'dark'])
  test(`Agent access matches Figma in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const f = await agentAccessFixture(page, theme, true);
    try {
      await page.goto('/settings/agents');
      await expect(page.getByRole('heading', { name: 'Agent access', exact: true })).toBeVisible();
      await expect(page.getByRole('rowheader', { name: 'Claude (desktop)' })).toBeVisible();
      await expect(
        page.getByRole('list', { name: 'Recent agent actions' }).getByRole('listitem'),
      ).toHaveCount(4);
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`agent-access-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
      });
      const assets = await page.locator('img[src^="/figma/agents/"]').evaluateAll((images) =>
        images.map((image) => {
          const img = image as HTMLImageElement,
            r = img.getBoundingClientRect();
          return {
            src: img.getAttribute('src'),
            loaded: img.complete && img.naturalWidth > 0,
            width: r.width,
            height: r.height,
          };
        }),
      );
      expect(assets.length).toBeGreaterThan(4);
      for (const asset of assets) {
        expect(asset.loaded).toBe(true);
        const size = asset.src?.includes('611cd')
          ? 15
          : asset.src?.includes('342e1') || asset.src?.includes('1d102')
            ? 16
            : 14;
        expect(asset.width).toBe(size);
        expect(asset.height).toBe(size);
      }
      const audit = await new AxeBuilder({ page }).analyze();
      expect(
        audit.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
      ).toEqual([]);
    } finally {
      await f.close();
    }
  });

test('Agent access stays usable at phone width with native table scrolling and setup tabs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await agentAccessFixture(page, 'light', true);
  try {
    await page.goto('/settings/agents');
    await expect(page.getByRole('rowheader', { name: 'Claude (desktop)' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main *'))
        .filter((el) => el.getBoundingClientRect().right > innerWidth)
        .map((el) => ({
          tag: el.tagName,
          class: el.className,
          right: el.getBoundingClientRect().right,
        })),
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      JSON.stringify(overflow),
    ).toBe(true);
    await expect(page).toHaveScreenshot('agent-access-phone.png', {
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('radio', { name: 'Codex', exact: true }).click();
    await expect(page.getByLabel('Codex MCP setup')).toContainText('bearer_token_env_var');
    await page.getByRole('radio', { name: 'ChatGPT', exact: true }).click();
    await expect(page.getByText('Needs OAuth', { exact: true })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'In-page tools (WebMCP)' })).toBeDisabled();
    const audit = await new AxeBuilder({ page }).analyze();
    expect(
      audit.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
    ).toEqual([]);
  } finally {
    await f.close();
  }
});

test('creates scoped secrets once, uses real MCP writes, restores through the owner log and revokes access', async ({
  page,
}) => {
  const f = await agentAccessFixture(page);
  const client = new Client({ name: 'settings-e2e', version: '1' });
  try {
    await page.goto('/settings/runs');
    await page.getByRole('link', { name: 'Agent access', exact: true }).click();
    const create = page.getByRole('button', { name: 'New token', exact: true });
    await create.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'New token', exact: true });
    await expect(dialog.getByLabel('Access', { exact: true })).toHaveValue('read');
    await expect(dialog.getByLabel('Expires in')).toHaveValue('30');
    await dialog.getByLabel('Token name').fill('Codex test');
    await dialog.getByLabel('Access', { exact: true }).selectOption('write');
    await dialog.getByRole('button', { name: 'Create token' }).click();
    const secret = (await dialog.getByLabel('New agent token').textContent())!;
    expect(secret).toMatch(/^brew_rw_[\w-]{43}$/);
    await expect(dialog.getByRole('heading', { name: 'Copy your token now' })).toBeFocused();
    expect(
      await page.evaluate(() =>
        JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
      ),
    ).not.toContain(secret);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(create).toBeFocused();
    await expect(page.getByLabel('New agent token')).toHaveCount(0);
    await expect(page.getByRole('rowheader', { name: 'Codex test' })).toBeVisible();
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', f.base), {
        requestInit: { headers: { Authorization: `Bearer ${secret}` } },
      }),
    );
    const target = { kind: 'items', ids: [1] };
    const review = await client.callTool({ name: 'mark_read', arguments: { target } });
    const written = await client.callTool({
      name: 'mark_read',
      arguments: {
        target,
        revision: review.structuredContent!.revision,
        confirm: true,
        request_id: 'browser-agent-read-001',
      },
    });
    expect(written.isError).not.toBe(true);
    const undo = page.getByRole('button', {
      name: `Undo action ${written.structuredContent!.undo_id}`,
      exact: true,
    });
    await expect(undo).toBeVisible();
    await undo.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => f.database.sqlite.prepare('SELECT read_at FROM articles WHERE id=1').get())
      .toEqual({ read_at: null });
    await expect(page.getByRole('status').filter({ hasText: 'Action undone.' })).toBeFocused();
    const revoke = page.getByRole('button', { name: 'Revoke Codex test', exact: true });
    await revoke.click();
    await page
      .getByRole('dialog', { name: 'Revoke token', exact: true })
      .getByRole('button', { name: 'Keep token' })
      .click();
    await expect(revoke).toBeFocused();
    await revoke.click();
    await page
      .getByRole('dialog', { name: 'Revoke token', exact: true })
      .getByRole('button', { name: 'Revoke token', exact: true })
      .click();
    await expect(page.getByRole('rowheader', { name: 'Codex test' })).toHaveCount(0);
    await expect(create).toBeFocused();
    await expect(client.callTool({ name: 'list_brews', arguments: {} })).rejects.toThrow();
  } finally {
    await client.close();
    await f.close();
  }
});

test('retries token failures without losing the draft and pages the complete private action log', async ({
  page,
}) => {
  const f = await agentAccessFixture(page, 'light', true);
  try {
    const connection = f.services.agentAccess!.authenticate(
      `Bearer ${f.services.agentAccess!.create({ name: 'History' }).token}`,
    )!;
    for (let n = 0; n < 22; n++) f.services.agentAccess!.record(connection, 'get_item', 'complete');
    await page.goto('/settings/agents');
    let fail = true;
    await page.route('**/api/agent-access/tokens', async (route) => {
      if (route.request().method() === 'POST' && fail) {
        fail = false;
        await route.fulfill({ status: 503, json: { error: 'Try creating this token again.' } });
      } else await route.fallback();
    });
    await page.getByRole('button', { name: 'New token', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New token', exact: true });
    await dialog.getByLabel('Token name').fill('Retry token');
    await dialog.getByRole('button', { name: 'Create token' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Try creating this token again.');
    await expect(dialog.getByLabel('Token name')).toHaveValue('Retry token');
    await dialog.getByRole('button', { name: 'Create token' }).click();
    await expect(dialog.getByRole('heading', { name: 'Copy your token now' })).toBeVisible();
    await page.keyboard.press('Escape');
    const full = page.getByRole('button', { name: 'Full log' });
    await full.click();
    const log = page.getByRole('dialog', { name: 'Agent action log' });
    await expect(log.getByRole('listitem')).toHaveCount(20);
    await log.getByRole('button', { name: 'Older actions' }).click();
    await expect(log.getByRole('listitem')).toHaveCount(6);
    await expect(log.getByRole('button', { name: 'Older actions' })).toBeDisabled();
    await log.getByRole('button', { name: 'Newer actions' }).click();
    await expect(log.getByRole('listitem')).toHaveCount(20);
    await page.keyboard.press('Escape');
    await expect(full).toBeFocused();
  } finally {
    await f.close();
  }
});

test('keeps unavailable access visible and leaves browser-only agent preferences usable', async ({
  page,
}) => {
  const f = await agentAccessFixture(page);
  try {
    await page.route('**/api/capabilities', async (route) =>
      route.fulfill({
        json: { ...(await f.services.capabilities()), agentAccess: false, mcp: null },
      }),
    );
    await page.goto('/settings/agents');
    await expect(page.getByRole('button', { name: 'New token', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Full log' })).toBeDisabled();
    await expect(
      page.getByRole('link', { name: 'Set up agent access', exact: true }),
    ).toBeVisible();
    await page.getByRole('switch', { name: 'Agent-friendly mode', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Agent preferences result' })).toContainText(
      'saved in this browser',
    );
    await expect(
      page.getByRole('switch', { name: 'Agent-friendly mode', exact: true }),
    ).toBeChecked();
  } finally {
    await f.close();
  }
});

test('settings navigation preserves a temporary agent-mode opt-in', async ({ page }) => {
  const f = await agentAccessFixture(page);
  try {
    await page.goto('/settings/agents?agent=1');
    await page
      .getByRole('navigation', { name: 'Settings', exact: true })
      .getByRole('link', { name: 'General', exact: true })
      .click();
    await expect(page).toHaveURL('/settings/runs?agent=1#preferences-general');
    await page
      .getByRole('dialog', { name: 'General settings', exact: true })
      .getByRole('button', { name: 'Done', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Settings', exact: true })
      .getByRole('link', { name: 'Agent access', exact: true })
      .click();
    await expect(page).toHaveURL('/settings/agents?agent=1');
    await expect(
      page.getByRole('status').filter({ hasText: 'This URL enables agent-friendly mode' }),
    ).toBeVisible();
  } finally {
    await f.close();
  }
});
