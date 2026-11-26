import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { composeFixture } from './compose-fixture';
import { NewsletterService } from '../../targets/node/src/services/newsletter-service';

test('an ingested MIME letter opens at its local URL with inert cleaned content and shared read state', async ({
  page,
}) => {
  const fixture = await composeFixture(page);
  try {
    const service = new NewsletterService(fixture.database);
    const html =
      '<h2>A quiet walk</h2><p onclick="window.mailExecuted=true">Forest story <a href="https://journal.test/walk?utm_source=email">Read the essay</a>.</p><div class="sponsor">secretadtoken</div><img style="width:1px;height:1px" src="https://metrics.test/open"><script>window.mailExecuted=true</script><iframe src="https://metrics.test/frame"></iframe><footer><a href="https://journal.test/unsubscribe">Unsubscribe</a></footer>';
    const result = await service.ingest(
      `From: Field Notes <notes@journal.test>\r\nSubject: A letter for walking\r\nMessage-ID: <browser@journal.test>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`,
    );
    const stored = fixture.database.sqlite
      .prepare('SELECT url,raw_html,read_at FROM articles WHERE id=?')
      .get(result.articleId) as { url: string; raw_html: string; read_at: number | null };
    expect(stored.raw_html).toContain('<script>');
    expect(stored.read_at).toBeNull();
    const remoteRequests: string[] = [];
    page.on('request', (request) => {
      if (/metrics\.test|utm_source=|secretadtoken/.test(request.url()))
        remoteRequests.push(request.url());
    });
    await page.route('**/api/events', (route) =>
      route.fulfill({ contentType: 'text/event-stream', body: 'event: heartbeat\ndata: {}\n\n' }),
    );
    await page.goto(stored.url);
    const dialog = page.getByRole('dialog', { name: 'Article reader', exact: true });
    await expect(
      dialog.getByRole('heading', { name: 'A letter for walking', exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'A quiet walk', exact: true })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Read the essay' })).toHaveAttribute(
      'href',
      'https://journal.test/walk',
    );
    await expect(dialog.getByText('secretadtoken')).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: 'Unsubscribe' })).toHaveCount(0);
    expect(await dialog.locator('script,iframe,img,[onclick]').count()).toBe(0);
    expect(await page.evaluate(() => 'mailExecuted' in window)).toBe(false);
    expect(remoteRequests).toEqual([]);
    await expect
      .poll(
        () =>
          (
            fixture.database.sqlite
              .prepare('SELECT read_at FROM articles WHERE id=?')
              .get(result.articleId) as { read_at: number | null }
          ).read_at,
      )
      .not.toBeNull();
    const violations = (
      await new AxeBuilder({ page }).include('dialog[aria-label="Article reader"]').analyze()
    ).violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''));
    expect(violations).toEqual([]);
    await dialog.getByRole('button', { name: 'Close article', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(
      page
        .getByRole('dialog', { name: 'Article reader', exact: true })
        .getByRole('heading', { name: 'A letter for walking', exact: true }),
    ).toBeVisible();
  } finally {
    await fixture.close();
  }
});
