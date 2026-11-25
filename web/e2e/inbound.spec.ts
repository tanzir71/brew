import { expect, test } from '@playwright/test';
import { composeFixture } from './compose-fixture';

test('a configured inbound webhook exposes its actual address, receives a letter and opens clean content in Reader', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const inbound = {
    kind: 'postmark' as const,
    address: 'letters@in.example.test',
    username: 'brew-test',
    password: 'test-only-webhook-password-32',
  };
  const fetcher: typeof fetch = async (input) =>
    String(input).endsWith('/feed.xml')
      ? new Response(
          '<rss version="2.0"><channel><title>Field Notes</title><link>https://journal.test</link></channel></rss>',
          { headers: { 'content-type': 'application/rss+xml' } },
        )
      : new Response(
          '<html><head><title>Field Notes</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body><a href="/subscribe">Subscribe to the newsletter</a></body></html>',
          { headers: { 'content-type': 'text/html' } },
        );
  const fixture = await composeFixture(page, 'light', fetcher, { inbound });
  try {
    await page.route('**/api/events', (route) =>
      route.fulfill({ contentType: 'text/event-stream', body: 'event: heartbeat\ndata: {}\n\n' }),
    );
    await page.goto('/settings/runs');
    await expect(
      page.getByText('Your mail provider forwards letters to this instance').first(),
    ).toBeVisible();
    const row = page
      .getByRole('region', { name: 'Capabilities' })
      .locator('[data-capability="newsletters"]');
    // The real capability API enables this row; no capability response is mocked.
    await expect(row.getByText('Works here', { exact: true })).toBeVisible();
    await page.goto('/b/1/compose');
    await page.getByRole('button', { name: '+ Source', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Add a source to “Design & craft”' });
    await sheet.getByLabel('URL or search', { exact: true }).fill('journal.test');
    await expect(sheet.getByRole('button', { name: 'Copy address', exact: true })).toBeEnabled();
    await sheet.getByRole('button', { name: 'Copy address', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inbound.address);
    await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
    const auth = `Basic ${Buffer.from(`${inbound.username}:${inbound.password}`).toString('base64')}`;
    const payload = {
      From: 'Field Notes <notes@journal.test>',
      OriginalRecipient: inbound.address,
      Subject: 'A letter through the webhook',
      MessageID: 'browser-inbound',
      HtmlBody:
        '<h2>Forest paths</h2><p>A clean letter.</p><img width="1" src="https://metrics.test/open"><script>window.mailExecuted=true</script><div class="sponsor">secretadtoken</div>',
    };
    const post = () =>
      page.evaluate(
        async ({ auth, payload }) => {
          const response = await fetch('/api/inbound/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: auth },
            body: JSON.stringify(payload),
          });
          return {
            status: response.status,
            body: (await response.json()) as { articleId: number },
          };
        },
        { auth, payload },
      );
    const received = await post();
    expect(received.status).toBe(200);
    expect((await post()).body).toEqual(received.body);
    expect(
      fixture.database.sqlite
        .prepare("SELECT count(*) AS n FROM articles WHERE title='A letter through the webhook'")
        .get(),
    ).toEqual({ n: 1 });
    await page.goto(`/a/${received.body.articleId}`);
    const reader = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(reader.getByRole('heading', { name: payload.Subject, exact: true })).toBeVisible();
    await expect(reader.getByRole('heading', { name: 'Forest paths', exact: true })).toBeVisible();
    expect(await reader.locator('script,img,iframe').count()).toBe(0);
    await expect(reader.getByText('secretadtoken')).toHaveCount(0);
    expect(await page.evaluate(() => 'mailExecuted' in window)).toBe(false);
  } finally {
    await fixture.close();
  }
});
