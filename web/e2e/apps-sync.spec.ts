import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { agentAccessFixture } from './agent-access-fixture';

test.use({ timezoneId: 'UTC' });
async function fixture(page: Page, theme = 'light') {
  const f = await agentAccessFixture(page, theme);
  await page.route('**/api/events', (route) => route.continue({ url: `${f.base}/api/events` }));
  await page.route(/\/settings\/apps\.(md|json)(?:\?|$)/, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const result = await f.app.inject({
      method: request.method() as 'GET',
      url: url.pathname + url.search,
      headers: request.headers(),
    });
    await route.fulfill({
      status: result.statusCode,
      headers: result.headers as Record<string, string>,
      body: result.body,
    });
  });
  return f;
}
async function open(page: Page) {
  await page.goto('/settings/apps?agent=1');
  await expect(page.getByRole('heading', { name: 'Apps & sync', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Generate app password', exact: true }),
  ).toBeEnabled();
}
for (const theme of ['light', 'dark'])
  test(`Apps & sync composes the settings design in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    const f = await fixture(page, theme);
    try {
      await open(page);
      await expect(page.locator('link[rel="alternate"][type="application/json"]')).toHaveAttribute(
        'href',
        '/settings/apps.json?agent=1',
      );
      await expect(
        page
          .getByRole('navigation', { name: 'Settings', exact: true })
          .getByRole('link', { name: 'Apps & sync', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      await expect(
        page.getByRole('group', { name: 'Google Reader server URL', exact: true }),
      ).toContainText('http://127.0.0.1:4401/api/greader');
      for (const name of ['Reeder Classic', 'NetNewsWire', 'Unread'])
        await expect(
          page.getByRole('region', { name: `${name} setup`, exact: true }),
        ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`apps-sync-off-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
      });
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      const geometry = await page
        .locator('img[src="/figma/agents/611cd.svg"]')
        .evaluateAll((images) =>
          images.map((image) => ({
            loaded: (image as HTMLImageElement).naturalWidth > 0,
            width: image.getBoundingClientRect().width,
            height: image.getBoundingClientRect().height,
          })),
        );
      expect(geometry).toEqual([
        { loaded: true, width: 15, height: 15 },
        { loaded: true, width: 15, height: 15 },
      ]);
    } finally {
      await page.goto('about:blank');
      await f.close();
    }
  });

