import type { Page } from '@playwright/test';
import { createApp, nodeServices } from '../../targets/node/src/app';
import { openDatabase } from '../../targets/node/src/db/database';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model';

export const agentNow = new Date('2026-11-25T09:14:00Z');
export async function agentAccessFixture(page: Page, theme = 'light', populated = false) {
  const database = openDatabase(':memory:');
  const app = await createApp({
    database,
    logger: false,
    publicUrl: 'http://127.0.0.1:4401',
    clock: { now: () => new Date(agentNow), monotonic: () => 0 },
    fetcher: async () =>
      new Response(
        '<rss version="2.0"><channel><title>Low Tide</title><link>https://lowtide.test</link><description>Essays</description></channel></rss>',
        { headers: { 'content-type': 'application/rss+xml' } },
      ),
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const services = nodeServices(app);
  for (const name of ['Morning', 'Weekend'])
    await services.brews.createComposition({
      name,
      enabled: true,
      timezone: 'UTC',
      schedule: { kind: 'daily', time: '07:00' },
      delivery: defaultDelivery(),
      sections: [newBrewSection('Stories')],
    });
  database.sqlite
    .prepare("INSERT INTO feeds(url,title) VALUES('https://example.test/feed','Engineering')")
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO articles(feed_id,guid,hash,title,url,published_at,content_html) VALUES(1,'story','story','Agent test story','https://example.test/story',?,'<p>Body.</p>')",
    )
    .run(agentNow.getTime());
  if (populated) {
    const access = services.agentAccess!;
    access.create({ name: 'ChatGPT agent', expiresInDays: 30 });
    const codex = access.create({ name: 'Codex CLI', expiresInDays: 5 });
    const claude = access.create({ name: 'Claude (desktop)', scopes: 'write', expiresInDays: 28 });
    database.sqlite
      .prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?')
      .run(agentNow.getTime() - 86400000, codex.entry.id);
    database.sqlite
      .prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?')
      .run(agentNow.getTime(), claude.entry.id);
    const context = { agent: 'mcp' as const, name: 'Claude (desktop)', tokenId: claude.entry.id };
    await services.actions!.run(
      {
        kind: 'add_feed',
        url: 'https://lowtide.test/essays.atom',
        folderId: null,
        confirm: true,
        requestId: 'visual-agent-feed-001',
      },
      context,
    );
    access.record(
      { write: false, tokenId: codex.entry.id, name: 'Codex CLI' },
      'create_rule',
      'complete',
    );
    access.record(
      { write: true, tokenId: claude.entry.id, name: 'Claude (desktop)' },
      'search_items',
      'complete',
    );
    const review = services.actions!.previewRead({ kind: 'items', ids: [1] });
    await services.actions!.run(
      {
        kind: 'mark_read',
        target: { kind: 'items', ids: [1] },
        revision: review.revision,
        confirm: true,
        requestId: 'visual-agent-read-001',
      },
      context,
    );
  }
  await page.clock.setFixedTime(agentNow);
  await page.addInitScript((value) => {
    localStorage.setItem('brew:theme', value);
  }, theme);
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const result = await app.inject({
      method: request.method() as 'GET',
      url: url.pathname + url.search,
      headers: request.headers(),
      payload: request.postData() ?? undefined,
    });
    await route.fulfill({
      status: result.statusCode,
      headers: result.headers as Record<string, string>,
      body: result.body,
    });
  });
  return { app, base, database, services, close: () => app.close() };
}
