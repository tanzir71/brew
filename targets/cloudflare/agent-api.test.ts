import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createTestHarness } from 'wrangler';
import { createApp, nodeServices } from '../node/src/app.js';
import { openDatabase } from '../node/src/db/database.js';
import type { ReaderTestEnv } from './test/reader-worker.js';
import type { AgentToken, AgentActivity } from '../../packages/core/src/agent-access.js';
import type { ActionReceipt } from '../../packages/core/src/actions.js';
import { brewToolCatalog } from '../../packages/api/src/agent-tools.js';
import { cloudflareLibraryServices } from './src/library-api.js';
import { newBrewSection, defaultDelivery } from '../../packages/core/src/composition-model.js';

const now = Date.parse('2026-11-27T12:00:00Z'),
  origin = 'https://brew.example.test';
const server = createTestHarness({
  workers: [
    {
      config: {
        name: 'brew-agent-test',
        main: fileURLToPath(new URL('./test/agent-worker.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        compatibility_flags: ['nodejs_compat'],
        rules: [{ type: 'CompiledWasm', globs: ['**/*.wasm', '**/wasm'], fallthrough: true }],
        workers_dev: false,
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'agent-test',
            database_id: '00000000-0000-0000-0000-000000000001',
            migrations_dir: fileURLToPath(
              new URL('../../packages/db/migrations/', import.meta.url),
            ),
          },
        ],
        r2_buckets: [{ binding: 'IMAGES', bucket_name: 'agent-test-images' }],
        services: [{ binding: 'UPSTREAM', service: 'brew-agent-upstream-test' }],
      },
    },
    {
      config: {
        name: 'brew-agent-upstream-test',
        main: fileURLToPath(new URL('./test/agent-upstream.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        workers_dev: false,
      },
    },
  ],
});
const worker = server.getWorker<ReaderTestEnv>('brew-agent-test');
let env: ReaderTestEnv,
  at: number,
  node: Awaited<ReturnType<typeof createApp>>,
  database: ReturnType<typeof openDatabase>;
const clients: Client[] = [];
const clock = { now: () => new Date(at), monotonic: () => 0 };
beforeAll(async () => {
  await server.listen();
  await worker.applyD1Migrations('DB');
  env = await worker.getEnv();
}, 30000);
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  at = now;
  await env.DB.exec(
    'DELETE FROM agent_action_changes; DELETE FROM agent_actions; DELETE FROM api_tokens; DELETE FROM reader_sessions; DELETE FROM reader_access; DELETE FROM settings; DELETE FROM feeds; DELETE FROM tags; DELETE FROM rules; DELETE FROM brew_configs; DELETE FROM sqlite_sequence;',
  );
  database = openDatabase(':memory:');
  node = await createApp({ database, logger: false, publicUrl: origin, clock });
  const seed = [
    {
      sql: "INSERT INTO feeds(id,title,url,created_at) VALUES(1,'Source','https://source.example.test/rss',?)",
      values: [now] as unknown[],
    },
  ];
  for (let id = 1; id <= 53; id++)
    seed.push({
      sql: 'INSERT INTO articles(id,feed_id,guid,hash,title,url,content_html,raw_html,published_at,fetched_at) VALUES(?,1,?,?,?,?,?,?,?,?)',
      values: [
        id,
        `g-${id}`,
        `h-${id}`,
        `Private story ${id}`,
        `https://source.example.test/${id}`,
        '<p>Story body.</p>',
        '<p>Raw private original.</p>',
        now - id,
        now,
      ],
    });
  seed.push({
    sql: 'INSERT INTO brew_configs(id,name,enabled,sections_json,timezone,schedule_json,delivery_json,composition_version,created_at) VALUES(1,?,0,?,?,?,?,2,?)',
    values: [
      'Private Edition',
      JSON.stringify([
        { ...newBrewSection('manual'), sources: [{ kind: 'feed', id: 1 }], onlyUnread: false },
      ]),
      'UTC',
      JSON.stringify({ kind: 'daily', time: '07:00' }),
      JSON.stringify(defaultDelivery()),
      now,
    ],
  });
  for (const query of seed) database.sqlite.prepare(query.sql).run(...query.values);
  await env.DB.batch(seed.map((query) => env.DB.prepare(query.sql).bind(...query.values)));
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  await node?.close();
});
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return worker.fetch(origin + path, {
    method,
    headers: {
      'x-review-now': String(at),
      ...(body === undefined ? {} : { 'content-type': 'application/json', origin }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function data<T>(path: string, method = 'GET', body?: unknown, status = 200): Promise<T> {
  const response = await request(path, method, body);
  expect(response.status, await response.clone().text()).toBe(status);
  return response.json() as Promise<T>;
}
const token = (scopes = 'read', name = 'Codex') =>
  data<{ token: string; entry: AgentToken }>(
    '/api/agent-access/tokens',
    'POST',
    { name, scopes },
    201,
  );
async function connect(secret: string) {
  const client = new Client({ name: 'untrusted-protocol-client-name', version: '1' });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', origin), {
      requestInit: { headers: { authorization: `Bearer ${secret}` } },
      fetch: async (input, init) => {
        const req = new Request(input, init),
          headers = new Headers(req.headers);
        headers.set('x-review-now', String(at));
        const response = await worker.fetch(req.url, {
          method: req.method,
          headers: Object.fromEntries(headers),
          ...(req.body ? { body: await req.text() } : {}),
        });
        // Wrangler and the SDK expose different Fetch type realms. Preserve the
        // real HTTP exchange while normalizing the returned native response.
        return new Response(response.body ? await response.arrayBuffer() : null, {
          status: response.status,
          headers: Object.fromEntries(response.headers),
        });
      },
    }),
  );
  return client;
}
async function tool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return result.structuredContent as Record<string, unknown>;
}
const star = { id: 1, confirm: true, request_id: 'worker-agent-star-0001' };
const rule = {
  name: 'Preview only',
  enabled: true,
  matchType: 'all',
  scope: {},
  conditions: [{ field: 'title', operator: 'matches_regex', value: '(?<=Private )story \\d+' }],
  actions: [{ type: 'star' }],
  stopProcessing: false,
};

