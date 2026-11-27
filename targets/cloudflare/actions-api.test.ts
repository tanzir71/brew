import { NodeActionStorage } from '../node/src/ports/action-storage.js';
import { ActionsService } from '../../packages/core/src/actions.js';
import { AsyncActionsService } from '../../packages/core/src/async-actions-service.js';
import { CloudflareActionJournal } from './src/action-journal.js';
import { nodeRegex } from '../node/src/ports/runtime.js';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import { createApp, nodeServices } from '../node/src/app.js';
import { openDatabase } from '../node/src/db/database.js';
import type { ReaderTestEnv } from './test/reader-worker.js';
import type { ActionReceipt, ActionContext } from '../../packages/core/src/actions.js';
import { defaultNewsletterSettings } from '../../packages/core/src/types/newsletters.js';
import { newBrewSection, defaultDelivery } from '../../packages/core/src/composition-model.js';
import { ruleCopySource } from '../../packages/core/src/rule-copy.js';
import { actionsUpstream } from './test/actions-upstream.js';
import { CloudflareActionStorage } from './src/action-storage.js';
import { CloudflareStorage } from './src/storage.js';
import type { D1PreparedStatement } from '@cloudflare/workers-types';

const now = Date.parse('2026-11-27T12:00:00Z'),
  origin = 'https://brew.example.test';
