import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, nodeServices } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { articles, feeds, articleTags } from './src/db/schema.js';
import { createApi } from '../../packages/api/src/app.js';
import type { ApiServices } from '../../packages/api/src/ports.js';
import { createBrewMcpHandler } from '../../packages/api/src/mcp.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';

const closes: Array<() => Promise<unknown>> = [];
const removals: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
  for (const remove of removals.splice(0)) await remove();
});
const rule = {
  name: 'MCP rule',
  enabled: false,
  matchType: 'all',
  scope: {},
  conditions: [{ field: 'title', operator: 'contains', value: 'MCP' }],
  actions: [{ type: 'star' }],
  stopProcessing: false,
};
async function fixture(
  options: { filename?: string; seed?: boolean; fetcher?: typeof fetch } = {},
) {
  const database = openDatabase(options.filename ?? ':memory:');
  let time = Date.now();
  const fetcher =
    options.fetcher ??
    vi.fn(
      async () =>
        new Response(
          '<rss version="2.0"><channel><title>MCP added source</title><link>https://feed.example.test</link><description>Test feed</description></channel></rss>',
          { headers: { 'content-type': 'application/rss+xml' } },
        ),
    );
  const app = await createApp({
    database,
    fetcher,
    logger: false,
    clock: { now: () => new Date(time), monotonic: () => 0 },
  });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const client = new Client({ name: 'brew-contract', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base)));
  const close = async () => {
    await client.close();
    await app.close();
  };
  closes.push(close);
  if (options.seed !== false) {
    const feed = database.db
      .insert(feeds)
      .values({
        title: 'MCP source',
        url: 'https://private.example.test/rss?token=private-feed-token',
      })
      .returning()
      .get();
    for (let n = 1; n <= 3; n++)
      database.db
        .insert(articles)
        .values({
          feedId: feed.id,
          guid: `mcp-${n}`,
          hash: `mcp-${n}`,
          title: `MCP story ${n}`,
          url: `https://story.example.test/${n}`,
          publishedAt: new Date(time - n * 1000),
          contentHtml: '<p>Clean story content.</p>',
          rawHtml: 'private-original-marker',
          hidden: n === 3,
        })
        .run();
  }
  return {
    app,
    base,
    client,
    database,
    fetcher,
    close,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
function data(result: CallToolResult) {
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  return result.structuredContent!;
}
const call = (client: Client, name: string, args: Record<string, unknown> = {}) =>
  client.callTool({ name, arguments: args });
async function disk() {
  const dir = await mkdtemp(join(tmpdir(), 'brew-mcp-'));
  const filename = join(dir, 'library.db');
  // Delete only the explicit files created in this test's own unique directory.
  removals.push(async () => {
    for (const path of [filename, `${filename}-wal`, `${filename}-shm`])
      await rm(path, { force: true });
    await rmdir(dir);
  });
  return { dir, filename };
}

describe('Brew MCP', () => {
  it('serves legacy streamable HTTP negotiation and rejects malformed transport requests privately', async () => {
    const f = await fixture();
    const headers = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
    };
    const initialized = await f.app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'legacy-owner', version: '1' },
        },
      },
    });
    expect(initialized.statusCode).toBe(200);
    expect(initialized.body).toContain('2025-11-25');
    const listed = await f.app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).toContain('search_items');
    for (const method of ['GET', 'DELETE'] as const)
      expect(
        (
          await f.app.inject({
            method,
            url: '/mcp',
            headers: { accept: headers.accept, 'mcp-protocol-version': '2025-11-25' },
          })
        ).statusCode,
      ).toBe(405);
    const invalid = await f.app.inject({ method: 'POST', url: '/mcp', headers, payload: '{' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.headers['cache-control']).toBe('private, no-store');
  });
  it('negotiates real HTTP, advertises every tool, pages read-only results and returns sanitized Markdown and dry runs', async () => {
    const f = await fixture();
    const config = nodeServices(f.app).brews;
    const draft = {
      name: 'MCP edition',
      enabled: true,
      timezone: 'Asia/Dhaka',
      schedule: { kind: 'daily' as const, time: '07:00' },
      delivery: defaultDelivery(),
      sections: [{ ...newBrewSection('Stories'), sources: [{ kind: 'today' as const }] }],
    };
    const saved = await config.createComposition(draft);
    await config.generateComposition(saved.id);
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    const tools = await f.client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual([
      'search_items',
      'list_unread',
      'get_item',
      'mark_read',
      'star',
      'tag',
      'add_feed',
      'create_rule',
      'list_brews',
      'get_brew',
      'preview_brew',
      'undo',
    ]);
    expect(tools.tools.find((t) => t.name === 'get_item')?.annotations?.readOnlyHint).toBe(true);
    const first = data(await call(f.client, 'list_unread', { limit: 1 }));
    expect(first.total).toBe(2);
    expect(first.next_cursor).toBeTypeOf('string');
    const second = data(
      await call(f.client, 'list_unread', { limit: 1, cursor: first.next_cursor }),
    );
    expect(JSON.stringify(second.items)).not.toBe(JSON.stringify(first.items));
    expect(data(await call(f.client, 'search_items', { query: 'MCP' })).total).toBe(2);
    const item = await call(f.client, 'get_item', { id: 1 });
    expect(data(item).markdown).toMatch(/^# MCP story 1/);
    expect(item.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Clean story content.'),
    });
    expect(JSON.stringify(item)).not.toContain('private-original-marker');
    expect(data(await call(f.client, 'create_rule', { draft: rule }))).toMatchObject({
      dry_run: true,
      total: 2,
      limit: 50,
    });
    const preview = data(
      await call(f.client, 'preview_brew', { id: saved.id, at: new Date().toISOString() }),
    );
    expect(preview.snapshot).toMatchObject({ id: 0 });
    const brew = data(await call(f.client, 'get_brew', { id: saved.id }));
    expect(brew.brew).not.toHaveProperty('delivery');
    expect(brew.issue).toMatchObject({ brewConfigId: saved.id });
    expect(data(await call(f.client, 'list_brews')).items).toHaveLength(1);
    const review = data(
      await call(f.client, 'mark_read', { target: { kind: 'items', ids: [1, 2] } }),
    );
    expect(review).toMatchObject({ updated: 2, requires_confirmation: true });
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('drives list → Markdown read → reviewed mark_read → durable Undo and preserves replay identity', async () => {
    const f = await fixture();
    await call(f.client, 'list_unread');
    await call(f.client, 'get_item', { id: 1 });
    const target = { kind: 'items', ids: [1] };
    const review = data(await call(f.client, 'mark_read', { target }));
    const args = {
      target,
      revision: review.revision,
      confirm: true,
      request_id: 'mcp-read-contract-001',
    };
    const written = data(await call(f.client, 'mark_read', args));
    expect(written.undo_id).toBeTypeOf('number');
    expect(data(await call(f.client, 'get_item', { id: 1 })).read_at).toBeTypeOf('string');
    expect(data(await call(f.client, 'mark_read', args)).undo_id).toBe(written.undo_id);
    expect((await call(f.client, 'undo', { undo_id: written.undo_id })).isError).toBe(true);
    const undone = data(await call(f.client, 'undo', { undo_id: written.undo_id, confirm: true }));
    expect(undone.receipt).toMatchObject({ status: 'undone' });
    expect(data(await call(f.client, 'get_item', { id: 1 })).read_at).toBeNull();
    expect(
      data(await call(f.client, 'undo', { undo_id: written.undo_id, confirm: true })).receipt,
    ).toMatchObject({ status: 'undone' });
    expect(data(await call(f.client, 'mark_read', args)).receipt).toMatchObject({
      status: 'undone',
    });
    expect(data(await call(f.client, 'get_item', { id: 1 })).read_at).toBeNull();
    const row = f.database.sqlite.prepare('SELECT agent,args_json FROM agent_actions').get();
    expect(row).toMatchObject({ agent: 'mcp' });
    expect(JSON.stringify(row)).not.toContain('"ids"');
  });

  it('journals star and named tags, restores actual state, and protects tags used by later work', async () => {
    const f = await fixture();
    const star = data(
      await call(f.client, 'star', { id: 1, confirm: true, request_id: 'mcp-star-contract-001' }),
    );
    await f.app.inject({ method: 'PATCH', url: '/api/articles/1', payload: { read: true } });
    expect(
      data(await call(f.client, 'undo', { undo_id: star.undo_id, confirm: true })).receipt,
    ).toMatchObject({ status: 'undone' });
    expect(data(await call(f.client, 'get_item', { id: 1 }))).toMatchObject({
      starred_at: null,
      read_at: expect.any(String),
    });
    const tagged = data(
      await call(f.client, 'tag', {
        id: 1,
        add: ['MCP tag'],
        confirm: true,
        request_id: 'mcp-tag-contract-001',
      }),
    );
    expect((await f.app.inject('/api/tags')).json()).toHaveLength(1);
    await call(f.client, 'undo', { undo_id: tagged.undo_id, confirm: true });
    expect((await f.app.inject('/api/tags')).json()).toHaveLength(0);
    const later = data(
      await call(f.client, 'tag', {
        id: 1,
        add: ['Shared tag'],
        confirm: true,
        request_id: 'mcp-tag-contract-002',
      }),
    );
    const tag = (await f.app.inject('/api/tags')).json()[0];
    f.database.db.insert(articleTags).values({ articleId: 2, tagId: tag.id }).run();
    const conflict = await call(f.client, 'undo', { undo_id: later.undo_id, confirm: true });
    expect(conflict.isError).toBe(true);
    expect(conflict.structuredContent).toMatchObject({ status: 409 });
    expect(data(await call(f.client, 'get_item', { id: 1 })).tags).toHaveLength(1);
    expect(data(await call(f.client, 'get_item', { id: 2 })).tags).toHaveLength(1);
  });

  it('creates a rule only after explicit opt-in, replays once, and undoes only an unchanged unexecuted rule', async () => {
    const f = await fixture();
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    expect((await call(f.client, 'create_rule', { draft: rule, dry_run: false })).isError).toBe(
      true,
    );
    expect(
      (
        await call(f.client, 'create_rule', {
          draft: {
            ...rule,
            conditions: [{ field: 'title', operator: 'matches_regex', value: '[' }],
          },
        })
      ).isError,
    ).toBe(true);
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    const args = {
      draft: rule,
      dry_run: false,
      confirm: true,
      request_id: 'mcp-rule-contract-001',
    };
    const written = data(await call(f.client, 'create_rule', args));
    expect(data(await call(f.client, 'create_rule', args)).undo_id).toBe(written.undo_id);
    const rows = (await f.app.inject('/api/rules')).json();
    expect(rows).toHaveLength(1);
    expect(data(await call(f.client, 'get_item', { id: 1 })).starred_at).toBeNull();
    await call(f.client, 'undo', { undo_id: written.undo_id, confirm: true });
    expect((await f.app.inject('/api/rules')).json()).toHaveLength(0);
    const next = data(
      await call(f.client, 'create_rule', { ...args, request_id: 'mcp-rule-contract-002' }),
    );
    const changed = (await f.app.inject('/api/rules')).json()[0];
    await f.app.inject({
      method: 'PUT',
      url: `/api/rules/${changed.id}`,
      payload: { ...changed, name: 'Later rule edit' },
    });
    expect(
      (await call(f.client, 'undo', { undo_id: next.undo_id, confirm: true })).structuredContent,
    ).toMatchObject({ status: 409 });
    expect((await f.app.inject('/api/rules')).json()[0].name).toBe('Later rule edit');
  });

  it('fetches subscriptions before journaling, joins concurrent retries and preserves unrelated writes during the fetch', async () => {
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>((r) => {
      release = r;
    });
    const ready = new Promise<void>((r) => {
      started = r;
    });
    const fetcher = vi.fn(async () => {
      started();
      await waiting;
      return new Response(
        '<rss version="2.0"><channel><title>Added source</title><link>https://feed.example.test</link><description>Local fixture</description></channel></rss>',
      );
    });
    const f = await fixture({ fetcher });
    const args = {
      url: 'https://feed.example.test/rss?token=private-subscription-marker',
      confirm: true,
      request_id: 'mcp-feed-contract-001',
    };
    const first = call(f.client, 'add_feed', args),
      second = call(f.client, 'add_feed', args);
    try {
      await ready;
      await f.app.inject({ method: 'PATCH', url: '/api/articles/1', payload: { starred: true } });
    } finally {
      release();
    }
    const added = data(await first),
      replay = data(await second);
    expect(replay.undo_id).toBe(added.undo_id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await f.app.inject('/api/feeds')).json()).toHaveLength(2);
    const audit = f.database.sqlite
      .prepare('SELECT args_json FROM agent_actions WHERE id=?')
      .get(added.undo_id);
    expect(JSON.stringify(audit)).not.toContain('private-subscription-marker');
    await call(f.client, 'undo', { undo_id: added.undo_id, confirm: true });
    expect((await f.app.inject('/api/feeds')).json()).toHaveLength(1);
    expect(data(await call(f.client, 'get_item', { id: 1 })).starred_at).toBeTypeOf('string');
    expect(data(await call(f.client, 'add_feed', args)).receipt).toMatchObject({
      status: 'undone',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('recovers lost acknowledgements across a reopened database, rejects changed identities and expires Undo', async () => {
    const storage = await disk();
    const f = await fixture({ filename: storage.filename });
    const args = { id: 1, starred: true, confirm: true, request_id: 'mcp-reopen-contract-001' };
    const written = data(await call(f.client, 'star', args));
    await f.close();
    const g = await fixture({ filename: storage.filename, seed: false });
    expect(data(await call(g.client, 'star', args)).undo_id).toBe(written.undo_id);
    expect(
      (await call(g.client, 'star', { ...args, starred: false })).structuredContent,
    ).toMatchObject({ status: 409 });
    await call(g.client, 'undo', { undo_id: written.undo_id, confirm: true });
    expect(data(await call(g.client, 'get_item', { id: 1 })).starred_at).toBeNull();
    const next = data(
      await call(g.client, 'star', { ...args, request_id: 'mcp-reopen-contract-002' }),
    );
    g.advance(31_000);
    expect(
      (await call(g.client, 'undo', { undo_id: next.undo_id, confirm: true })).structuredContent,
    ).toMatchObject({ status: 410 });
    expect(
      g.database.sqlite.prepare('SELECT count(*) AS n FROM agent_action_changes').get(),
    ).toEqual({ n: 0 });
  });

  it('rejects unconfirmed, malformed, missing and read-only writes without mutations; defends HTTP Host/Origin', async () => {
    const f = await fixture();
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    for (const [name, args] of [
      ['star', { id: 1 }],
      ['star', { id: 1, confirm: true }],
      ['star', { id: 0, confirm: true, request_id: 'mcp-invalid-contract' }],
      [
        'tag',
        { id: 1, add: ['x'], remove: ['x'], confirm: true, request_id: 'mcp-invalid-contract' },
      ],
      ['add_feed', { url: 'file:///private', confirm: true, request_id: 'mcp-invalid-contract' }],
      ['get_item', { id: 999 }],
    ] as const)
      expect((await call(f.client, name, args)).isError).toBe(true);
    const readOnly = createBrewMcpHandler(nodeServices(f.app));
    closes.unshift(() => readOnly.close());
    const client = new Client({ name: 'read-only', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
        fetch: async (input, init) => readOnly.fetch(new Request(input, init)),
      }),
    );
    closes.unshift(() => client.close());
    expect(
      (await call(client, 'star', { id: 1, confirm: true, request_id: 'mcp-readonly-contract' }))
        .structuredContent,
    ).toMatchObject({ status: 501 });
    for (const headers of [
      { host: 'attacker.example.test' },
      { origin: 'https://attacker.example.test' },
      { origin: 'null' },
    ]) {
      const result = await f.app.inject({
        method: 'POST',
        url: '/mcp',
        headers,
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      });
      expect(result.statusCode).toBe(403);
      expect(result.headers['cache-control']).toBe('private, no-store');
    }
    const absent = await createApi({} as ApiServices).request('/mcp', { method: 'POST' });
    expect(absent.status).toBe(501);
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it('rolls failed subscription insertion back without a receipt or a fake Undo', async () => {
    const f = await fixture();
    f.database.sqlite.exec(
      "CREATE TEMP TRIGGER fail_agent_feed BEFORE INSERT ON feeds BEGIN SELECT RAISE(ABORT,'private-constraint-marker'); END",
    );
    const result = await call(f.client, 'add_feed', {
      url: 'https://feed.example.test/rss',
      confirm: true,
      request_id: 'mcp-rollback-contract',
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-constraint-marker');
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
    expect((await f.app.inject('/api/feeds')).json()).toHaveLength(1);
  });

  it('serves the same tools over the actual Node CLI stdio with a clean protocol channel outside cwd', async () => {
    const storage = await disk();
    const f = await fixture({ filename: storage.filename });
    await f.close();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        '--import',
        import.meta.resolve('tsx'),
        fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        'mcp',
      ],
      cwd: storage.dir,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (pair): pair is [string, string] => typeof pair[1] === 'string',
          ),
        ),
        BREW_DB_PATH: storage.filename,
        BREW_PUBLIC_URL: '',
        NODE_ENV: 'production',
        BREW_SMTP_PORT: 'invalid-and-ignored',
      },
      stderr: 'pipe',
    });
    let errors = '';
    transport.stderr?.on('data', (chunk) => {
      errors += String(chunk);
    });
    const client = new Client({ name: 'stdio-owner', version: '1' });
    closes.unshift(() => client.close());
    await client.connect(transport);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('preview_brew');
    expect(data(await call(client, 'list_unread')).total).toBe(2);
    const target = { kind: 'items', ids: [1] };
    const revision = data(await call(client, 'mark_read', { target })).revision;
    const written = data(
      await call(client, 'mark_read', {
        target,
        revision,
        confirm: true,
        request_id: 'mcp-stdio-contract-01',
      }),
    );
    expect(data(await call(client, 'get_item', { id: 1 })).read_at).toBeTypeOf('string');
    await call(client, 'undo', { undo_id: written.undo_id, confirm: true });
    expect(data(await call(client, 'get_item', { id: 1 })).read_at).toBeNull();
    await client.close();
    expect(errors).not.toMatch(/incoming request|listening|SMTP|Error:/);
  }, 20_000);
});