it('issues native secrets once, stores compatible SHA-256 verifiers and exports only private metadata', async () => {
  const created = await data<{ token: string; entry: AgentToken }>(
    '/api/agent-access/tokens',
    'POST',
    { name: '  Codex Ω  ' },
    201,
  );
  expect(created.token).toMatch(/^brew_ro_[\w-]{43}$/);
  expect(created.entry).toEqual({
    id: 1,
    name: 'Codex Ω',
    scopes: 'read',
    expiresAt: new Date(now + 30 * 86400000).toISOString(),
    lastUsedAt: null,
    createdAt: new Date(now).toISOString(),
  });
  const stored = await env.DB.prepare('SELECT * FROM api_tokens').first<Record<string, unknown>>();
  expect(stored!.token_hash).toBe(createHash('sha256').update(created.token).digest('hex'));
  expect(JSON.stringify(stored)).not.toContain(created.token);
  database.sqlite
    .prepare(
      'INSERT INTO api_tokens(id,name,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)',
    )
    .run(1, 'Codex Ω', stored!.token_hash, 'read', stored!.expires_at, now);
  expect(await nodeServices(node).agentAccess!.authenticate(`Bearer ${created.token}`)).toEqual({
    tokenId: 1,
    name: 'Codex Ω',
    write: false,
  });
  const fromNode = await nodeServices(node).agentAccess!.create({
    name: 'Node',
    scopes: 'write',
    expiresInDays: 1,
  });
  const nodeRow = database.sqlite
    .prepare('SELECT * FROM api_tokens WHERE id=?')
    .get(fromNode.entry.id) as Record<string, unknown>;
  await env.DB.prepare(
    'INSERT INTO api_tokens(id,name,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)',
  )
    .bind(
      nodeRow.id,
      nodeRow.name,
      nodeRow.token_hash,
      nodeRow.scopes,
      nodeRow.expires_at,
      nodeRow.created_at,
    )
    .run();
  await tool(await connect(fromNode.token), 'list_unread', { limit: 1 });
  for (const path of [
    '/api/agent-access/tokens',
    '/api/agent-access/actions',
    '/settings/agents.json',
    '/settings/agents.md',
    '/llms.txt',
    '/api/openapi.json',
  ]) {
    const response = await request(path),
      text = await response.text();
    expect(response.status).toBe(200);
    if (path !== '/api/openapi.json')
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(text).not.toContain(created.token);
    expect(text).not.toContain(String(stored!.token_hash));
    expect(text).not.toContain('Raw private original');
  }
  expect(
    (await data<AgentToken[]>('/api/agent-access/tokens')).find((x) => x.id === 2)!.lastUsedAt,
  ).toBe(new Date(now).toISOString());
});

