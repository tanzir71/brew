import { afterEach, expect, it, vi } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createApp, nodeServices } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { createApi } from '../../packages/api/src/app.js';
import { createBrewMcpHandler } from '../../packages/api/src/mcp.js';

const closes: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
  vi.unstubAllEnvs();
});
async function fixture(webmcp = true, fetcher: typeof fetch = vi.fn()) {
  const database = openDatabase(':memory:');
  const app = await createApp({ database, logger: false, webmcp, fetcher });
  closes.push(() => app.close());
  database.sqlite
    .prepare("INSERT INTO feeds(title,url) VALUES('Browser source','https://example.test/rss')")
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO articles(feed_id,guid,hash,title,url,published_at,content_html) VALUES(1,'webmcp','webmcp','Browser story','https://example.test/story',?,'<p>Safe body.</p>')",
    )
    .run(Date.now());
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/webmcp/call',
        headers: { origin: 'http://localhost' },
        payload: { name, arguments: args },
      })
    ).json();
  return { database, app, services: nodeServices(app), call };
}
it('is disabled by default and enabled only by the instance flag, with private setup responses', async () => {
  const database = openDatabase(':memory:');
  const app = await createApp({ database, logger: false });
  closes.push(() => app.close());
  expect((await app.inject('/api/capabilities')).json().webmcp).toBe(false);
  const disabled = await app.inject('/api/webmcp/tools');
  expect(disabled.statusCode).toBe(501);
  expect(disabled.headers['cache-control']).toBe('private, no-store');
  vi.stubEnv('BREW_WEBMCP', '1');
  const other = await createApp({ database: openDatabase(':memory:'), logger: false });
  closes.push(() => other.close());
  expect((await other.inject('/api/capabilities')).json().webmcp).toBe(true);
  const explicit = await fixture(false);
  expect((await explicit.app.inject('/api/capabilities')).json().webmcp).toBe(false);
});
it('publishes the same validated argument schemas as the real MCP transport', async () => {
  const f = await fixture();
  const issued = f.services.agentAccess!.create({ name: 'Catalog test' });
  const handler = createBrewMcpHandler(f.services);
  closes.unshift(() => handler.close());
  const api = createApi(f.services, { mcp: handler });
  const client = new Client({ name: 'catalog-parity', version: '1' });
  closes.unshift(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${issued.token}` } },
      fetch: (request, init) => api.fetch(new Request(request, init)),
    }),
  );
  const mcp = await client.listTools();
  const result = await f.app.inject('/api/webmcp/tools');
  expect(result.statusCode).toBe(200);
  const tools = result.json() as Array<{ name: string; inputSchema: unknown }>;
  expect(tools).toHaveLength(12);
  for (const tool of tools)
    expect(tool.inputSchema).toEqual(
      mcp.tools.find((entry) => entry.name === tool.name)!.inputSchema,
    );
  expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
    n: 0,
  });
});
it('validates requests, refuses cross-origin traffic and rejects token fallback to owner session calls', async () => {
  const f = await fixture();
  const issued = f.services.agentAccess!.create({ name: 'Cannot escalate', scopes: 'write' });
  for (const headers of [
    {},
    { origin: 'null' },
    { origin: 'https://evil.test' },
    { origin: 'http://evil.test', host: 'evil.test' },
    { origin: 'http://localhost', authorization: `Bearer ${issued.token}` },
    { origin: 'http://localhost', 'sec-fetch-site': 'cross-site' },
  ]) {
    const reply = await f.app.inject({
      method: 'POST',
      url: '/api/webmcp/call',
      headers,
      payload: {
        name: 'star',
        arguments: { id: 1, confirm: true, request_id: 'webmcp-denied-0001' },
      },
    });
    expect(reply.statusCode).toBe(403);
  }
  expect((await f.call('star', { id: 0, confirm: true })).structuredContent).toMatchObject({
    status: 400,
  });
  const unknown = await f.app.inject({
    method: 'POST',
    url: '/api/webmcp/call',
    headers: { origin: 'http://localhost' },
    payload: { name: 'delete_feed', arguments: { id: 1 } },
  });
  expect(unknown.statusCode).toBe(404);
  expect((await f.call('star', { id: 1 })).structuredContent).toMatchObject({ status: 428 });
  expect(f.database.sqlite.prepare('SELECT starred_at FROM articles').get()).toEqual({
    starred_at: null,
  });
});
it('uses the real service journal and attributes metadata-only reads, confirmed writes and Undo to WebMCP', async () => {
  const f = await fixture();
  expect((await f.call('get_item', { id: 1 })).structuredContent.markdown).toContain('Safe body');
  const target = { kind: 'items', ids: [1] },
    preview = await f.call('mark_read', { target });
  expect(f.database.sqlite.prepare('SELECT read_at FROM articles').get()).toEqual({
    read_at: null,
  });
  const args = {
    target,
    revision: preview.structuredContent.revision,
    confirm: true,
    request_id: 'webmcp-read-identity1',
  };
  const changed = await f.call('mark_read', args);
  expect(changed.isError).not.toBe(true);
  expect((await f.call('mark_read', args)).structuredContent.undo_id).toBe(
    changed.structuredContent.undo_id,
  );
  expect(f.database.sqlite.prepare('SELECT read_at FROM articles').get()).not.toEqual({
    read_at: null,
  });
  expect(
    (await f.call('undo', { undo_id: changed.structuredContent.undo_id, confirm: true }))
      .structuredContent.receipt.status,
  ).toBe('undone');
  expect(f.database.sqlite.prepare('SELECT read_at FROM articles').get()).toEqual({
    read_at: null,
  });
  const history = f.services.agentAccess!.activity();
  expect(history.items.every((entry) => entry.agent === 'WebMCP')).toBe(true);
  expect(JSON.stringify(history)).not.toContain('Safe body');
});
it('aborts a browser subscription after fetch and before its atomic insertion', async () => {
  let started!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(true, async () => {
    started();
    await waiting;
    return new Response(
      '<rss version="2.0"><channel><title>Cancelled</title><link>https://example.test</link><description>Feed</description></channel></rss>',
      { headers: { 'content-type': 'application/rss+xml' } },
    );
  });
  const controller = new AbortController();
  const pending = f.services.actions!.run(
    {
      kind: 'add_feed',
      url: 'https://example.test/new',
      folderId: null,
      confirm: true,
      requestId: 'webmcp-cancelled-001',
    },
    { agent: 'webmcp', signal: controller.signal },
  );
  await ready;
  controller.abort();
  release();
  await expect(pending).rejects.toMatchObject({ status: 409 });
  expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM feeds').get()).toEqual({ n: 1 });
  expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
    n: 0,
  });
});

it('propagates an actual disconnected HTTP request to the write boundary', async () => {
  let started!: () => void, release!: () => void, disconnected!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const closed = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  const f = await fixture(true, async () => {
    started();
    await waiting;
    return new Response(
      '<rss version="2.0"><channel><title>Disconnected</title><link>https://example.test</link><description>Feed</description></channel></rss>',
      { headers: { 'content-type': 'application/rss+xml' } },
    );
  });
  f.app.server.on('connection', (socket) => socket.once('close', disconnected));
  const base = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const request = fetch(`${base}/api/webmcp/call`, {
    method: 'POST',
    signal: controller.signal,
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'add_feed',
      arguments: {
        url: 'https://example.test/disconnected',
        confirm: true,
        request_id: 'web-disconnect-0001',
      },
    }),
  }).catch(() => null);
  try {
    await ready;
    controller.abort();
    await closed;
  } finally {
    release();
  }
  await request;
  await f.services.actions!.drain();
  expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM feeds').get()).toEqual({ n: 1 });
  expect(
    f.database.sqlite
      .prepare('SELECT count(*) AS n FROM agent_actions WHERE undo_json IS NOT NULL')
      .get(),
  ).toEqual({ n: 0 });
});
