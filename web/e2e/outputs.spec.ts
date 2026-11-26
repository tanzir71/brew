import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { newslettersFixture } from './newsletters-fixture';
import { newBrewSection } from '../../packages/core/src/composition-model';
import { isBrewOutputPath } from '../../packages/core/src/brew-output-paths';
import { nodeCapabilities } from '../../targets/node/src/capabilities';

const active: Array<Awaited<ReturnType<typeof setup>>> = [];
test.afterEach(async () => {
  for (const fixture of active.splice(0)) await fixture.close();
});
async function setup(page: Page, feed = true) {
  const f = await newslettersFixture(page);
  const first = f.brews.composition(f.morning.id)!;
  f.brews.updateComposition(first.id, {
    ...first,
    delivery: { ...first.delivery, feed },
    sections: [
      {
        ...newBrewSection('note', 'note'),
        title: 'A frozen note',
        note: 'Read **slowly**, with [context](https://example.test/context).',
      },
    ],
  });
  await f.brews.generateComposition(f.weekend.id);
  const older = await f.brews.generateComposition(first.id);
  await f.brews.generateComposition(f.weekend.id);
  const latest = await f.brews.generateComposition(first.id);
  await page.context().route('**/b/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!isBrewOutputPath(url.pathname)) return route.fallback();
    const response = await f.app.inject({
      method: 'GET',
      url: url.pathname + url.search,
      headers: { host: url.host },
    });
    await route.fulfill({
      status: response.statusCode,
      body: response.rawPayload,
      headers: Object.fromEntries(
        Object.entries(response.headers)
          .filter(([name]) => !['content-length', 'connection', 'transfer-encoding'].includes(name))
          .map(([name, value]) => [name, String(value)]),
      ),
    });
  });
  const result = { ...f, first, older, latest };
  active.push(result);
  return result;
}