it('enforces validation, same-origin management and the persistent cap under concurrent creation', async () => {
  for (const input of [
    null,
    {},
    [],
    { name: ' ' },
    { name: 'a\n' },
    { name: 'a'.repeat(101) },
    { name: 'x', scopes: 'owner' },
    { name: 'x', expiresInDays: 0 },
    { name: 'x', expiresInDays: 366 },
    { name: 'x', expiresInDays: 1.5 },
    { name: 'x', token: 'secret' },
  ]) {
    const response = await request('/api/agent-access/tokens', 'POST', input);
    expect(response.status).toBe(400);
  }
  const seed = Array.from({ length: 99 }, (_, i) =>
    env.DB.prepare(
      "INSERT INTO api_tokens(name,token_hash,scopes,expires_at,created_at) VALUES(?,?,'read',?,?)",
    ).bind(`t${i}`, `verifier${i}`, now + 86400000, now),
  );
  await env.DB.batch(seed);
  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      request('/api/agent-access/tokens', 'POST', { name: 'Concurrent' }),
    ),
  );
  expect(responses.map((x) => x.status).sort()).toEqual([201, 409, 409, 409, 409]);
  expect(await data<AgentToken[]>('/api/agent-access/tokens')).toHaveLength(100);
  for (const headers of [
    { origin: 'https://evil.test', 'sec-fetch-site': 'same-origin' },
    { origin: 'null', 'sec-fetch-site': 'same-origin' },
    { origin: '', 'sec-fetch-site': 'cross-site' },
  ])
    expect(
      (await request('/api/agent-access/tokens', 'POST', { name: 'denied' }, headers)).status,
    ).toBe(403);
  expect((await worker.fetch('https://evil.test/api/agent-access/tokens')).status).toBe(403);
  expect((await request('/api/agent-access/tokens/0', 'DELETE', {})).status).toBe(400);
  await data('/api/agent-access/tokens/1', 'DELETE', {});
  expect((await token()).token).toMatch(/^brew_ro_[\w-]{43}$/);
});

