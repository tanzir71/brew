import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/database.js';
import { feeds } from '../db/schema.js';

const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Design Notes</title><link>https://example.test</link><description>Useful things</description><item><guid>one</guid><title>First</title><link>https://example.test/one</link></item></channel></rss>`;

describe('feed and folder routes', () => {
  const apps: Awaited<ReturnType<typeof createApp>>[] = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  it('discovers an alternate feed and manages it in a folder', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url === 'https://example.test/') return new Response('<html><head><link rel="alternate" type="application/rss+xml" href="/news.xml" title="News"></head></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      if (url === 'https://example.test/news.xml') return new Response(rss, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const app = await createApp({ database: openDatabase(':memory:'), fetcher });
    apps.push(app);

    const discovery = await app.inject({ method: 'POST', url: '/api/feeds/discover', payload: { url: 'https://example.test' } });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toEqual({ candidates: [{ url: 'https://example.test/news.xml', title: 'Design Notes', type: 'rss' }] });

    const folder = await app.inject({ method: 'POST', url: '/api/folders', payload: { title: 'Design' } });
    expect(folder.statusCode).toBe(201);
    const folderId = folder.json().id as number;
    const added = await app.inject({ method: 'POST', url: '/api/feeds', payload: { url: 'https://example.test/news.xml', folderId } });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ title: 'Design Notes', folderId });
    const feedId = added.json().id as number;

    const renamed = await app.inject({ method: 'PATCH', url: `/api/feeds/${feedId}`, payload: { title: 'Renamed', folderId } });
    expect(renamed.json()).toMatchObject({ title: 'Renamed' });
    expect((await app.inject('/api/feeds')).json()).toHaveLength(1);
    expect((await app.inject({ method: 'POST', url: '/api/feeds', payload: { url: 'https://example.test/news.xml' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/api/feeds/${feedId}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/folders/${folderId}` })).statusCode).toBe(204);
  });

  it('accepts a JSON Feed directly and rejects non-feed content', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => new URL(input.toString()).hostname === 'valid.test'
      ? new Response(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'JSON Daily', items: [] }), { status: 200, headers: { 'content-type': 'application/feed+json' } })
      : new Response('<html><body>Nothing here</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    const app = await createApp({ database: openDatabase(':memory:'), fetcher });
    apps.push(app);
    expect((await app.inject({ method: 'POST', url: '/api/feeds/discover', payload: { url: 'https://valid.test/feed.json' } })).json()).toMatchObject({ candidates: [{ title: 'JSON Daily', type: 'json' }] });
    expect((await app.inject({ method: 'POST', url: '/api/feeds', payload: { url: 'https://invalid.test' } })).statusCode).toBe(400);
  });

  it('reports a warning only after a feed has failed for seven days', async () => {
    const database = openDatabase(':memory:');
    database.db.insert(feeds).values({ url: 'https://stale.test/feed', title: 'Stale', lastStatus: 500, consecutiveFailures: 9, failingSince: new Date(Date.now() - 8 * 86_400_000) }).run();
    database.db.insert(feeds).values({ url: 'https://recent.test/feed', title: 'Recent', lastStatus: 500, consecutiveFailures: 1, failingSince: new Date(Date.now() - 86_400_000) }).run();
    const app = await createApp({ database }); apps.push(app);
    const health = (await app.inject('/api/feeds')).json() as Array<{ title: string; healthWarning: boolean }>;
    expect(health).toEqual([{ title: 'Recent', healthWarning: false }, { title: 'Stale', healthWarning: true }].map((expected) => expect.objectContaining(expected)));
  });
});