test('keyboard format links and discovery identify the selected frozen issue, and feeds link back to it', async ({
  page,
}) => {
  const f = await setup(page);
  const frozen = f.database.sqlite.prepare('SELECT id,payload_json FROM brews ORDER BY id').all();
  await page.goto(`/b/${f.first.id}/${f.older.id}`);
  await expect(page.getByText('Wednesday 25 November · No. 1', { exact: false })).toBeVisible();
  const formats = page.locator('.brew-format-links');
  for (const [label, suffix] of [
    ['Markdown', '.md'],
    ['JSON', '.json'],
  ] as const)
    await expect(formats.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'href',
      `/b/${f.first.id}/${f.older.id}${suffix}`,
    );
  await expect(formats.getByRole('link', { name: 'Atom feed', exact: true })).toHaveAttribute(
    'href',
    `/b/${f.first.id}.atom`,
  );
  await expect(page.locator('head link[rel="alternate"][type="text/markdown"]')).toHaveAttribute(
    'href',
    `/b/${f.first.id}/${f.older.id}.md`,
  );
  await expect(
    page.locator('head link[rel="alternate"][type="application/feed+json"]'),
  ).toHaveAttribute('href', `/b/${f.first.id}.json`);
  const twins = await page.evaluate(async () => {
    const links = [...document.querySelectorAll<HTMLLinkElement>('head link[rel="alternate"]')];
    return Promise.all(
      links.map(async (link) => {
        const response = await fetch(link.href);
        return { type: link.type, status: response.status, body: await response.text() };
      }),
    );
  });
  expect(twins.every((twin) => twin.status === 200)).toBe(true);
  expect(twins.find((twin) => twin.type === 'text/markdown')!.body).toContain('Read **slowly**');
  const feed = JSON.parse(twins.find((twin) => twin.type === 'application/feed+json')!.body);
  expect(feed.items.map((item: { url: string }) => item.url)).toEqual(
    [f.latest, f.older].map((issue) => `http://127.0.0.1:4401/b/${f.first.id}/${issue.id}`),
  );
  expect(
    (await new AxeBuilder({ page }).include('.brew-format-links').analyze()).violations.filter(
      (v) => ['serious', 'critical'].includes(v.impact ?? ''),
    ),
  ).toEqual([]);
  const jsonLink = formats.getByRole('link', { name: 'JSON', exact: true });
  await jsonLink.focus();
  const response = page.waitForResponse((response) =>
    response.url().endsWith(`/${f.older.id}.json`),
  );
  await page.keyboard.press('Enter');
  expect((await response).headers()['content-type']).toContain('application/json');
  expect((await (await response).json()).id).toBe(f.older.id);
  await expect(page).toHaveURL(`/b/${f.first.id}/${f.older.id}.json`);
  await page.goto(`/b/${f.first.id}/${f.latest.id}`);
  await expect(page.locator('head link[type="application/json"]')).toHaveAttribute(
    'href',
    `/b/${f.first.id}/${f.latest.id}.json`,
  );
  await page.getByRole('radio', { name: 'Compose', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Web preview', exact: true })).toBeVisible();
  await expect(page.locator('head link[rel="alternate"]')).toHaveCount(2);
  await expect(page.locator('head link[type="application/json"]')).toHaveAttribute('href', new RegExp(`^/b/${f.first.id}/compose\\.json(?:\\?|$)`));
  await expect(page.locator('head link[type="application/json"]')).toHaveAttribute('title', 'Saved Compose configuration');
  await expect(page.locator('head link[type="application/atom+xml"]')).toHaveCount(0);
  expect(f.database.sqlite.prepare('SELECT id,payload_json FROM brews ORDER BY id').all()).toEqual(
    frozen,
  );
});

test('a disabled feed keeps twins active and its schedule link can enable a saved subscription', async ({
  page,
}) => {
  const f = await setup(page, false);
  await page.goto(`/b/${f.first.id}/${f.latest.id}`);
  const formats = page.locator('.brew-format-links');
  await expect(formats.getByRole('link', { name: 'JSON', exact: true })).toBeVisible();
  await expect(formats.getByRole('button', { name: 'Atom feed', exact: true })).toBeDisabled();
  await expect(formats.getByText('Feed is off', { exact: true })).toBeVisible();
  await expect(page.locator('head link[type="application/atom+xml"]')).toHaveCount(0);
  await formats.getByRole('link', { name: 'Schedule & delivery', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Schedule & delivery', exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('switch', { name: 'Atom and JSON feed', exact: true }).check();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Autosave')).toHaveText('All changes saved');
  expect(f.brews.composition(f.first.id)!.delivery.feed).toBe(true);
  await page.getByRole('radio', { name: 'Read', exact: true }).click();
  await expect(
    page.locator('.brew-format-links').getByRole('link', { name: 'Atom feed', exact: true }),
  ).toBeVisible();
});

test('availability errors remain visible, retry recovers, and unsupported targets keep disabled controls', async ({
  page,
}) => {
  const f = await setup(page);
  f.failNext('GET', `/api/brew-configs/${f.first.id}/composition`, 100);
  await page.goto(`/b/${f.first.id}/${f.latest.id}`);
  const formats = page.locator('.brew-format-links');
  await expect(formats.getByText('Feed unavailable', { exact: true })).toBeVisible();
  f.failNext('GET', `/api/brew-configs/${f.first.id}/composition`, 0);
  await formats.getByRole('button', { name: 'Retry feed availability', exact: true }).click();
  await expect(formats.getByRole('link', { name: 'Atom feed', exact: true })).toBeVisible();
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({
      json: { ...nodeCapabilities(), outputs: { twins: false, feed: false, webhook: false } },
    }),
  );
  await page.reload();
  for (const name of ['Markdown', 'JSON', 'Atom feed'])
    await expect(formats.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(formats.getByRole('link', { name: 'About formats', exact: true })).toHaveAttribute(
    'href',
    '/settings/runs#setup-outputs',
  );
  await expect(page.locator('head link[rel="alternate"]')).toHaveCount(0);
});

test('the development server proxies real output HTTP requests and still serves SPA Read/Compose URLs', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/brew-configs/composition', {
    data: {
      name: 'Output HTTP review',
      enabled: false,
      timezone: 'UTC',
      schedule: { kind: 'daily', time: '07:00' },
      delivery: { web: true, feed: true, publicCopy: false },
      sections: [{ ...newBrewSection('note', 'note'), note: 'A real output HTTP request.' }],
    },
  });
  expect(created.status()).toBe(201);
  const config = await created.json();
  try {
    const generated = await request.post(`/api/brew-configs/${config.id}/generate`);
    expect(generated.status()).toBe(200);
    const issue = await generated.json();
    for (const [path, media] of [
      [`/b/${config.id}/${issue.id}.md`, 'text/markdown'],
      [`/b/${config.id}/${issue.id}.json`, 'application/json'],
      [`/b/${config.id}.atom`, 'application/atom+xml'],
      [`/b/${config.id}.json`, 'application/feed+json'],
    ]) {
      const response = await request.get(path!);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['content-type']).toContain(media);
      expect(await response.text()).toContain('A real output HTTP request.');
    }
    await page.goto(`/b/${config.id}/${issue.id}`);
    await expect(page.getByRole('heading', { name: config.name, exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Compose', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Web preview', exact: true })).toBeVisible();
    const absent = await request.get(`/b/${config.id}/999999999.json`);
    expect(absent.status()).toBe(404);
    expect(absent.headers()['content-type']).toContain('application/json');
  } finally {
    await fetch(`http://127.0.0.1:4401/api/brew-configs/${config.id}`, { method: 'DELETE' });
  }
});
