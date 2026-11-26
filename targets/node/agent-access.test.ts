import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createApp, nodeServices } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { createApi } from '../../packages/api/src/app.js';
import type { ApiServices } from '../../packages/api/src/ports.js';

const closes: Array<() => Promise<unknown>> = [];
const removals: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
  for (const remove of removals.splice(0)) await remove();
});
async function fixture(fetcher: typeof fetch = vi.fn(), filename = ':memory:') {
  const database = openDatabase(filename);
  let now = Date.now();
  const app = await createApp({
    database,
    fetcher,
    logger: false,
    clock: { now: () => new Date(now), monotonic: () => 0 },
  });
  closes.push(() => app.close());
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  database.sqlite
    .prepare("INSERT INTO feeds(url,title) VALUES('https://example.test/feed','Source')")
    .run();
  database.sqlite
    .prepare(
      "INSERT INTO articles(feed_id,guid,hash,title,url,published_at,content_html) VALUES(1,'a','a','Private article','https://example.test/story',?,'<p>Article body.</p>')",
    )
    .run(now);
  const services = nodeServices(app),
    access = services.agentAccess!;
  const connect = async (token: string) => {
    const client = new Client({ name: 'untrusted-client-label', version: '1' });
    closes.unshift(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', base), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  };
  return {
    database,
    app,
    access,
    base,
    services,
    connect,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const call = (client: Client, name: string, args: Record<string, unknown> = {}) =>
  client.callTool({ name, arguments: args });
const star = { id: 1, confirm: true, request_id: 'scoped-identity-0001' };
const rule = {
  name: 'Dangerous automation',
  enabled: true,
  matchType: 'all',
  scope: {},
  conditions: [],
  actions: [
    { type: 'hide' },
    { type: 'webhook', url: 'https://private.example.test/?secret=private-marker' },
  ],
  stopProcessing: false,
};

it('issues a high-entropy read-only secret once, stores only its hash and exports only metadata', async () => {
  const f = await fixture();
  const result = await f.app.inject({
    method: 'POST',
    url: '/api/agent-access/tokens',
    headers: { origin: 'http://localhost' },
    payload: { name: 'Codex CLI' },
  });
  expect(result.statusCode).toBe(201);
  expect(result.headers['cache-control']).toBe('private, no-store');
  const { token, entry } = result.json();
  expect(token).toMatch(/^brew_ro_[\w-]{43}$/);
  expect(entry).toMatchObject({ name: 'Codex CLI', scopes: 'read', lastUsedAt: null });
  expect(Date.parse(entry.expiresAt) - Date.parse(entry.createdAt)).toBe(30 * 86400000);
  const row = f.database.sqlite.prepare('SELECT * FROM api_tokens').get() as { token_hash: string };
  expect(row.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
  expect(JSON.stringify(row)).not.toContain(token);
  for (const url of [
    '/api/agent-access/tokens',
    '/settings/agents.md',
    '/settings/agents.json',
    '/api/openapi.json',
    '/api/agent-access/actions',
  ]) {
    const output = await f.app.inject(url);
    expect(output.statusCode).toBe(200);
    expect(output.body).not.toContain(token);
    expect(output.body).not.toContain(row.token_hash);
  }
  expect(f.access.authenticate(`Bearer ${token}`)).toMatchObject({
    tokenId: entry.id,
    write: false,
  });
  expect(f.access.list()[0].lastUsedAt).not.toBeNull();
  expect(f.access.create({ name: 'Second' }).token).not.toBe(token);
});

it('requires a valid header token on every HTTP transport request and rejects expired/revoked credentials', async () => {
  const f = await fixture();
  const issued = f.access.create({ name: 'Temporary', expiresInDays: 1 });
  for (const authorization of [
    undefined,
    'Bearer invalid',
    `Basic ${issued.token}`,
    `Bearer ${issued.token}x`,
  ]) {
    const result = await f.app.inject({
      method: 'POST',
      url: `/mcp?access_token=${issued.token}`,
      headers: authorization ? { authorization } : {},
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(result.statusCode).toBe(401);
    expect(result.headers['www-authenticate']).toBe('Bearer realm="Brew MCP"');
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(result.body).not.toContain(issued.token);
  }
  f.advance(86400001);
  expect(f.access.authenticate(`Bearer ${issued.token}`)).toBeNull();
  const active = f.access.create({ name: 'Revoke me' });
  const client = await f.connect(active.token);
  expect((await call(client, 'list_brews')).isError).not.toBe(true);
  const revoked = await f.app.inject({
    method: 'DELETE',
    url: `/api/agent-access/tokens/${active.entry.id}`,
    headers: { origin: 'http://localhost' },
  });
  expect(revoked.statusCode).toBe(200);
  await expect(call(client, 'list_brews')).rejects.toThrow();
  expect(f.access.current(active.entry.id)).toBeNull();
  expect(f.access.list()).toHaveLength(1); // Expired metadata remains visible until revoked.
});

it('read scope can read and preview, refuses mutations and never exposes private arguments in the log', async () => {
  const f = await fixture();
  const token = f.access.create({ name: 'Read agent' });
  const client = await f.connect(token.token);
  expect((await call(client, 'search_items', { query: 'private-marker' })).isError).not.toBe(true);
  expect((await call(client, 'get_item', { id: 1 })).structuredContent).toHaveProperty('markdown');
  expect((await call(client, 'create_rule', { draft: rule })).structuredContent).toHaveProperty(
    'dry_run',
    true,
  );
  for (const [name, args] of [
    ['star', star],
    ['tag', { ...star, add: ['private-marker'] }],
    ['add_feed', { ...star, id: undefined, url: 'https://example.test/private-marker' }],
    ['undo', { undo_id: 1, confirm: true }],
  ] as const) {
    const reply = await call(client, name, args);
    expect(reply.isError).toBe(true);
  }
  expect(f.database.sqlite.prepare('SELECT read_at,starred_at FROM articles').get()).toEqual({
    read_at: null,
    starred_at: null,
  });
  expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM tags').get()).toEqual({ n: 0 });
  const log = f.access.activity();
  expect(log.items.length).toBeGreaterThan(3);
  expect(JSON.stringify(log)).not.toMatch(/private-marker|Article body|brew_ro_|token_hash/);
  expect(log.items.every((item) => item.agent === 'Read agent' && item.receipt === null)).toBe(
    true,
  );
});

it('isolates replay identities and Undo by token, and lets the owner Undo a token action', async () => {
  const f = await fixture();
  const first = f.access.create({ name: 'First', scopes: 'write' }),
    second = f.access.create({ name: 'Second', scopes: 'write' });
  const a = await f.connect(first.token),
    b = await f.connect(second.token);
  expect((await call(a, 'star', { id: 1 })).structuredContent).toMatchObject({ status: 428 });
  const result = (await call(a, 'star', star)).structuredContent!;
  expect((await call(a, 'star', star)).structuredContent).toHaveProperty('undo_id', result.undo_id);
  expect(
    (await call(b, 'undo', { undo_id: result.undo_id, confirm: true })).structuredContent,
  ).toMatchObject({ status: 404 });
  const other = (await call(b, 'star', star)).structuredContent!;
  expect(other.undo_id).not.toBe(result.undo_id);
  expect((await call(a, 'star', { ...star, starred: false })).structuredContent).toMatchObject({
    status: 409,
  });
  const restored = await f.app.inject({
    method: 'POST',
    url: `/api/actions/${result.undo_id}/undo`,
  });
  expect(restored.json()).toMatchObject({ status: 'undone', canUndo: false });
  expect(f.database.sqlite.prepare('SELECT starred_at FROM articles').get()).toEqual({
    starred_at: null,
  });
  expect(
    f.access.activity().items.find((item) => item.id === result.undo_id)?.receipt,
  ).toMatchObject({ status: 'undone' });
});

it('write tokens cannot delete, save enabled rules, manage tokens or fall through to owner REST', async () => {
  const f = await fixture();
  const issued = f.access.create({ name: 'Limited writer', scopes: 'write' });
  const client = await f.connect(issued.token);
  expect(
    (
      await call(client, 'create_rule', {
        draft: rule,
        dry_run: false,
        confirm: true,
        request_id: 'scoped-rule-identity',
      })
    ).structuredContent,
  ).toMatchObject({ status: 403 });
  await expect(call(client, 'delete_feed', { id: 1, confirm: true })).rejects.toThrow('not found');
  for (const [method, url, payload] of [
    ['GET', '/api/agent-access/tokens', undefined],
    ['POST', '/api/agent-access/tokens', { name: 'Escalate', scopes: 'write' }],
    ['DELETE', '/api/feeds/1', undefined],
    ['POST', '/api/actions', { kind: 'delete_feed', id: 1, confirm: true }],
    ['PUT', '/api/rules/1', rule],
    ['GET', '/api/agent-access/actions', undefined],
  ] as const) {
    const result = await f.app.inject({
      method,
      url,
      payload,
      headers: { authorization: `Bearer ${issued.token}`, origin: 'http://localhost' },
    });
    expect(result.statusCode).toBe(403);
  }
  expect(f.access.list()).toHaveLength(1);
  expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM feeds').get()).toEqual({ n: 1 });
  expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM rules').get()).toEqual({ n: 0 });
});

it('rechecks revocation after a network await before committing a subscription', async () => {
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(
    vi.fn(async () => {
      started();
      await waiting;
      return new Response(
        '<rss version="2.0"><channel><title>New feed</title><link>https://example.test</link><description>A feed</description></channel></rss>',
        { headers: { 'content-type': 'application/rss+xml' } },
      );
    }),
  );
  const issued = f.access.create({ name: 'In flight', scopes: 'write' });
  const client = await f.connect(issued.token);
  const pending = call(client, 'add_feed', {
    url: 'https://example.test/new',
    confirm: true,
    request_id: 'scoped-inflight-0001',
  });
  await ready;
  f.access.revoke(issued.entry.id);
  release();
  expect((await pending).structuredContent).toMatchObject({ status: 403 });
  expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM feeds').get()).toEqual({ n: 1 });
  expect(
    f.database.sqlite
      .prepare('SELECT count(*) AS n FROM agent_actions WHERE undo_json IS NOT NULL')
      .get(),
  ).toEqual({ n: 0 });
});

it('pages durable redacted activity without losing Undo metadata behind many reads', async () => {
  const f = await fixture();
  const issued = f.access.create({ name: 'Long log', scopes: 'write' });
  const client = await f.connect(issued.token);
  const written = (await call(client, 'star', star)).structuredContent!;
  for (let n = 0; n < 26; n++) await call(client, 'list_unread');
  const first = f.access.activity();
  expect(first.items).toHaveLength(20);
  expect(first.next).not.toBeNull();
  const second = f.access.activity(first.next!);
  expect(second.items).toHaveLength(7);
  expect(second.next).toBeNull();
  expect(second.items.find((item) => item.id === written.undo_id)?.receipt?.canUndo).toBe(true);
  f.advance(31000);
  expect(
    f.access.activity(first.next!).items.find((item) => item.id === written.undo_id)?.receipt
      ?.canUndo,
  ).toBe(false);
  expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_action_changes').get()).toEqual(
    { n: 0 },
  );
  f.access.revoke(issued.entry.id);
  expect(f.access.activity().items[0].agent).toBe('Long log');
  expect((await f.services.actions!.recent()).every((receipt) => receipt.kind)).toBe(true);
});

it('validates management input, Host and same-origin writes; absent adapters stay visibly gated', async () => {
  const f = await fixture();
  for (const payload of [
    null,
    {},
    { name: 'x', scopes: ['read'] },
    { name: 'x', scopes: 'admin' },
    { name: 'x', expiresInDays: 0 },
    { name: 'x', expiresInDays: 366 },
    { name: 'x', token: 'chosen-secret' },
    { name: '\n' },
  ]) {
    const result = await f.app.inject({
      method: 'POST',
      url: '/api/agent-access/tokens',
      headers: { origin: 'http://localhost', 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });
    expect(result.statusCode).toBe(400);
  }
  for (const headers of [
    {},
    { origin: 'https://evil.test' },
    { origin: 'null' },
    { origin: 'http://localhost', 'sec-fetch-site': 'cross-site' },
    { host: 'evil.test', origin: 'http://evil.test' },
  ]) {
    const result = await f.app.inject({
      method: 'POST',
      url: '/api/agent-access/tokens',
      headers,
      payload: { name: 'Injected' },
    });
    expect(result.statusCode).toBe(403);
    expect(result.headers['cache-control']).toBe('private, no-store');
  }
  expect(f.access.list()).toHaveLength(0);
  const absent = await createApi({} as ApiServices).request('/api/agent-access/tokens');
  expect(absent.status).toBe(501);
});

it('does not expose database details when recording private activity fails', async () => {
  const f = await fixture();
  const issued = f.access.create({ name: 'Audit failure' });
  const client = await f.connect(issued.token);
  f.database.sqlite.exec(
    "CREATE TEMP TRIGGER fail_private_audit BEFORE INSERT ON agent_actions BEGIN SELECT RAISE(ABORT,'private-audit-marker'); END",
  );
  const reply = await call(client, 'get_item', { id: 1 });
  expect(reply.structuredContent).toMatchObject({ status: 500 });
  expect(JSON.stringify(reply)).not.toContain('private-audit-marker');
  expect(f.database.sqlite.prepare('SELECT read_at FROM articles').get()).toEqual({
    read_at: null,
  });
});

it('honors scoped stdio credentials and revocation on an already connected process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brew-token-stdio-'));
  const filename = join(dir, 'library.db');
  removals.push(async () => {
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`])
      await rm(path, { force: true });
    await rmdir(dir);
  });
  const f = await fixture(undefined, filename);
  const issued = f.access.create({ name: 'Stdio reader' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--import',
      import.meta.resolve('tsx'),
      fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      'mcp',
    ],
    cwd: dir,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (pair): pair is [string, string] => typeof pair[1] === 'string',
        ),
      ),
      BREW_DB_PATH: filename,
      BREW_MCP_TOKEN: issued.token,
    },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const client = new Client({ name: 'scoped-stdio', version: '1' });
  closes.unshift(() => client.close());
  await client.connect(transport);
  expect((await call(client, 'list_unread')).isError).not.toBe(true);
  expect((await call(client, 'star', star)).structuredContent).toMatchObject({ status: 403 });
  f.access.revoke(issued.entry.id);
  expect((await call(client, 'get_item', { id: 1 })).structuredContent).toMatchObject({
    status: 403,
  });
  await client.close();
  expect(stderr).not.toContain(issued.token);
}, 20_000);
