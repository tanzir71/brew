import { expect, test } from '@playwright/test';

test('two capability consumers share the real Node response and one request', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/capabilities') requests.push(request.url());
  });
  await page.goto('/test/capabilities.html');
  for (const name of ['First consumer', 'Second consumer']) {
    const status = page.getByRole('region', { name }).getByRole('status');
    await expect(status).toContainText('"mode":"node"');
    const value = JSON.parse((await status.textContent())!);
    expect(value).toMatchObject({
      fetch: 'direct',
      readState: 'server',
      emailDelivery: null,
      readerApi: false,
      webmcp: false,
    });
  }
  expect(requests).toHaveLength(1);
});

test('HTTP failures recover and invalid refreshes clear cached gate data', async ({ page }) => {
  let failing = true;
  let invalid = false;
  let requests = 0;
  await page.route('**/api/capabilities', (route) => {
    requests++;
    if (invalid) return route.fulfill({ json: { mode: 'node', readerApi: true } });
    return failing
      ? route.fulfill({ status: 503, json: { error: 'Unavailable' } })
      : route.continue();
  });
  await page.goto('/test/capabilities.html');
  await expect(page.getByRole('alert')).toHaveCount(2);
  await expect(page.getByRole('alert').first()).toHaveText(
    'Could not load capabilities (HTTP 503)',
  );
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(requests).toBe(1);
  failing = false;
  await page
    .getByRole('region', { name: 'Second consumer' })
    .getByRole('button', { name: 'Reload capabilities' })
    .click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(2);
  await expect(page.getByRole('status').first()).toContainText('"mode":"node"');
  expect(requests).toBe(2);
  invalid = true;
  await page
    .getByRole('region', { name: 'First consumer' })
    .getByRole('button', { name: 'Reload capabilities' })
    .click();
  await expect(page.getByRole('alert')).toHaveCount(2);
  for (const name of ['First consumer', 'Second consumer']) {
    await expect(page.getByRole('region', { name })).toHaveAttribute(
      'data-capabilities-available',
      'false',
    );
  }
  expect(requests).toBe(3);
});

test('an incomplete capability response is rejected instead of enabling features', async ({
  page,
}) => {
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: { mode: 'node', readerApi: true } }),
  );
  await page.goto('/test/capabilities.html');
  await expect(page.getByRole('alert')).toHaveCount(2);
  await expect(page.getByRole('alert').first()).toHaveText(
    'The server returned invalid capabilities',
  );
  await expect(page.getByRole('status')).toHaveCount(0);
});