const server = createTestHarness({
  workers: [
    {
      config: {
        name: 'brew-actions-test',
        main: fileURLToPath(new URL('./test/actions-worker.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        compatibility_flags: ['nodejs_compat'],
        workers_dev: false,
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'actions-test',
            database_id: '00000000-0000-0000-0000-000000000001',
            migrations_dir: fileURLToPath(
              new URL('../../packages/db/migrations/', import.meta.url),
            ),
          },
        ],
        r2_buckets: [{ binding: 'IMAGES', bucket_name: 'actions-test-images' }],
        services: [{ binding: 'UPSTREAM', service: 'brew-actions-upstream-test' }],
      },
    },
    {
      config: {
        name: 'brew-actions-upstream-test',
        main: fileURLToPath(new URL('./test/actions-upstream.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        workers_dev: false,
      },
    },
  ],
});
const worker = server.getWorker<ReaderTestEnv>('brew-actions-test');
let env: ReaderTestEnv,
  node: Awaited<ReturnType<typeof createApp>>,
  database: ReturnType<typeof openDatabase>,
  at: number;
const clock = { now: () => new Date(at), monotonic: () => 0 };
const draft = {
  name: 'Triage',
  enabled: true,
  scope: {},
  conditions: [{ field: 'title' as const, operator: 'contains' as const, value: 'Story' }],
  matchType: 'all' as const,
  actions: [{ type: 'star' as const }],
  stopProcessing: false,
};
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
  await env.UPSTREAM.fetch('https://upstream.example.test/reset');
  await env.DB.exec(
    'DELETE FROM agent_actions; DELETE FROM api_tokens; DELETE FROM reader_sessions; DELETE FROM reader_access; DELETE FROM settings; DELETE FROM feeds; DELETE FROM folders; DELETE FROM tags; DELETE FROM rules; DELETE FROM brew_configs; DELETE FROM sqlite_sequence;',
  );
  database = openDatabase(':memory:');
  node = await createApp({
    database,
    logger: false,
    publicUrl: origin,
    clock,
    fetcher: async (input, init) => actionsUpstream(new Request(input, init)),
  });
  const seed: Array<{ sql: string; values: unknown[] }> = [];
  seed.push({
    sql: 'INSERT INTO folders(id,title,created_at) VALUES(1,?,?)',
    values: ['Research', now],
  });
  seed.push({
    sql: "INSERT INTO feeds(id,title,url,folder_id,created_at) VALUES(1,'Source','https://source.example.test/rss',1,?)",
    values: [now],
  });
  seed.push({
    sql: "INSERT INTO feeds(id,title,url,kind,settings_json,retention_days,created_at) VALUES(2,'Publisher Ω','mailto:publisher@example.test','newsletter',?,90,?)",
    values: [JSON.stringify(defaultNewsletterSettings()), now],
  });
  seed.push({ sql: "INSERT INTO tags(id,name,color) VALUES(1,'Keep','#000000')", values: [] });
  for (let id = 1; id <= 8; id++)
    seed.push({
      sql: 'INSERT INTO articles(id,feed_id,guid,hash,title,url,content_html,raw_html,published_at,fetched_at,read_at,starred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      values: [
        id,
        id < 5 ? 1 : 2,
        `g-${id}`,
        `h-${id}`,
        `Story ${id}`,
        `https://source.example.test/${id}`,
        '<p>Story body.</p>',
        id < 5 ? null : '<p>Raw letter.</p>',
        id < 5 ? now : now - 40 * 86400000,
        now,
        id === 2 ? now : null,
        id === 6 ? now : null,
      ],
    });
  seed.push({ sql: 'INSERT INTO article_tags VALUES(7,1)', values: [] });
  seed.push({
    sql: 'INSERT INTO rules(id,name,enabled,position,match_type,scope_json,conditions_json,actions_json,stop_processing,created_at,updated_at) VALUES(1,?,1,0,?,?,?,?,0,?,?)',
    values: [
      draft.name,
      draft.matchType,
      JSON.stringify(draft.scope),
      JSON.stringify(draft.conditions),
      JSON.stringify(draft.actions),
      now,
      now,
    ],
  });
  seed.push({
    sql: 'INSERT INTO brew_configs(id,name,enabled,sections_json,timezone,schedule_json,delivery_json,composition_version,created_at) VALUES(1,?,0,?,?,?,?,2,?)',
    values: [
      'Edition',
      JSON.stringify([newBrewSection('manual')]),
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
  await node.close();
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
async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await request(path, method, body);
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json() as Promise<T>;
}
async function action(input: unknown, context?: ActionContext): Promise<ActionReceipt> {
  const expected = await nodeServices(node).actions!.run(input, context);
  const response = context
    ? await request('/__review/token', 'POST', input, { 'x-review-token': String(context.tokenId) })
    : await request('/api/actions', 'POST', input);
  expect(response.status, await response.clone().text()).toBe(200);
  const actual = (await response.json()) as ActionReceipt;
  expect(actual).toEqual(expected);
  return actual;
}
async function undo(id: number) {
  const expected = await nodeServices(node).actions!.undo(id);
  const actual = await json<ActionReceipt>(`/api/actions/${id}/undo`, 'POST');
  expect(actual).toEqual(expected);
  return actual;
}
async function rows(table: string) {
  return (
    await env.DB.prepare(
      `SELECT * FROM ${table} ORDER BY 1${table === 'article_tags' ? ',2' : ''}`,
    ).all()
  ).results;
}
async function equivalent(normalizeFixtureError = false) {
  for (const table of [
    'feeds',
    'folders',
    'articles',
    'article_tags',
    'tags',
    'rules',
    'brew_configs',
    'rule_logs',
  ]) {
    // SQLite-generated creation times use each database's wall clock. Public
    // contracts and fixture-authored timestamps are checked separately.
    const comparable = (values: Array<Record<string, unknown>>) =>
      values.map((row) =>
        Object.fromEntries(
          Object.entries(row)
            .filter(([name]) => !['created_at', 'updated_at', 'executed_at'].includes(name))
            .map(([name, value]) => [
              name,
              normalizeFixtureError && name === 'actions_taken_json' && typeof value === 'string'
                ? value.replaceAll(
                    'D1_ERROR: fixture failure: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)',
                    'fixture failure',
                  )
                : value,
            ]),
        ),
      );
    expect(comparable(await rows(table)), table).toEqual(
      comparable(
        database.sqlite
          .prepare(`SELECT * FROM ${table} ORDER BY 1${table === 'article_tags' ? ',2' : ''}`)
          .all() as Array<Record<string, unknown>>,
      ),
    );
  }
}
async function clean() {
  expect(
    (
      await env.DB.prepare(
        "SELECT key FROM settings WHERE key='brew_active_action' OR key LIKE 'newsletter_update:%'",
      ).all()
    ).results,
  ).toEqual([]);
}
async function both(sql: string, values: unknown[] = []) {
  database.sqlite.prepare(sql).run(...values);
  await env.DB.prepare(sql)
    .bind(...values)
    .run();
}

it('uses shared confirmation/validation and creates redacted private receipts for real state/tag changes and Undo', async () => {
  for (const input of [
    { kind: 'star_item', id: 1, starred: true },
    { kind: 'star_item', id: 0, starred: true, confirm: true },
    { kind: 'tag_item', id: 1, add: ['x'], remove: ['x'], confirm: true },
    { kind: 'star_item', id: 1, starred: true, confirm: true, requestId: 'invalid' },
  ]) {
    const expected = await node.inject({ method: 'POST', url: '/api/actions', payload: input });
    const actual = await request('/api/actions', 'POST', input);
    expect(actual.status).toBe(expected.statusCode);
    expect(await actual.json()).toEqual(expected.json());
  }
  const star = await action({
    kind: 'star_item',
    id: 1,
    starred: true,
    confirm: true,
    requestId: 'star_request_123456',
  });
  await equivalent();
  const tag = await action({
    kind: 'tag_item',
    id: 1,
    add: ['New secret tag'],
    remove: ['Keep'],
    confirm: true,
    requestId: 'tags_request_123456',
  });
  await equivalent();
  const stored = JSON.stringify(await rows('agent_actions'));
  expect(stored).not.toContain('New secret tag');
  expect(stored).not.toContain('Story body');
  await both("UPDATE articles SET title='Later unrelated title' WHERE id=1");
  await undo(tag.id);
  await undo(star.id);
  await equivalent();
  expect((await request('/api/actions')).headers.get('cache-control')).toBe('private, no-store');
  await clean();
});

it('replays identical committed and undone requests across fresh invocations and rejects different arguments', async () => {
  const input = {
    kind: 'star_item',
    id: 1,
    starred: true,
    confirm: true,
    requestId: 'replay_request_123456',
  };
  const replies = await Promise.all([
    request('/api/actions', 'POST', input),
    request('/api/actions', 'POST', input),
  ]);
  const receipts = await Promise.all(
    replies.map(async (response) => {
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json() as Promise<ActionReceipt>;
    }),
  );
  expect(receipts[0]).toEqual(receipts[1]);
  expect(await rows('agent_actions')).toHaveLength(1);
  expect(await json('/api/actions', 'POST', input)).toEqual(receipts[0]);
  expect((await request('/api/actions', 'POST', { ...input, starred: false })).status).toBe(409);
  const id = receipts[0]!.id;
  const undone = await Promise.all([
    json(`/api/actions/${id}/undo`, 'POST'),
    json(`/api/actions/${id}/undo`, 'POST'),
  ]);
  expect(undone[0]).toEqual(undone[1]);
  expect(await json('/api/actions', 'POST', input)).toEqual(undone[0]);
  expect(await rows('agent_action_changes')).toEqual([]);
  await clean();
});

it('shares pure read previews and rejects stale scopes before writing, including explicit hidden/private IDs', async () => {
  for (const target of [
    { kind: 'items', ids: [8, 1, 2, 999] },
    { kind: 'reader', view: 'all' },
    { kind: 'reader', view: 'all', feedId: 2 },
  ]) {
    const expected = await nodeServices(node).actions!.previewRead(target);
    expect(await json('/api/actions/mark-read/preview', 'POST', target)).toEqual(expected);
  }
  const target = { kind: 'reader', view: 'all' },
    preview = await json<{ revision: string }>('/api/actions/mark-read/preview', 'POST', target);
  await both('UPDATE articles SET read_at=? WHERE id=1', [now]);
  expect(
    (
      await request('/api/actions', 'POST', {
        kind: 'mark_read',
        target,
        revision: preview.revision,
        confirm: true,
      })
    ).status,
  ).toBe(409);
  expect(await rows('agent_actions')).toEqual([]);
  const current = await json<{ revision: string }>(
    '/api/actions/mark-read/preview',
    'POST',
    target,
  );
  const receipt = await action({
    kind: 'mark_read',
    target,
    revision: current.revision,
    confirm: true,
  });
  await equivalent();
  await undo(receipt.id);
  await equivalent();
  await clean();
});

it.each(['delete_feed', 'delete_folder', 'delete_rule'] as const)(
  'commits %s and its cascade history with a durable reversible receipt',
  async (kind) => {
    await both(
      "INSERT INTO rule_logs(rule_id,article_id,actions_taken_json,executed_at) VALUES(1,1,'[]',?)",
      [now],
    );
    const result = await action({ kind, id: 1, confirm: true });
    await equivalent();
    await undo(result.id);
    await equivalent();
    await clean();
  },
);

it('imports complete OPML atomically, preserves duplicate counts and performs a real no-op replay and Undo', async () => {
  const opml = `<opml><body><outline text="Imported">${Array.from({ length: 130 }, (_, index) => `<outline text="Feed ${index}" xmlUrl="https://import.example.test/${index}"/>`).join('')}</outline><outline xmlUrl="https://source.example.test/rss"/></body></opml>`;
  const imported = await action({
    kind: 'import_opml',
    opml,
    confirm: true,
    requestId: 'import_request_123456',
  });
  expect(imported.imported).toBe(130);
  await equivalent();
  const noop = await action({
    kind: 'import_opml',
    opml,
    confirm: true,
    requestId: 'import_other_123456',
  });
  expect(noop.canUndo).toBe(false);
  expect(noop.imported).toBe(0);
  await undo(imported.id);
  await equivalent();
  await clean();
});

it('subscribes through actual discovery and journals the resulting feed identity without fetching inside activation', async () => {
  const receipt = await action({
    kind: 'add_feed',
    url: 'https://added.example.test/rss',
    folderId: 1,
    confirm: true,
    requestId: 'subscribe_request_123456',
  });
  expect(receipt.targetId).toBe(3);
  await equivalent();
  await undo(receipt.id);
  await equivalent();
  await clean();
});

it('creates reviewed rules without executing them, checks saved Copy revisions and protects later execution history', async () => {
  const created = await action({ kind: 'create_rule', draft, confirm: true });
  expect((await rows('articles'))[0]!.starred_at).toBeNull();
  await undo(created.id);
  const source = (await nodeServices(node).rules.list())[0]!;
  const input = { kind: 'copy_rule', id: 1, definition: ruleCopySource(source), confirm: true };
  const copied = await action(input);
  expect((await rows('rules')).find((row) => row.id === copied.targetId)!.enabled).toBe(0);
  await equivalent();
  await both(
    "INSERT INTO rule_logs(rule_id,article_id,actions_taken_json,executed_at) VALUES(?,1,'[]',?)",
    [copied.targetId, now],
  );
  expect((await request(`/api/actions/${copied.id}/undo`, 'POST')).status).toBe(409);
  await both("UPDATE rules SET name='Changed' WHERE id=1");
  expect((await request('/api/actions', 'POST', input)).status).toBe(409);
  await clean();
});

it('commits sender review, Brew routing and retention in one journal and restores originals, protected letters and settings', async () => {
  const patch = { retentionDays: 7, brewId: 1, onlyInBrew: true };
  const preview = await json<{ revision: string }>(
    '/api/newsletters/senders/2/preview',
    'POST',
    patch,
  );
  const changed = await action({
    kind: 'update_sender',
    id: 2,
    patch,
    revision: preview.revision,
    confirm: true,
  });
  expect(changed.lettersRemoved).toBe(2);
  expect(changed.originalsRemoved).toBe(4);
  await equivalent();
  await undo(changed.id);
  await equivalent();
  await clean();
});

it('rolls receipt, state, routing and journal data back after forced writes fail, then allows a corrected retry', async () => {
  await env.DB.exec(
    "CREATE TRIGGER fail_action BEFORE INSERT ON article_tags WHEN new.article_id=1 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
  );
  const input = {
    kind: 'tag_item',
    id: 1,
    add: ['Atomic'],
    confirm: true,
    requestId: 'failed_request_123456',
  };
  try {
    expect((await request('/api/actions', 'POST', input)).status).toBe(500);
  } finally {
    await env.DB.exec('DROP TRIGGER fail_action');
  }
  expect(await rows('agent_actions')).toEqual([]);
  expect(await rows('agent_action_changes')).toEqual([]);
  expect((await rows('tags')).map((row) => row.name)).toEqual(['Keep']);
  await clean();
  await action(input);
  await equivalent();
});

it('applies the shared rule executor with durable local effects and logs, then restores only its local changes', async () => {
  const actions = [
    { type: 'star' },
    { type: 'mark_read' },
    { type: 'add_tag', tag: 'Rule tag' },
    { type: 'webhook', url: 'https://upstream.example.test/hook' },
    { type: 'notify' },
  ];
  await both('UPDATE rules SET actions_json=? WHERE id=1', [JSON.stringify(actions)]);
  const receipt = await action({
    kind: 'apply_rule',
    id: 1,
    days: 90,
    confirm: true,
    requestId: 'apply_request_123456',
  });
  expect(receipt.externalEffects).toBe(true);
  expect(receipt.matched).toBe(8);
  await equivalent();
  expect(
    (await env.UPSTREAM.fetch('https://upstream.example.test/stats').then((response) =>
      response.json(),
    )) as unknown[],
  ).toHaveLength(8);
  await undo(receipt.id);
  await equivalent();
  expect((await rows('tags')).some((row) => row.name === 'Rule tag')).toBe(true);
  await clean();
});

it('keeps an actual rule application pending across invocations, refuses Undo while active and never repeats its external work', async () => {
  await both('UPDATE rules SET scope_json=?,actions_json=? WHERE id=1', [
    JSON.stringify({ feedIds: [1] }),
    JSON.stringify([{ type: 'webhook', url: 'https://upstream.example.test/hold' }]),
  ]);
  const input = {
      kind: 'apply_rule',
      id: 1,
      days: 1,
      confirm: true,
      requestId: 'pending_request_123456',
    },
    running = request('/api/actions', 'POST', input);
  await vi.waitFor(async () => {
    const stats = (await env.UPSTREAM.fetch('https://upstream.example.test/stats').then(
      (response) => response.json(),
    )) as unknown[];
    expect(stats.length).toBeGreaterThan(0);
  });
  const pending = await json<ActionReceipt>('/api/actions', 'POST', input);
  expect(pending.status).toBe('pending');
  expect(pending.canUndo).toBe(false);
  expect((await request(`/api/actions/${pending.id}/undo`, 'POST')).status).toBe(409);
  // The running application keeps the rule definition it already selected.
  await env.DB.prepare('UPDATE rules SET scope_json=? WHERE id=1')
    .bind(JSON.stringify({ feedIds: [999] }))
    .run();
  await env.UPSTREAM.fetch('https://upstream.example.test/release');
  const response = await running;
  expect(response.status, await response.clone().text()).toBe(200);
  const completed = (await response.json()) as ActionReceipt;
  expect(completed.status).toBe('complete');
  expect(completed.matched).toBe(4);
  const calls = (await env.UPSTREAM.fetch('https://upstream.example.test/stats').then((response) =>
    response.json(),
  )) as Array<{ body: { article: { id: number } } }>;
  expect(calls.map((call) => call.body.article.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  expect(await rows('agent_actions')).toHaveLength(1);
  await clean();
}, 15000);

it('admits only live write tokens for supported changes and scopes Undo to the originating token', async () => {
  await both(
    "INSERT INTO api_tokens(id,name,token_hash,scopes,expires_at,created_at) VALUES(1,'Writer','one','write',?,?),(2,'Other','two','write',?,?),(3,'Reader','three','read',?,?)",
    [now + 60000, now, now + 60000, now, now + 60000, now],
  );
  const input = {
    kind: 'star_item',
    id: 1,
    starred: true,
    confirm: true,
    requestId: 'token_request_123456',
  };
  expect((await request('/__review/token', 'POST', input, { 'x-review-token': '3' })).status).toBe(
    403,
  );
  const receipt = await action(input, { agent: 'mcp', tokenId: 1 });
  expect(
    (await request('/__review/undo', 'POST', { id: receipt.id }, { 'x-review-token': '2' })).status,
  ).toBe(404);
  expect(
    (
      await request(
        '/__review/token',
        'POST',
        { kind: 'delete_feed', id: 1, confirm: true },
        { 'x-review-token': '1' },
      )
    ).status,
  ).toBe(403);
  await both('DELETE FROM api_tokens WHERE id=1');
  expect((await request('/__review/token', 'POST', input, { 'x-review-token': '1' })).status).toBe(
    403,
  );
  await clean();
});

it('rechecks token authorization in the commit transaction after preparation and rolls back the receipt on revocation', async () => {
  await both(
    "INSERT INTO api_tokens(id,name,token_hash,scopes,expires_at,created_at) VALUES(1,'Writer','one','write',?,?)",
    [now + 60000, now],
  );
  class RacingStorage extends CloudflareStorage {
    fired = false;
    override async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
      if (!this.fired && statements.length >= 4) {
        this.fired = true;
        await env.DB.prepare('DELETE FROM api_tokens WHERE id=1').run();
      }
      return super.batch<T>(statements);
    }
  }
  const storage = new RacingStorage(env.DB),
    actions = new CloudflareActionStorage(storage, {
      clock,
      fetcher: fetch,
      regex: nodeRegex,
      notify: () => {},
    });
  await expect(
    actions.run({
      kind: 'star_item',
      id: 1,
      starred: true,
      confirm: true,
      actor: 'mcp',
      tokenId: 1,
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(storage.fired).toBe(true);
  expect(await rows('agent_actions')).toEqual([]);
  expect((await rows('articles'))[0]!.starred_at).toBeNull();
  const controller = new AbortController();
  class CancelledStorage extends CloudflareStorage {
    admissions = 0;
    override async first<T>(sql: string, values: unknown[] = []) {
      const result = await super.first<T>(sql, values);
      if (sql.startsWith('SELECT 1 WHERE') && ++this.admissions === 2) controller.abort();
      return result;
    }
  }
  const cancelled = new CloudflareActionStorage(new CancelledStorage(env.DB), {
    clock,
    fetcher: fetch,
    regex: nodeRegex,
    notify: () => {},
  });
  await expect(
    cancelled.run({
      kind: 'star_item',
      id: 1,
      starred: true,
      confirm: true,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await rows('agent_actions')).toEqual([]);
  expect((await rows('articles'))[0]!.starred_at).toBeNull();
  await clean();
});

it('expires only finished/interrupted Undo payloads and exposes a persisted interrupted application honestly', async () => {
  const record = {
    kind: 'apply_rule',
    targetId: 1,
    summary: 'Applying…',
    status: 'pending',
    externalEffects: false,
    _lease: { runner: 'interrupted', until: now + 15000 },
  };
  await env.DB.prepare(
    'INSERT INTO agent_actions(id,agent,tool,args_json,result_json,undo_json,created_at) VALUES(1,?,?,?,?,?,?)',
  )
    .bind(
      'web',
      'apply_rule',
      '{}',
      JSON.stringify(record),
      JSON.stringify({ version: 1, expiresAt: now + 30000 }),
      now,
    )
    .run();
  await new CloudflareActionJournal(new CloudflareStorage(env.DB)).transaction({
    actionId: 1,
    at: now,
    queries: [{ sql: 'UPDATE articles SET read_at=? WHERE id=1', values: [now] }],
  });
  at = now + 16000;
  const recent = await json<ActionReceipt[]>('/api/actions');
  expect(recent[0]!.status).toBe('failed');
  expect(recent[0]!.canUndo).toBe(true);
  expect(recent[0]).not.toHaveProperty('_lease');
  expect((await json<ActionReceipt>('/api/actions/1/undo', 'POST')).status).toBe('undone');
  expect((await rows('articles'))[0]!.read_at).toBeNull();
  await env.DB.prepare(
    'INSERT INTO agent_actions(id,agent,tool,args_json,result_json,undo_json,created_at) VALUES(2,?,?,?,?,?,?)',
  )
    .bind(
      'web',
      'apply_rule',
      '{}',
      JSON.stringify(record),
      JSON.stringify({ version: 1, expiresAt: now + 30000 }),
      now,
    )
    .run();
  at = now + 31000;
  expect((await json<ActionReceipt[]>('/api/actions'))[0]!.canUndo).toBe(false);
  expect((await rows('agent_actions'))[1]!.undo_json).toBeNull();
  expect((await request('/api/actions/2/undo', 'POST')).status).toBe(410);
  await clean();
});

it('records partial rule failures, preserves successful local effects, and replays without repeating failed webhooks', async () => {
  const actions = [
    { type: 'add_tag', tag: 'Reusable partial' },
    { type: 'star' },
    { type: 'mark_read' },
    { type: 'webhook', url: 'https://upstream.example.test/fail' },
  ];
  await both('UPDATE rules SET actions_json=? WHERE id=1', [JSON.stringify(actions)]);
  const trigger =
    "CREATE TRIGGER fail_partial BEFORE INSERT ON article_tags WHEN new.article_id=1 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;";
  database.sqlite.exec(trigger);
  await env.DB.exec(trigger);
  const input = {
    kind: 'apply_rule',
    id: 1,
    days: 90,
    confirm: true,
    requestId: 'partial_request_123456',
  };
  let receipt: ActionReceipt;
  try {
    receipt = await action(input);
  } finally {
    database.sqlite.exec('DROP TRIGGER fail_partial');
    await env.DB.exec('DROP TRIGGER fail_partial');
  }
  expect(receipt.status).toBe('failed');
  expect(receipt.failedActions).toBe(9);
  expect(JSON.parse(String((await rows('rule_logs'))[0]!.actions_taken_json))[0].error).toContain(
    'fixture failure',
  );
  // Keep the driver-specific wrapper around this deliberately raised SQLite error
  // outside the shared action semantics comparison; preserve every other field.
  await equivalent(true);
  const stats = (await env.UPSTREAM.fetch('https://upstream.example.test/stats').then((response) =>
    response.json(),
  )) as unknown[];
  expect(stats).toHaveLength(16);
  expect(await json('/api/actions', 'POST', input)).toEqual(receipt);
  expect(
    await env.UPSTREAM.fetch('https://upstream.example.test/stats').then((response) =>
      response.json(),
    ),
  ).toEqual(stats);
  await undo(receipt.id);
  await equivalent();
  await clean();
});

it('cancels prepared subscriptions and rejects Reader credential rotation during discovery before any receipt or write', async () => {
  for (const scenario of ['cancel', 'reader'] as const) {
    if (scenario === 'reader')
      await both(
        "INSERT INTO reader_access(id,username,salt,password_hash,fever_hash,generation,created_at) VALUES(1,'reader','salt','password','fever','generation',?)",
        [now],
      );
    const input = {
      kind: 'add_feed',
      url: 'https://cancel.example.test/rss',
      folderId: null,
      confirm: true,
    };
    const makeFetcher =
      (rotate: () => Promise<void>, controller: AbortController) =>
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await actionsUpstream(new Request(input, init));
        if (scenario === 'cancel') controller.abort();
        else await rotate();
        return response;
      };
    const nodeController = new AbortController(),
      workerController = new AbortController();
    const nodeActions = new ActionsService(
      new NodeActionStorage(
        database,
        clock,
        makeFetcher(async () => {
          database.sqlite.prepare("UPDATE reader_access SET generation='rotated'").run();
        }, nodeController),
      ),
    );
    const workerActions = new AsyncActionsService(
      new CloudflareActionStorage(new CloudflareStorage(env.DB), {
        clock,
        fetcher: makeFetcher(async () => {
          await env.DB.prepare("UPDATE reader_access SET generation='rotated'").run();
        }, workerController),
        regex: nodeRegex,
        notify: () => {},
      }),
    );
    const context = (controller: AbortController) =>
      scenario === 'reader'
        ? { agent: 'reader' as const, readerGeneration: 'generation' }
        : { agent: 'mcp' as const, signal: controller.signal };
    await expect(nodeActions.run(input, context(nodeController))).rejects.toMatchObject({
      status: scenario === 'cancel' ? 409 : 403,
    });
    await expect(workerActions.run(input, context(workerController))).rejects.toMatchObject({
      status: scenario === 'cancel' ? 409 : 403,
    });
    await nodeActions.drain();
    await workerActions.drain();
    expect(await rows('agent_actions')).toEqual([]);
    expect(await rows('feeds')).toHaveLength(2);
    await clean();
  }
});

it('confirms, journals and undoes a complete 50000-item read action through the actual Worker routes', async () => {
  const seed = `WITH RECURSIVE ids(id) AS (SELECT 1000 UNION ALL SELECT id+1 FROM ids WHERE id<50999) INSERT INTO articles(id,feed_id,guid,hash,title,url,published_at,fetched_at) SELECT id,1,'g-'||id,'h-'||id,'Bulk '||id,'https://source.example.test/'||id,${now},${now} FROM ids`;
  database.sqlite.exec(seed);
  await env.DB.exec(seed);
  const target = { kind: 'items', ids: Array.from({ length: 50000 }, (_, index) => 1000 + index) };
  const preview = await json<{ revision: string; updated: number }>(
    '/api/actions/mark-read/preview',
    'POST',
    target,
  );
  expect(preview.updated).toBe(50000);
  expect(preview).toEqual(await nodeServices(node).actions!.previewRead(target));
  const receipt = await action({
    kind: 'mark_read',
    target,
    revision: preview.revision,
    confirm: true,
    requestId: 'bulk_request_123456',
  });
  expect(receipt.updated).toBe(50000);
  expect(
    (await env.DB.prepare(
      'SELECT count(*) AS n FROM articles WHERE id>=1000 AND read_at IS NOT NULL',
    ).first<{ n: number }>())!.n,
  ).toBe(50000);
  await undo(receipt.id);
  expect(
    (await env.DB.prepare(
      'SELECT count(*) AS n FROM articles WHERE id>=1000 AND read_at IS NULL',
    ).first<{ n: number }>())!.n,
  ).toBe(50000);
  expect(await rows('agent_action_changes')).toEqual([]);
  await clean();
}, 30000);

it('renews and fences a long sequence of external rule actions between local writes', async () => {
  await env.DB.prepare('UPDATE rules SET conditions_json=?,actions_json=? WHERE id=1')
    .bind(
      JSON.stringify([{ field: 'title', operator: 'equals', value: 'Story 1' }]),
      JSON.stringify(
        Array.from({ length: 3 }, () => ({
          type: 'webhook',
          url: 'https://upstream.example.test/elapsed',
        })),
      ),
    )
    .run();
  let requests = 0;
  const storage = new CloudflareActionStorage(new CloudflareStorage(env.DB), {
    clock,
    regex: nodeRegex,
    notify: () => {},
    fetcher: async () => {
      requests++;
      at += 12000;
      const pending = await storage.receipt(1);
      expect(pending.status).toBe('pending');
      expect(pending.canUndo).toBe(false);
      return new Response(null, { status: 204 });
    },
  });
  const receipt = await storage.run({
    kind: 'apply_rule',
    id: 1,
    days: 90,
    confirm: true,
    requestId: 'elapsed_request_123456',
  });
  expect(requests).toBe(3);
  expect(receipt.status).toBe('complete');
  expect(receipt.canUndo).toBe(true);
  expect(receipt.expiresAt).toBe(new Date(at + 30000).toISOString());
  await clean();
});

it('cannot revive a stalled rule runner after expired Undo data has been purged', async () => {
  await env.DB.prepare('UPDATE rules SET conditions_json=?,actions_json=? WHERE id=1')
    .bind(
      JSON.stringify([{ field: 'title', operator: 'equals', value: 'Story 1' }]),
      JSON.stringify([
        { type: 'star' },
        { type: 'webhook', url: 'https://upstream.example.test/stalled' },
        { type: 'mark_read' },
      ]),
    )
    .run();
  const storage = new CloudflareActionStorage(new CloudflareStorage(env.DB), {
    clock,
    regex: nodeRegex,
    notify: () => {},
    fetcher: async () => {
      at += 31000;
      await storage.cleanup();
      return new Response(null, { status: 204 });
    },
  });
  const receipt = await storage.run({
    kind: 'apply_rule',
    id: 1,
    days: 90,
    confirm: true,
    requestId: 'stalled_request_123456',
  });
  expect(receipt.status).toBe('failed');
  expect(receipt.canUndo).toBe(false);
  const article = (await rows('articles'))[0]!;
  expect(article.starred_at).toBeNull();
  expect(article.read_at).toBeNull();
  expect(await rows('agent_action_changes')).toEqual([]);
  expect((await rows('agent_actions'))[0]!.undo_json).toBeNull();
  await clean();
});