it('negotiates the real SDK catalog and pages all D1 read results without library writes', async () => {
  const created = await token(),
    client = await connect(created.token);
  const catalog = await client.listTools();
  expect(catalog.tools.map((x) => x.name)).toEqual(
    brewToolCatalog(nodeServices(node)).map((x) => x.name),
  );
  let cursor: string | undefined,
    ids: number[] = [];
  do {
    const page = await tool(client, 'list_unread', { limit: 20, ...(cursor ? { cursor } : {}) });
    expect(page.total).toBe(53);
    ids = ids.concat((page.items as Array<{ id: number }>).map((x) => x.id));
    cursor = page.next_cursor as string | undefined;
  } while (cursor);
  expect(new Set(ids).size).toBe(53);
  const search = await tool(client, 'search_items', { query: 'Private', limit: 20, offset: 40 });
  expect(search.total).toBe(53);
  expect((search.items as unknown[]).length).toBe(13);
  const item = await tool(client, 'get_item', { id: 1 });
  expect(item.markdown).toContain('Story body');
  expect(JSON.stringify(item)).not.toContain('Raw private original');
  expect(await tool(client, 'create_rule', { draft: rule })).toMatchObject({
    dry_run: true,
    total: 53,
  });
  expect((await tool(client, 'list_brews')).items).toEqual([
    { id: 1, name: 'Private Edition', enabled: false },
  ]);
  expect(await tool(client, 'get_brew', { id: 1 })).toMatchObject({
    brew: { id: 1, name: 'Private Edition' },
    issue: null,
  });
  expect(await tool(client, 'preview_brew', { id: 1 })).toMatchObject({
    snapshot: { configName: 'Private Edition' },
  });
  expect(
    await env.DB.prepare(
      'SELECT count(*) AS n FROM articles WHERE read_at IS NOT NULL OR starred_at IS NOT NULL',
    ).first(),
  ).toEqual({ n: 0 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM rules').first()).toEqual({ n: 0 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM brews').first()).toEqual({ n: 0 });
});

