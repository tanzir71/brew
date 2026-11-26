import { afterEach, expect, it, vi } from 'vitest';
import { createApi } from '../../packages/api/src/app.js';
import { brewToolCatalog } from '../../packages/api/src/agent-tools.js';
import type { ApiServices } from '../../packages/api/src/ports.js';
import { createApp, nodeServices } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { nodeCapabilities } from './src/capabilities.js';

const closes: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});

it('serves GET/HEAD with current metadata and shared tool names without reading or changing the library', async () => {
  const database = openDatabase(':memory:');
  const app = await createApp({
    database,
    logger: false,
    webmcp: false,
    publicUrl: 'https://private-instance.test',
  });
  closes.push(() => app.close());
  database.sqlite
    .prepare(
      "INSERT INTO feeds(url,title) VALUES('https://private-source.test/feed','Private feed name')",
    )
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO articles(feed_id,guid,hash,title,url,content_html,published_at) VALUES(1,'secret-guid','secret-hash','Private article title','https://private-source.test/story','<p>Confidential body.</p>',?)",
    )
    .run(Date.now());
  const services = nodeServices(app);
  const token = services.agentAccess!.create({ name: 'Private token name' });
  const before = database.sqlite.prepare('SELECT total_changes() AS n').get();
  const result = await app.inject('/llms.txt?query=not-in-the-guide');
  expect(result.statusCode).toBe(200);
  expect(result.headers['content-type']).toMatch(/^text\/plain; charset=utf-8$/i);
  expect(result.headers['cache-control']).toBe('private, no-store');
  expect(result.headers['x-robots-tag']).toBe('noindex, nofollow');
  expect(result.body).toMatch(/^# Brew instance guide\n\n> /);
  expect(result.body).toContain(
    'Mode: node. Read state: server. MCP: stdio+http. WebMCP: disabled.',
  );
  expect(result.body).toContain('Authorization: Bearer <Brew token>');
  expect(result.body).toContain('read-only by default');
  expect(result.body).toContain('same target and revision');
  expect(result.body).toContain('undo_id');
  const names = [...result.body.matchAll(/^- \[([a-z_]+)\]\(/gm)].map((match) => match[1]);
  expect(names).toEqual(brewToolCatalog(services).map((tool) => tool.name));
  for (const secret of [
    'Private feed name',
    'Private article title',
    'Confidential body',
    'private-source.test',
    'Private token name',
    token.token,
    'private-instance.test',
    'not-in-the-guide',
  ])
    expect(result.body).not.toContain(secret);
  expect(result.body.length).toBeLessThan(14_000);
  expect(result.headers).not.toHaveProperty('etag');
  const head = await app.inject({ method: 'HEAD', url: '/llms.txt' });
  expect(head.statusCode).toBe(200);
  expect(head.body).toBe('');
  expect(head.headers['content-type']).toBe(result.headers['content-type']);
  expect(head.headers['cache-control']).toBe('private, no-store');
  const poisoned = await app.inject({
    url: '/llms.txt',
    headers: {
      host: 'attacker.invalid',
      'x-forwarded-host': 'other.invalid',
      'x-forwarded-proto': 'http',
    },
  });
  expect(poisoned.body).toBe(result.body);
  expect(database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  expect(services.agentAccess!.list()[0]!.lastUsedAt).toBeNull();
});

it.each(['none', 'http', 'webmcp'] as const)(
  'describes the %s adapter combination without calling content, settings, token or audit ports',
  async (adapter) => {
    const caps = {
      ...nodeCapabilities(),
      mcp: adapter === 'http' ? ('http' as const) : null,
      webmcp: adapter === 'webmcp',
      agentAccess: false,
      outputs: { twins: false, feed: false, webhook: false },
      actions: { undo: false },
    };
    const capabilities = vi.fn(() => caps);
    let servingGuide = false;
    const services = new Proxy(
      { capabilities },
      {
        get(target, key) {
          if (key === 'capabilities') return target.capabilities;
          if (key === 'agentAccess' || key === 'outputBaseUrl') return undefined;
          if (!servingGuide) return undefined;
          throw new Error(`Unexpected metadata read: ${String(key)}`);
        },
      },
    ) as unknown as ApiServices;
    const api = createApi(services, {
      mcp: adapter === 'http' ? { fetch: async () => new Response() } : undefined,
    });
    servingGuide = true;
    const result = await api.request('/llms.txt');
    const text = await result.text();
    expect(result.status).toBe(200);
    expect(capabilities).toHaveBeenCalledOnce();
    expect(text).not.toContain('## Saved views');
    expect(text).not.toContain('Local stdio:');
    expect(text).toContain('Durable action Undo is unavailable');
    if (adapter === 'http') {
      expect(text).toContain('MCP: http.');
      expect(text).toContain('no scoped-token adapter is configured');
    } else if (adapter === 'webmcp') {
      expect(text).toContain('MCP: unavailable. WebMCP: experimental');
      expect(text).toContain('[WebMCP catalog](/api/webmcp/tools)');
      expect(text).toContain('[search_items](/api/webmcp/tools)');
    } else {
      expect(text).toContain('No MCP HTTP transport is available');
      expect(text).toContain('Reference only; no tool transport is enabled.');
    }
  },
);

it('refreshes effective flags per request, refuses credential fallback and masks adapter failure', async () => {
  const caps = { ...nodeCapabilities(), webmcp: false };
  const capabilities = vi.fn(() => caps);
  const api = createApi({ capabilities } as unknown as ApiServices);
  expect(await (await api.request('/llms.txt')).text()).toContain('WebMCP: disabled.');
  caps.webmcp = true;
  expect(await (await api.request('/llms.txt')).text()).toContain('[WebMCP catalog]');
  capabilities.mockClear();
  const denied = await api.request('/llms.txt', {
    headers: { authorization: 'Bearer never-an-owner-token' },
  });
  expect(denied.status).toBe(403);
  expect(denied.headers.get('cache-control')).toBe('private, no-store');
  expect(capabilities).not.toHaveBeenCalled();
  capabilities.mockImplementation(() => {
    throw new Error('Private credentials from a failed adapter.');
  });
  const failed = await api.request('/llms.txt');
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: 'Instance guidance is temporarily unavailable.' });
  expect(failed.headers.get('x-robots-tag')).toBe('noindex, nofollow');
});

it('documents the real route and keeps unsupported requests out of SPA fallback, including parser errors', async () => {
  const app = await createApp({ database: openDatabase(':memory:'), logger: false });
  closes.push(() => app.close());
  const doc = (await app.inject('/api/openapi.json')).json();
  expect(doc.paths['/llms.txt'].get.responses['200'].content['text/plain'].schema).toEqual({
    type: 'string',
  });
  const post = await app.inject({ method: 'POST', url: '/llms.txt' });
  expect(post.statusCode).toBe(404);
  expect(post.headers['cache-control']).toBe('private, no-store');
  const malformed = await app.inject({
    method: 'POST',
    url: '/llms.txt',
    headers: { 'content-type': 'application/json' },
    payload: '{',
  });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.headers['cache-control']).toBe('private, no-store');
  expect(malformed.headers['x-robots-tag']).toBe('noindex, nofollow');
});
