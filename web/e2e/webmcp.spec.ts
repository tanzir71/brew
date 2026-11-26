import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { AgentToolResult } from '../../packages/core/src/agent-tools';
import { agentAccessFixture } from './agent-access-fixture';

type ToolWindow = Window & { brewToolResult?: AgentToolResult; brewToolCancel?: AbortController };
async function names(page: Page) {
  return page.evaluate(async () =>
    (document.modelContext ??
    (navigator as Navigator & { modelContext?: typeof document.modelContext }).modelContext)
      ? (
          await (document.modelContext ??
            (navigator as Navigator & { modelContext?: typeof document.modelContext })
              .modelContext)!.getTools()
        )
          .map((tool) => tool.name)
          .sort()
      : [],
  );
}
async function invoke(page: Page, name: string, input: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ name, input }) => {
      const context = (document.modelContext ??
        (navigator as Navigator & { modelContext?: typeof document.modelContext }).modelContext)!;
      const tool = (await context.getTools()).find((tool) => tool.name === name);
      if (!tool) throw new Error(`Missing tool ${name}`);
      return JSON.parse(await context.executeTool(tool, input)) as AgentToolResult;
    },
    { name, input },
  );
}
async function start(page: Page, name: string, input: Record<string, unknown>) {
  await page.evaluate(
    ({ name, input }) => {
      const state = window as ToolWindow;
      state.brewToolResult = undefined;
      state.brewToolCancel = new AbortController();
      void (async () => {
        const context = (document.modelContext ??
          (navigator as Navigator & { modelContext?: typeof document.modelContext }).modelContext)!;
        const tool = (await context.getTools()).find((tool) => tool.name === name);
        if (!tool) throw new Error(`Missing tool ${name}`);
        return JSON.parse(
          await context.executeTool(tool, input, { signal: state.brewToolCancel!.signal }),
        ) as AgentToolResult;
      })()
        .then((value) => {
          state.brewToolResult = value;
        })
        .catch(() => {
          state.brewToolResult = { isError: true, content: [{ type: 'text', text: 'Cancelled.' }] };
        });
    },
    { name, input },
  );
}
async function result(page: Page) {
  await expect
    .poll(() => page.evaluate(() => Boolean((window as ToolWindow).brewToolResult)))
    .toBe(true);
  return page.evaluate(() => (window as ToolWindow).brewToolResult!);
}
async function enabled(page: Page) {
  await page.addInitScript(() => localStorage.setItem('brew:webmcp', 'true'));
  return agentAccessFixture(page, 'light', false, true);
}

test('reports a failed acknowledgement, retries the same reviewed request and retains native Undo focus', async ({
  page,
}) => {
  const f = await enabled(page);
  let failed = false;
  await page.route('**/api/webmcp/call', async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({ status: 503, json: { error: 'Private transport detail.' } });
    } else await route.fallback();
  });
  try {
    await page.goto('/all?agent=1');
    const open = page.getByRole('button', { name: 'Open article · Agent test story', exact: true });
    const args = { id: 1, confirm: true, request_id: 'web-retry-star-001' };
    await open.click();
    await expect.poll(() => names(page)).toContain('star');
    await start(page, 'star', args);
    await page
      .getByRole('dialog', { name: 'Change starred state?', exact: true })
      .getByRole('button', { name: 'Confirm change', exact: true })
      .click();
    const failure = await result(page);
    expect(failure.isError).toBe(true);
    expect(failure.content[0]!.text).toContain('same request_id');
    expect(f.database.sqlite.prepare('SELECT starred_at FROM articles').get()).toEqual({
      starred_at: null,
    });
    await page.getByRole('button', { name: 'Close article', exact: true }).click();
    const feedback = page.getByRole('region', { name: 'In-page agent result', exact: true });
    await expect(feedback).toContainText('Could not confirm the tool’s result.');
    await expect(feedback).not.toContainText('Private transport detail');
    await open.click();
    await expect.poll(() => names(page)).toContain('star');
    await start(page, 'star', args);
    await page
      .getByRole('dialog', { name: 'Change starred state?', exact: true })
      .getByRole('button', { name: 'Confirm change', exact: true })
      .click();
    expect((await result(page)).isError).not.toBe(true);
    expect(f.database.sqlite.prepare('SELECT starred_at FROM articles').get()).not.toEqual({
      starred_at: null,
    });
    await page.getByRole('button', { name: 'Close article', exact: true }).click();
    await page.getByRole('button', { name: 'Undo agent change', exact: true }).click();
    await expect(feedback).toBeFocused();
    expect(f.database.sqlite.prepare('SELECT starred_at FROM articles').get()).toEqual({
      starred_at: null,
    });
    await feedback.getByRole('button', { name: 'Dismiss agent result', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All articles', exact: true })).toBeFocused();
  } finally {
    await f.close();
  }
});