it('rechecks live tokens on every HTTP request and rejects invalid credentials, expiry and scoped route escapes', async () => {
  const created = await token(),
    client = await connect(created.token);
  for (const authorization of [
    '',
    `bearer ${created.token}`,
    `Bearer ${created.token} x`,
    'Bearer brew_ro_invalid',
    'GoogleLogin auth=not-mcp',
  ]) {
    const response = await request(
      '/mcp',
      'POST',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { authorization },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
  }
  for (const path of [
    '/api/agent-access/tokens',
    '/api/articles',
    '/api/webmcp/tools',
    '/settings/agents.json',
    '/a/1.json',
    '/llms.txt',
  ]) {
    expect(
      (await request(path, 'GET', undefined, { authorization: `Bearer ${created.token}` })).status,
    ).toBe(403);
  }
  for (const headers of [{ origin: 'https://evil.test' }, { origin: 'null' }])
    expect((await request('/mcp', 'POST', {}, headers)).status).toBe(403);
  expect((await worker.fetch('https://evil.test/mcp', { method: 'POST' })).status).toBe(403);
  at = now + 30 * 86400000;
  expect(
    (await request('/mcp', 'POST', {}, { authorization: `Bearer ${created.token}` })).status,
  ).toBe(401);
  await expect(client.listTools()).rejects.toThrow(/Use a valid Brew token/);
  at = now;
  await data(`/api/agent-access/tokens/${created.entry.id}`, 'DELETE', {});
  await expect(client.listTools()).rejects.toThrow(/Use a valid Brew token/);
});

it('limits token writes, persists replay and token-owned Undo across invocations', async () => {
  const read = await connect((await token()).token),
    first = await token('write', 'Writer'),
    writer = await connect(first.token),
    other = await connect((await token('write', 'Other')).token);
  expect((await read.callTool({ name: 'star', arguments: star })).structuredContent).toMatchObject({
    status: 403,
  });
  expect(
    (await writer.callTool({ name: 'star', arguments: { id: 1 } })).structuredContent,
  ).toMatchObject({ status: 428 });
  expect(
    (await writer.callTool({ name: 'star', arguments: { id: 1, confirm: true } }))
      .structuredContent,
  ).toMatchObject({ status: 400 });
  expect(
    (
      await writer.callTool({
        name: 'create_rule',
        arguments: {
          draft: rule,
          dry_run: false,
          confirm: true,
          request_id: 'worker-forbid-rule-001',
        },
      })
    ).structuredContent,
  ).toMatchObject({ status: 403 });
  const result = await tool(writer, 'star', star),
    receipt = result.receipt as ActionReceipt;
  expect(receipt.canUndo).toBe(true);
  expect(result.undo_id).toBe(receipt.id);
  expect(await tool(writer, 'star', star)).toEqual(result);
  expect(
    (await other.callTool({ name: 'undo', arguments: { undo_id: receipt.id, confirm: true } }))
      .structuredContent,
  ).toMatchObject({ status: 404 });
  expect(
    (await writer.callTool({ name: 'star', arguments: { ...star, starred: false } }))
      .structuredContent,
  ).toMatchObject({ status: 409 });
  const undone = await tool(writer, 'undo', { undo_id: receipt.id, confirm: true });
  expect(undone.receipt).toMatchObject({ status: 'undone', canUndo: false });
  expect(await tool(await connect(first.token), 'star', star)).toEqual(undone);
  expect((await tool(writer, 'get_item', { id: 1 })).starred_at).toBeNull();
  const tag = await tool(writer, 'tag', {
    id: 1,
    add: ['Agent tag'],
    confirm: true,
    request_id: 'worker-agent-tag-0001',
  });
  expect((await tool(writer, 'get_item', { id: 1 })).tags).toMatchObject([{ name: 'Agent tag' }]);
  await tool(writer, 'undo', { undo_id: tag.undo_id, confirm: true });
  const preview = await tool(writer, 'mark_read', { target: { kind: 'reader', view: 'all' } });
  expect(preview.updated).toBe(53);
  const readResult = await tool(writer, 'mark_read', {
    target: { kind: 'reader', view: 'all' },
    revision: preview.revision,
    confirm: true,
    request_id: 'worker-agent-read-0001',
  });
  expect((await tool(writer, 'list_unread')).total).toBe(0);
  await tool(writer, 'undo', { undo_id: readResult.undo_id, confirm: true });
  expect((await tool(writer, 'list_unread')).total).toBe(53);
});

it('pages redacted activity and preserves receipt expiry without exposing arguments or originals', async () => {
  const created = await token('write', 'Audit writer'),
    client = await connect(created.token);
  const written = await tool(client, 'star', star);
  for (let i = 0; i < 22; i++)
    await tool(client, 'search_items', { query: 'private-query-marker' });
  const first = await data<{ items: AgentActivity[]; next: number | null }>(
    '/api/agent-access/actions',
  );
  expect(first.items).toHaveLength(20);
  expect(first.next).not.toBeNull();
  const second = await data<{ items: AgentActivity[]; next: number | null }>(
    `/api/agent-access/actions?before=${first.next}`,
  );
  expect(second.items).toHaveLength(3);
  expect(second.next).toBeNull();
  expect(second.items.at(-1)!.receipt).toEqual(written.receipt);
  expect(JSON.stringify([...first.items, ...second.items])).not.toMatch(
    /private-query-marker|untrusted-protocol-client-name|Raw private original|_lease|args_json|undo_json/,
  );
  expect(first.items[0]).toMatchObject({ agent: 'Audit writer', summary: 'Searched the library.' });
  at += 31000;
  const expired = await data<{ items: AgentActivity[] }>(
    `/api/agent-access/actions?before=${first.next}`,
  );
  expect(expired.items.at(-1)!.receipt).toMatchObject({ canUndo: false, expiresAt: null });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM agent_action_changes').first()).toEqual({
    n: 0,
  });
  expect((await request('/api/agent-access/actions?before=bad')).status).toBe(400);
});

it('awaits actual asynchronous grant admission before running a tool', async () => {
  const created = await token('write');
  const services = cloudflareLibraryServices(env, {
    clock,
    outputBaseUrl: origin,
    capabilities: nodeServices(node).capabilities,
  });
  const connection = (await services.agentAccess.authenticate(`Bearer ${created.token}`))!;
  const current = services.agentAccess.current.bind(services.agentAccess);
  vi.spyOn(services.agentAccess, 'current').mockImplementation(async (id) => {
    await services.agentAccess.revoke(id);
    return current(id);
  });
  const tools = brewToolCatalog(services, connection);
  const response = await tools.find((x) => x.name === 'get_item')!.execute({ id: 1 });
  expect(response).toMatchObject({ isError: true, structuredContent: { status: 403 } });
  expect(JSON.stringify(response)).not.toContain('Story body');
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM articles WHERE starred_at IS NOT NULL').first(),
  ).toEqual({ n: 0 });
});