test('an owner generates once, signs in a Reader app, cancels rotation, rotates and disables access with native focus', async ({
  page,
}) => {
  const f = await fixture(page);
  const prefix = '/api/greader/reader/api/0';
  const login = async (password: string) => {
    const response = await f.app.inject({
      method: 'POST',
      url: '/api/greader/accounts/ClientLogin',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ Email: 'phone-reader', Passwd: password }).toString(),
    });
    expect(response.statusCode, response.body).toBe(200);
    return `GoogleLogin auth=${/^Auth=(.+)$/m.exec(response.body)![1]}`;
  };
  try {
    await open(page);
    await page.getByRole('button', { name: 'Generate app password', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'Generate app password', exact: true });
    await expect(create.getByRole('textbox', { name: 'App username', exact: true })).toBeFocused();
    await create.getByRole('textbox', { name: 'App username', exact: true }).fill('phone-reader');
    await create.getByRole('button', { name: 'Generate app password', exact: true }).click();
    await expect(
      create.getByRole('heading', { name: 'Copy your app password now', exact: true }),
    ).toBeFocused();
    const first = (await create
      .getByLabel('New reader app password', { exact: true })
      .textContent())!.trim();
    expect(first).toMatch(/^[a-z\d_-]{32}$/i);
    const auth = await login(first);
    expect(
      (
        await f.app.inject({ url: `${prefix}/stream/items/ids`, headers: { authorization: auth } })
      ).json().itemRefs,
    ).toHaveLength(1);
    for (const format of ['md', 'json']) {
      const body = await page.evaluate(
        async (path) => (await fetch(path)).text(),
        `/settings/apps.${format}`,
      );
      expect(body).toContain('phone-reader');
      expect(body).not.toContain(first);
    }
    await create.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Rotate app password', exact: true }),
    ).toBeFocused();
    expect(await page.locator('body').textContent()).not.toContain(first);
    const status = await f.app.inject('/api/reader-access');
    expect(status.body).not.toContain(first);
    await page.getByRole('button', { name: 'Rotate app password', exact: true }).click();
    let rotate = page.getByRole('dialog', { name: 'Rotate app password', exact: true });
    await expect(rotate.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await rotate.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(
      (await f.app.inject({ url: `${prefix}/token`, headers: { authorization: auth } })).statusCode,
    ).toBe(200);
    await page.getByRole('button', { name: 'Rotate app password', exact: true }).click();
    rotate = page.getByRole('dialog', { name: 'Rotate app password', exact: true });
    await rotate.getByRole('button', { name: 'Rotate app password', exact: true }).click();
    await expect(
      rotate.getByRole('heading', { name: 'Copy your app password now', exact: true }),
    ).toBeFocused();
    const second = (await rotate
      .getByLabel('New reader app password', { exact: true })
      .textContent())!.trim();
    expect(second).not.toBe(first);
    expect(
      (await f.app.inject({ url: `${prefix}/token`, headers: { authorization: auth } })).statusCode,
    ).toBe(401);
    const nextAuth = await login(second);
    await rotate.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Disable app access', exact: true }).click();
    const disable = page.getByRole('dialog', { name: 'Disable app access?', exact: true });
    await expect(
      disable.getByRole('button', { name: 'Keep app access', exact: true }),
    ).toBeFocused();
    await disable.getByRole('button', { name: 'Keep app access', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Disable app access', exact: true }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Disable app access', exact: true }).click();
    await disable.getByRole('button', { name: 'Disable app access', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Generate app password', exact: true }),
    ).toBeFocused();
    expect(
      (await f.app.inject({ url: `${prefix}/token`, headers: { authorization: nextAuth } }))
        .statusCode,
    ).toBe(401);
    await page.reload();
    await expect(page.getByRole('status', { name: 'App access result', exact: true })).toHaveText(
      'Reader app access is off.',
    );
    const stored = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        history: history.state,
      }),
    );
    expect(stored).not.toContain(first);
    expect(stored).not.toContain(second);
    expect((await f.services.articles.get(1))?.readAt).toBeNull();
  } finally {
    await page.goto('about:blank');
    await f.close();
  }
});