test('requires the instance flag and a saved opt-in; loads no polyfill or catalog while off', async ({
  page,
}) => {
  const f = await agentAccessFixture(page, 'light', false, true);
  const loads: string[] = [];
  page.on('request', (request) => {
    if (/w3c.*polyfill|api\/webmcp\//.test(request.url())) loads.push(request.url());
  });
  try {
    await page.goto('/settings/agents');
    const toggle = page.getByRole('switch', { name: 'In-page tools (WebMCP)', exact: true });
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeEnabled();
    expect(await page.evaluate(() => Boolean(document.modelContext))).toBe(false);
    expect(loads).toEqual([]);
    await toggle.click();
    await expect.poll(() => names(page)).toEqual(['list_brews', 'search_items']);
    expect((await invoke(page, 'list_brews')).structuredContent?.items).toHaveLength(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => names(page)).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect.poll(() => names(page)).toEqual(['list_brews', 'search_items']);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect(names(page)).rejects.toThrow('disallowed by permissions policy');
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
    );
    await expect.poll(() => names(page)).toEqual(['list_brews', 'search_items']);
    await toggle.click();
    await expect.poll(() => names(page)).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('brew:webmcp'))).toBe('false');
    const audit = await new AxeBuilder({ page }).analyze();
    expect(
      audit.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
    ).toEqual([]);
  } finally {
    await f.close();
  }
});

