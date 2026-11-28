import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { agentAccessFixture } from './agent-access-fixture';

test.use({ timezoneId: 'UTC' });
for (const theme of ['light', 'dark'])
  test(`Reader apps update the mounted Reader over real SSE in ${theme}`, async ({ page }) => {
    const f = await agentAccessFixture(page, theme);
    const credential = await f.services.readerSync!.access.configure({ username: 'browser' });
    // Keep the fixture database isolated while using the actual streaming socket.
    await page.route('**/api/events', (route) => route.continue({ url: `${f.base}/api/events` }));
    await page.addInitScript(() => {
      const Native = window.EventSource;
      const connections = { active: 0, maximum: 0 };
      Object.assign(window, { readerConnections: connections });
      window.EventSource = class extends Native {
        private closed = false;
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          connections.active++;
          connections.maximum = Math.max(connections.maximum, connections.active);
        }
        close() {
          if (!this.closed) {
            this.closed = true;
            connections.active--;
          }
          super.close();
        }
      };
    });
    try {
      await page.goto('/all?agent=1');
      const row = page.locator('[data-brew-kind="article"][data-brew-id="1"]').first();
      await expect(row).toHaveAttribute('data-brew-state', 'unread');
      const auth = await page.evaluate(async (credentials) => {
        const login = await fetch('/api/greader/accounts/ClientLogin', {
          method: 'POST',
          body: new URLSearchParams({ Email: credentials.username, Passwd: credentials.password }),
        });
        const token = /^Auth=(.+)$/m.exec(await login.text())![1];
        const authorization = `GoogleLogin auth=${token}`;
        const write = await fetch('/api/greader/reader/api/0/token', {
          headers: { authorization },
        });
        return { authorization, T: await write.text() };
      }, credential);
      const marked = await page.evaluate(async ({ authorization, T }) => {
        return (
          await fetch('/api/greader/reader/api/0/edit-tag', {
            method: 'POST',
            headers: { authorization },
            body: new URLSearchParams([
              ['T', T],
              ['i', '1'],
              ['a', 'user/-/state/com.google/read'],
              ['a', 'user/-/state/com.google/starred'],
            ]),
          })
        ).status;
      }, auth);
      expect(marked).toBe(200);
      await expect(row).toHaveAttribute('data-brew-state', 'read starred');
      expect((await f.services.articles.get(1))?.starredAt).not.toBeNull();
      const key = createHash('md5')
        .update(`${credential.username}:${credential.password}`)
        .digest('hex');
      const unsaved = await page.evaluate(async (apiKey) => {
        return (
          await fetch('/api/fever?api', {
            method: 'POST',
            body: new URLSearchParams({ api_key: apiKey, mark: 'item', as: 'unsaved', id: '1' }),
          })
        ).json();
      }, key);
      expect(unsaved.auth).toBe(1);
      await expect(row).toHaveAttribute('data-brew-state', 'read');
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { readerConnections: { maximum: number } }).readerConnections
              .maximum,
        ),
      ).toBe(1);
      await page
        .getByRole('navigation', { name: 'Library', exact: true })
        .getByRole('link', { name: 'Settings', exact: true })
        .click();
      await page.getByRole('link', { name: 'Agent access', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Agent access', exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { readerConnections: { active: number } }).readerConnections
              .active,
        ),
      ).toBe(1);
      await page.goto('about:blank');
    } finally {
      await f.close();
    }
  });