test('a lost generation response keeps the draft and explains replacement before an explicit retry', async ({
  page,
}) => {
  const f = await fixture(page);
  let attempts = 0;
  await page.route('**/api/reader-access', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    attempts++;
    if (attempts !== 1) return route.fallback();
    await f.app.inject({
      method: 'POST',
      url: '/api/reader-access',
      headers: route.request().headers(),
      payload: route.request().postData()!,
    });
    await route.abort('failed');
  });
  try {
    await open(page);
    await page.getByRole('button', { name: 'Generate app password', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Generate app password', exact: true });
    await dialog.getByRole('textbox', { name: 'App username', exact: true }).fill('lost-ack');
    await dialog.getByRole('button', { name: 'Generate app password', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('The request may have completed.');
    await expect(dialog.getByRole('textbox', { name: 'App username', exact: true })).toHaveValue(
      'lost-ack',
    );
    expect(attempts).toBe(1);
    await dialog.getByRole('button', { name: 'Generate again', exact: true }).click();
    await expect(
      dialog.getByRole('heading', { name: 'Copy your app password now', exact: true }),
    ).toBeVisible();
    expect(attempts).toBe(2);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  } finally {
    await page.goto('about:blank');
    await f.close();
  }
});

test('a pending generation cannot be dismissed by Escape or submit duplicate writes', async ({
  page,
}) => {
  const f = await fixture(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route('**/api/reader-access', async (route) => {
    if (route.request().method() === 'POST') {
      calls++;
      await held;
    }
    await route.fallback();
  });
  try {
    await open(page);
    await page.getByRole('button', { name: 'Generate app password', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Generate app password', exact: true });
    await dialog.getByRole('button', { name: 'Generate app password', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Generating…', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close Generate app password', exact: true }).click();
    await expect(dialog).toBeVisible();
    expect(calls).toBe(1);
    release();
    await expect(
      dialog.getByRole('heading', { name: 'Copy your app password now', exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  } finally {
    release();
    await page.goto('about:blank');
    await f.close();
  }
});

test('status failures retry and unsupported app access stays visible without enabling mutation', async ({
  page,
}) => {
  const f = await fixture(page);
  let failed = true;
  await page.route('**/api/reader-access', async (route) => {
    if (failed && route.request().method() === 'GET')
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"Unavailable"}',
      });
    await route.fallback();
  });
  try {
    await page.goto('/settings/apps');
    await expect(page.getByRole('alert')).toContainText('Could not load app access.');
    await expect(
      page.getByRole('button', { name: 'Generate app password', exact: true }),
    ).toBeDisabled();
    failed = false;
    await page.getByRole('button', { name: 'Retry app access', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Generate app password', exact: true }),
    ).toBeEnabled();
    f.services.readerSync = undefined;
    await page.reload();
    await expect(
      page.getByText('Open a server instance of Brew to connect reader apps.'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Generate app password', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Disable app access', exact: true }),
    ).toBeDisabled();
    await page.getByRole('link', { name: 'App sync setup', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Apps & sync', exact: true })).toBeVisible();
  } finally {
    await page.goto('about:blank');
    await f.close();
  }
});

test('page suspension clears the one-time password without disabling the saved app credential', async ({
  page,
}) => {
  const f = await fixture(page);
  try {
    await open(page);
    await page.getByRole('button', { name: 'Generate app password', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Generate app password', exact: true });
    await dialog.getByRole('button', { name: 'Generate app password', exact: true }).click();
    await expect(
      dialog.getByRole('heading', { name: 'Copy your app password now', exact: true }),
    ).toBeVisible();
    const password = (await dialog
      .getByLabel('New reader app password', { exact: true })
      .textContent())!.trim();
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
    );
    expect(await page.locator('body').textContent()).not.toContain(password);
    expect((await f.app.inject('/api/reader-access')).json().enabled).toBe(true);
  } finally {
    await page.goto('about:blank');
    await f.close();
  }
});

test('Apps & sync fits phone width and URL copy failure remains recoverable', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await fixture(page);
  try {
    await open(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error('denied');
          },
        },
      });
    });
    await page.getByRole('button', { name: 'Copy Google Reader URL', exact: true }).click();
    await expect(
      page.getByRole('status', { name: 'Google Reader copy result', exact: true }),
    ).toContainText('Could not copy.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await expect(page).toHaveScreenshot('apps-sync-phone.png', {
      fullPage: true,
      animations: 'disabled',
    });
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            Object.assign(window, { copiedReaderUrl: value });
          },
        },
      });
    });
    await page.getByRole('button', { name: 'Copy Google Reader URL', exact: true }).click();
    await expect(
      page.getByRole('status', { name: 'Google Reader copy result', exact: true }),
    ).toHaveText('Google Reader URL copied.');
    expect(
      await page.evaluate(() => (window as unknown as { copiedReaderUrl: string }).copiedReaderUrl),
    ).toBe('http://127.0.0.1:4401/api/greader');
    await page.getByRole('button', { name: 'Generate app password', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Generate app password', exact: true });
    await dialog
      .getByRole('textbox', { name: 'App username', exact: true })
      .fill('phone-reader-'.repeat(9).slice(0, 100));
    await dialog.getByRole('button', { name: 'Generate app password', exact: true }).click();
    await expect(
      dialog.getByRole('heading', { name: 'Copy your app password now', exact: true }),
    ).toBeFocused();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    expect(
      await dialog
        .getByText(/^App username:/)
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath('apps-password-phone.png') });
  } finally {
    await page.goto('about:blank');
    await f.close();
  }
});