for (const theme of ['light', 'dark'])
  test(`enabled WebMCP card preserves Figma geometry in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(() => localStorage.setItem('brew:webmcp', 'true'));
    const f = await agentAccessFixture(page, theme, false, true);
    try {
      await page.goto('/settings/agents');
      await expect.poll(() => names(page)).toEqual(['list_brews', 'search_items']);
      await page.evaluate(() => document.fonts.ready);
      await expect(
        page.getByRole('region', { name: 'In-page tools (WebMCP)', exact: true }),
      ).toHaveScreenshot(`webmcp-enabled-${theme}.png`, { animations: 'disabled' });
      const audit = await new AxeBuilder({ page }).analyze();
      expect(
        audit.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
      ).toEqual([]);
    } finally {
      await f.close();
    }
  });

test('the real polyfill scopes tools to mounted Reader/article controls, confirms writes and performs actual Undo', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await enabled(page);
  try {
    await page.goto('/all?agent=1');
    await expect.poll(() => names(page)).toContain('list_unread');
    await expect.poll(() => names(page)).toContain('get_item');
    expect((await invoke(page, 'get_item', { id: 1 })).structuredContent?.markdown).toContain(
      'Body.',
    );
    expect(f.database.sqlite.prepare('SELECT read_at FROM articles').get()).toEqual({
      read_at: null,
    });
    const preview = await invoke(page, 'mark_read');
    expect(preview.isError).not.toBe(true);
    const args = {
      revision: preview.structuredContent!.revision,
      confirm: true,
      request_id: 'web-browser-read-001',
    };
    await start(page, 'mark_read', args);
    const review = page.getByRole('dialog', { name: 'Mark articles read?', exact: true });
    await expect(review).toBeVisible();
    expect(f.database.sqlite.prepare('SELECT read_at FROM articles').get()).toEqual({
      read_at: null,
    });
    await expect.poll(() => names(page)).toEqual([]);
    await review.getByRole('button', { name: 'Cancel action' }).click();
    expect((await result(page)).isError).toBe(true);
    await expect.poll(() => names(page)).toContain('mark_read');
    await start(page, 'mark_read', args);
    await expect(review.getByText('This scope currently contains 1 unread article.')).toBeVisible();
    await review.getByRole('button', { name: 'Mark 1 read' }).click();
    expect((await result(page)).isError).not.toBe(true);
    expect(f.database.sqlite.prepare('SELECT read_at FROM articles').get()).not.toEqual({
      read_at: null,
    });
    await page
      .getByRole('button', { name: 'Open article · Agent test story', exact: true })
      .click();
    await expect.poll(() => names(page)).toContain('get_item');
    expect(await names(page)).not.toContain('list_unread');
    expect((await invoke(page, 'get_item', { id: 1 })).structuredContent?.markdown).toContain(
      'Body.',
    );
    expect((await invoke(page, 'get_item', { id: 999 })).isError).toBe(true);
    await start(page, 'tag', {
      id: 1,
      add: ['Browser tag'],
      confirm: true,
      request_id: 'web-browser-tag-001',
    });
    await page
      .getByRole('dialog', { name: 'Change article tags?', exact: true })
      .getByRole('button', { name: 'Confirm change' })
      .click();
    const tagged = await result(page);
    expect(tagged.isError).not.toBe(true);
    expect(f.database.sqlite.prepare('SELECT name FROM tags').get()).toEqual({
      name: 'Browser tag',
    });
    await page.getByRole('button', { name: 'Close article', exact: true }).click();
    await expect.poll(() => names(page)).toContain('get_item');
    await expect.poll(() => names(page)).toContain('undo');
    await start(page, 'undo', { undo_id: tagged.structuredContent!.undo_id, confirm: true });
    await page
      .getByRole('dialog', { name: 'Undo this change?', exact: true })
      .getByRole('button', { name: 'Confirm change' })
      .click();
    expect((await result(page)).isError).not.toBe(true);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM tags').get()).toEqual({ n: 0 });
    expect(
      f.services
        .agentAccess!.activity()
        .items.some((entry) => entry.agent === 'WebMCP' && entry.receipt?.status === 'undone'),
    ).toBe(true);
  } finally {
    await f.close();
  }
});

test('cancellation and unmounting a reviewed control cannot issue a later write', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await enabled(page);
  try {
    await page.goto('/all?agent=1');
    await page
      .getByRole('button', { name: 'Open article · Agent test story', exact: true })
      .click();
    await expect.poll(() => names(page)).toContain('star');
    await start(page, 'star', { id: 1, confirm: true, request_id: 'web-cancel-star-001' });
    await expect(
      page.getByRole('dialog', { name: 'Change starred state?', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel action', exact: true })).toBeFocused();
    await testInfo.attach('webmcp-review-phone', {
      path: await page
        .screenshot({ path: testInfo.outputPath('webmcp-review-phone.png') })
        .then(() => testInfo.outputPath('webmcp-review-phone.png')),
      contentType: 'image/png',
    });
    const dialog = page.getByRole('dialog', { name: 'Change starred state?', exact: true });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const audit = await new AxeBuilder({ page }).analyze();
    expect(
      audit.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')),
    ).toEqual([]);
    await page.evaluate(() => (window as ToolWindow).brewToolCancel!.abort());
    expect((await result(page)).isError).toBe(true);
    await expect(
      page.getByRole('dialog', { name: 'Change starred state?', exact: true }),
    ).toHaveCount(0);
    await expect.poll(() => names(page)).toContain('star');
    await start(page, 'star', { id: 1, confirm: true, request_id: 'web-cancel-star-002' });
    await expect(
      page.getByRole('dialog', { name: 'Change starred state?', exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      history.pushState(null, '', '/feeds?agent=1');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(
      page.getByRole('dialog', { name: 'Change starred state?', exact: true }),
    ).toHaveCount(0);
    expect((await result(page)).isError).toBe(true);
    expect(f.database.sqlite.prepare('SELECT starred_at FROM articles').get()).toEqual({
      starred_at: null,
    });
    expect(await names(page)).not.toContain('star');
  } finally {
    await f.close();
  }
});

test('Brew, draft-rule and discovered-feed tools use the same catalog and mounted inputs', async ({
  page,
}) => {
  const f = await enabled(page);
  try {
    const earlier = await f.services.brews.generateComposition(1);
    const latest = await f.services.brews.generateComposition(1);
    await page.goto(`/b/1/${earlier.id}`);
    await expect.poll(() => names(page)).toContain('preview_brew');
    expect((await invoke(page, 'preview_brew', { id: 1 })).isError).not.toBe(true);
    await expect.poll(() => names(page)).toContain('get_brew');
    const saved = await invoke(page, 'get_brew', { id: 1 });
    expect((saved.structuredContent?.issue as { id: number }).id).toBe(earlier.id);
    expect((await invoke(page, 'get_brew', { id: 1, issue_id: latest.id })).isError).toBe(true);
    await page.goto('/rules?agent=1');
    await page.getByRole('textbox', { name: 'Rule name', exact: true }).fill('Browser rule');
    await page.getByRole('textbox', { name: 'Condition 1 value', exact: true }).fill('Browser');
    await expect.poll(() => names(page)).toContain('create_rule');
    const preview = await invoke(page, 'create_rule');
    expect(preview.isError).not.toBe(true);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM rules').get()).toEqual({ n: 0 });
    await start(page, 'create_rule', {
      dry_run: false,
      confirm: true,
      request_id: 'web-browser-rule-001',
    });
    await page
      .getByRole('dialog', { name: 'Save this rule?', exact: true })
      .getByRole('button', { name: 'Confirm change' })
      .click();
    expect((await result(page)).isError).not.toBe(true);
    expect(f.database.sqlite.prepare('SELECT name FROM rules').get()).toEqual({
      name: 'Browser rule',
    });
    await page.goto('/feeds?agent=1');
    expect(await names(page)).not.toContain('create_rule');
    await page
      .getByRole('textbox', { name: 'Feed or website URL', exact: true })
      .fill('https://candidate.test/rss');
    await page.getByRole('button', { name: 'Find feed', exact: true }).click();
    await expect.poll(() => names(page)).toContain('add_feed');
    await start(page, 'add_feed', {
      url: 'https://candidate.test/rss',
      confirm: true,
      request_id: 'web-browser-feed-001',
    });
    await page
      .getByRole('dialog', { name: 'Subscribe to this feed?', exact: true })
      .getByRole('button', { name: 'Confirm change' })
      .click();
    expect((await result(page)).isError).not.toBe(true);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM feeds').get()).toEqual({ n: 2 });
    await expect(page.getByRole('article', { name: 'Low Tide', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Undo agent change', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Low Tide', exact: true })).toHaveCount(0);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM feeds').get()).toEqual({ n: 1 });
  } finally {
    await f.close();
  }
});

test('a saved opt-in never bypasses an unavailable instance flag', async ({ page }) => {
  const f = await agentAccessFixture(page);
  try {
    await page.addInitScript(() => localStorage.setItem('brew:webmcp', 'true'));
    await page.goto('/settings/agents');
    await expect(
      page.getByRole('switch', { name: 'In-page tools (WebMCP)', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('switch', { name: 'In-page tools (WebMCP)', exact: true }),
    ).not.toBeChecked();
    expect(await page.evaluate(() => Boolean(document.modelContext))).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('brew:webmcp'))).toBe('true');
  } finally {
    await f.close();
  }
});

for (const surface of ['document', 'navigator'] as const)
  test(`prefers native ${surface} tools, cleans legacy registrations and preserves unrelated tools`, async ({
    page,
  }) => {
    await page.addInitScript((surface) => {
      type NativeTool = {
        name: string;
        execute: (input: unknown, options: { signal: AbortSignal }) => unknown;
      };
      const registered = new Map<string, NativeTool>();
      registered.set('outside_tool', { name: 'outside_tool', execute: () => ({ ok: true }) });
      const state = {
        navigatorReads: 0,
        removed: [] as string[],
        old: undefined as NativeTool | undefined,
      };
      const native = {
        registerTool(tool: NativeTool) {
          if (registered.has(tool.name)) throw new Error('Duplicate');
          registered.set(tool.name, tool);
          if (tool.name === 'search_items') state.old = tool;
        },
        unregisterTool(name: string) {
          registered.delete(name);
          state.removed.push(name);
        },
        async getTools() {
          return [...registered.values()];
        },
        async executeTool(tool: NativeTool, input: unknown = {}) {
          if (!registered.has(tool.name)) throw new Error('Missing');
          return JSON.stringify(
            await tool.execute(input, { signal: new AbortController().signal }),
          );
        },
      };
      Object.defineProperty(document, 'modelContext', {
        configurable: true,
        value: surface === 'document' ? native : undefined,
      });
      Object.defineProperty(navigator, 'modelContext', {
        configurable: true,
        get() {
          state.navigatorReads++;
          return surface === 'navigator'
            ? native
            : {
                registerTool() {
                  throw new Error('Navigator must not replace document context');
                },
              };
        },
      });
      Object.assign(window, { brewNativeState: state, brewNativeContext: native });
    }, surface);
    const f = await enabled(page);
    const polyfills: string[] = [];
    page.on('request', (request) => {
      if (/w3c.*polyfill/.test(request.url())) polyfills.push(request.url());
    });
    try {
      await page.goto('/settings/agents');
      await expect.poll(() => names(page)).toEqual(['list_brews', 'outside_tool', 'search_items']);
      expect((await invoke(page, 'search_items', { query: 'Browser' })).isError).not.toBe(true);
      if (surface === 'document')
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { brewNativeState: { navigatorReads: number } }).brewNativeState
                .navigatorReads,
          ),
        ).toBe(0);
      const before = f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get();
      await page.getByRole('switch', { name: 'In-page tools (WebMCP)', exact: true }).click();
      await expect.poll(() => names(page)).toEqual(['outside_tool']);
      const stale = await page.evaluate(async () =>
        (
          window as unknown as {
            brewNativeState: { old: { execute: (value: unknown) => Promise<AgentToolResult> } };
          }
        ).brewNativeState.old.execute({ query: 'Do not run this stale call' }),
      );
      expect(stale.isError).toBe(true);
      expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual(
        before,
      );
      expect(polyfills).toEqual([]);
    } finally {
      await f.close();
    }
  });

test('registration refusal is visible, rolls back only owned tools and can be retried', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const registered = new Map<string, { name: string }>();
    let fail = true;
    registered.set('outside_tool', { name: 'outside_tool' });
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool(tool: { name: string }, options: { signal: AbortSignal }) {
          if (tool.name === 'list_brews' && fail) {
            fail = false;
            throw new Error('Policy refusal');
          }
          registered.set(tool.name, tool);
          options.signal.addEventListener('abort', () => registered.delete(tool.name), {
            once: true,
          });
          return Promise.resolve();
        },
        async getTools() {
          return [...registered.values()];
        },
      },
    });
  });
  const f = await enabled(page);
  try {
    await page.goto('/settings/agents');
    const retry = page.getByRole('button', { name: 'Retry in-page tools', exact: true });
    await expect(retry).toBeVisible();
    expect(await names(page)).toEqual(['outside_tool']);
    await retry.click();
    await expect.poll(() => names(page)).toEqual(['list_brews', 'outside_tool', 'search_items']);
  } finally {
    await f.close();
  }
});