it('journals real MCP subscriptions and refuses a token revoked during feed discovery', async () => {
  const created = await token('write'),
    client = await connect(created.token);
  const subscribed = await tool(client, 'add_feed', {
    url: 'https://source.example.test/new-feed',
    confirm: true,
    request_id: 'worker-agent-feed-0001',
  });
  expect(subscribed.receipt).toMatchObject({ kind: 'add_feed', canUndo: true });
  expect(
    await env.DB.prepare('SELECT title FROM feeds WHERE url=?')
      .bind('https://source.example.test/new-feed')
      .first(),
  ).toEqual({ title: 'Added source' });
  await tool(client, 'undo', { undo_id: subscribed.undo_id, confirm: true });
  expect(
    await env.DB.prepare('SELECT id FROM feeds WHERE url=?')
      .bind('https://source.example.test/new-feed')
      .first(),
  ).toBeNull();
  const pending = client.callTool({
    name: 'add_feed',
    arguments: {
      url: 'https://source.example.test/hold-feed',
      confirm: true,
      request_id: 'worker-revoked-feed-001',
    },
  });
  await vi.waitFor(
    async () => {
      const response = await env.UPSTREAM.fetch('https://source.example.test/hold-status');
      expect(await response.json()).toEqual({ pending: true });
    },
    { interval: 20, timeout: 2000 },
  );
  await data(`/api/agent-access/tokens/${created.entry.id}`, 'DELETE', {});
  await env.UPSTREAM.fetch('https://source.example.test/hold-release');
  expect(await pending).toMatchObject({ isError: true, structuredContent: { status: 403 } });
  expect(
    await env.DB.prepare('SELECT id FROM feeds WHERE url=?')
      .bind('https://source.example.test/hold-feed')
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS n FROM agent_actions WHERE json_type(result_json,'$.kind') IS NOT NULL",
    ).first(),
  ).toEqual({ n: 1 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM agent_action_changes').first()).toEqual({
    n: 0,
  });
});

it('uses the actual shared WebMCP owner flow only when enabled and keeps the instance guide capability-specific', async () => {
  expect((await request('/api/webmcp/tools')).status).toBe(501);
  const catalog = await request('/api/webmcp/tools', 'GET', undefined, { 'x-review-webmcp': '1' });
  expect((await catalog.json()) as unknown[]).toHaveLength(12);
  const body = { name: 'star', arguments: star };
  expect(
    (
      await request('/api/webmcp/call', 'POST', body, {
        'x-review-webmcp': '1',
        origin: 'https://evil.test',
      })
    ).status,
  ).toBe(403);
  const response = await request('/api/webmcp/call', 'POST', body, { 'x-review-webmcp': '1' });
  expect(response.status).toBe(200);
  const result = (await response.json()) as { structuredContent: { receipt: ActionReceipt } };
  expect(result.structuredContent.receipt.canUndo).toBe(true);
  const activity = await data<{ items: AgentActivity[] }>('/api/agent-access/actions');
  expect(activity.items[0]).toMatchObject({
    agent: 'WebMCP',
    receipt: { id: result.structuredContent.receipt.id },
  });
  await data(`/api/actions/${result.structuredContent.receipt.id}/undo`, 'POST');
  const guide = await request('/llms.txt'),
    text = await guide.text();
  expect(text).toContain('MCP: http.');
  expect(text).toContain('WebMCP: disabled.');
  expect(text).toContain('Authorization: Bearer');
  expect(text).not.toMatch(/Private story|Private Edition|token_hash/);
  expect(
    (await worker.fetch(origin + '/llms.txt', { method: 'HEAD' })).headers.get('x-robots-tag'),
  ).toBe('noindex, nofollow');
});
