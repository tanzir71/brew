import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import type { ReaderTestEnv } from './test/reader-worker.js';
import { openDatabase } from '../node/src/db/database.js';
import { createApp } from '../node/src/app.js';
import { NodeReaderAccess } from '../node/src/ports/reader-access.js';
import { NodeReaderSyncStorage } from '../node/src/ports/reader-sync-storage.js';
import { CloudflareStorage } from './src/storage.js';
import { CloudflareReaderSyncStorage } from './src/reader-sync-storage.js';
import { OpmlService } from '../node/src/services/opml-service.js';
import {
  googleState,
  googleLabel,
  googleItemId,
  type SyncQuery,
} from '../../packages/core/src/reader-sync.js';
import { libraryUpstream } from './test/library-upstream.js';

const now = Date.parse('2026-11-27T12:00:00Z'),
  origin = 'https://brew.example.test',
  prefix = '/api/greader/reader/api/0';
const server = createTestHarness({
  workers: [
    {
      config: {
        name: 'brew-sync-test',
        main: fileURLToPath(new URL('./test/sync-worker.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        compatibility_flags: ['nodejs_compat'],
        workers_dev: false,
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'sync-test',
            database_id: '00000000-0000-0000-0000-000000000001',
            migrations_dir: fileURLToPath(
              new URL('../../packages/db/migrations/', import.meta.url),
            ),
          },
        ],
        r2_buckets: [{ binding: 'IMAGES', bucket_name: 'sync-test-images' }],
        services: [{ binding: 'UPSTREAM', service: 'brew-sync-upstream-test' }],
      },
    },
    {
      config: {
        name: 'brew-sync-upstream-test',
        main: fileURLToPath(new URL('./test/library-upstream.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        workers_dev: false,
      },
    },
  ],
});
const worker = server.getWorker<ReaderTestEnv>('brew-sync-test');
let env: ReaderTestEnv,
  database: ReturnType<typeof openDatabase>,
  node: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  await server.listen();
  await worker.applyD1Migrations('DB');
  env = await worker.getEnv();
}, 30000);
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await env.DB.exec(
    'DELETE FROM agent_actions; DELETE FROM reader_sessions; DELETE FROM reader_access; DELETE FROM feeds; DELETE FROM folders; DELETE FROM tags; DELETE FROM settings; DELETE FROM sqlite_sequence;',
  );
  database = openDatabase(':memory:');
  node = await createApp({
    database,
    logger: false,
    publicUrl: origin,
    clock: { now: () => new Date(now), monotonic: () => 0 },
    fetcher: async (input, init) => libraryUpstream(new Request(input, init)),
  });
  const seed = [
    "INSERT INTO folders(id,title) VALUES(1,'Research / Notes')",
    "INSERT INTO feeds(id,url,title,folder_id,created_at) VALUES(1,'https://source.example.test/rss','Engineering Ω',1," +
      now +
      ')',
    "INSERT INTO feeds(id,url,title,kind,settings_json,created_at) VALUES(2,'mailto:private@example.test','Private letters','newsletter','{\"onlyInBrew\":true}'," +
      now +
      ')',
    "INSERT INTO tags(id,name,color) VALUES(1,'Brief','#ffffff')",
  ];
  const values = Array.from({ length: 205 }, (_, index) => ({
    id: index + 1,
    feed: index === 3 ? 2 : 1,
    hidden: index === 2 ? 1 : 0,
    read: index === 1 ? now : null,
    star: index === 1 ? now : null,
  }));
  values.push({ id: 4294967301, feed: 1, hidden: 0, read: null, star: null });
  seed.push(
    `INSERT INTO articles(id,feed_id,guid,hash,title,url,content_html,published_at,fetched_at,read_at,starred_at,hidden) SELECT json_extract(value,'$.id'),json_extract(value,'$.feed'),'g-'||json_extract(value,'$.id'),'h-'||json_extract(value,'$.id'),'Story '||json_extract(value,'$.id'),'https://source.example.test/'||json_extract(value,'$.id'),'<p>Hello.</p><script>steal()</script>',${now - 10000},${now - 5000},json_extract(value,'$.read'),json_extract(value,'$.star'),json_extract(value,'$.hidden') FROM json_each('${JSON.stringify(values)}')`,
  );
  seed.push('INSERT INTO article_tags(article_id,tag_id) VALUES(4294967301,1)');
  for (const sql of seed) database.sqlite.exec(sql);
  await env.DB.batch(seed.map((sql) => env.DB.prepare(sql)));
});
afterEach(async () => {
  await node.close();
});
async function request(
  path: string,
  method = 'GET',
  value?: unknown,
  headers: Record<string, string> = {},
) {
  return worker.fetch(origin + path, {
    method,
    headers: {
      ...(value === undefined ? {} : { 'content-type': 'application/json', origin }),
      ...headers,
    },
    ...(value === undefined
      ? {}
      : { body: typeof value === 'string' ? value : JSON.stringify(value) }),
  });
}
async function json(
  path: string,
  method = 'GET',
  value?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await request(path, method, value, headers);
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}
async function auth() {
  const credentials = (await json('/api/reader-access', 'POST', { username: 'reader' })) as {
    username: string;
    password: string;
  };
  const login = await request(
    '/api/greader/accounts/ClientLogin',
    'POST',
    new URLSearchParams({ Email: credentials.username, Passwd: credentials.password }).toString(),
    { 'content-type': 'application/x-www-form-urlencoded' },
  );
  expect(login.status, await login.clone().text()).toBe(200);
  const token = /^Auth=(.+)$/m.exec(await login.text())![1]!,
    authorization = `GoogleLogin auth=${token}`;
  const writeToken = await (
    await request(prefix + '/token', 'GET', undefined, { authorization })
  ).text();
  return {
    credentials,
    token,
    authorization,
    writeToken,
    key: createHash('md5').update(`reader:${credentials.password}`).digest('hex'),
  };
}
async function post(
  path: string,
  authorization: string,
  writeToken: string,
  values: Array<[string, string]>,
) {
  return request(
    prefix + '/' + path,
    'POST',
    new URLSearchParams([['T', writeToken], ...values]).toString(),
    {
      'content-type': 'application/x-www-form-urlencoded',
      ...(authorization ? { authorization } : {}),
    },
  );
}
async function table(name: string) {
  return (await env.DB.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()).results;
}
async function state() {
  return {
    articles: await table('articles'),
    tags: await table('tags'),
    joins: await table('article_tags'),
  };
}
async function noMarkers() {
  expect(
    (
      await env.DB.prepare(
        "SELECT key FROM settings WHERE key LIKE 'reader_change:%' OR key LIKE 'reader_label:%'",
      ).all()
    ).results,
  ).toEqual([]);
}

it('shares OPML review, private export, nested folders, deduplication and concurrent bulk imports with Node', async () => {
  const xml = `<opml><body><outline text="Research"><outline text="Nested &amp; calm">${Array.from({ length: 125 }, (_, id) => `<outline text="Feed ${id}" xmlUrl="https://opml.example.test/${id}?secret=private#fragment"/>`).join('')}</outline></outline><outline xmlUrl="https://opml.example.test/0?secret=private"/><outline xmlUrl="https://source.example.test/rss"/><outline text="Second"><outline text="A &quot;quote&quot;" htmlUrl="https://opml.example.test/?q=one&amp;two=2" xmlUrl="https://second.example.test/rss"/></outline><outline text="Unfiled" xmlUrl="https://unfiled.example.test/rss"/><outline text="Empty"/></body></opml>`;
  const opml = new OpmlService(database),
    before = await table('feeds');
  const preview = await request('/api/opml/preview', 'POST', xml, { 'content-type': 'text/xml' });
  expect(preview.status).toBe(200);
  expect(await preview.json()).toEqual(opml.preview(xml));
  expect(preview.headers.get('cache-control')).toBe('private, no-store');
  expect(await table('feeds')).toEqual(before);
  const both = (await Promise.all([
    json('/api/opml/import', 'POST', xml, { 'content-type': 'text/xml' }),
    json('/api/opml/import', 'POST', xml, { 'content-type': 'text/xml' }),
  ])) as Array<{ imported: number; skipped: number; foldersCreated: number }>;
  expect(both.map((item) => item.imported).sort((a, b) => a - b)).toEqual([0, 127]);
  expect(both.reduce((sum, item) => sum + item.foldersCreated, 0)).toBe(2);
  expect(opml.import(xml)).toEqual({ imported: 127, skipped: 2, foldersCreated: 2 });
  const exported = await request('/api/opml/export');
  expect(await exported.text()).toBe(opml.export());
  expect(exported.headers.get('cache-control')).toBe('private, no-store');
  expect(opml.export()).not.toContain('mailto:');
  expect(await json('/api/opml/preview', 'POST', xml, { 'content-type': 'text/xml' })).toEqual(
    opml.preview(xml),
  );
});

it('rejects malformed and oversized OPML before writes and rolls back newly created folders with a failed import', async () => {
  const before = await table('feeds'),
    folders = await table('folders');
  for (const xml of [
    '<not-opml/>',
    '<opml><body><outline xmlUrl="file:///private"/></body></opml>',
    'x'.repeat(1000001),
  ])
    expect(
      (await request('/api/opml/import', 'POST', xml, { 'content-type': 'text/xml' })).status,
    ).toBe(400);
  await env.DB.exec(
    "CREATE TRIGGER fail_opml BEFORE INSERT ON feeds WHEN new.title='Reject' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
  );
  try {
    expect(
      (
        await request(
          '/api/opml/import',
          'POST',
          '<opml><body><outline text="New folder"><outline text="Reject" xmlUrl="https://reject.example.test/rss"/></outline></body></opml>',
          { 'content-type': 'text/xml' },
        )
      ).status,
    ).toBe(400);
  } finally {
    await env.DB.exec('DROP TRIGGER fail_opml');
  }
  expect(await table('feeds')).toEqual(before);
  expect(await table('folders')).toEqual(folders);
});

it('uses native Worker crypto for Node-compatible app credentials and persistent session/write-token verifiers', async () => {
  expect((await request('/api/reader-access', 'POST', { username: 'bad name' })).status).toBe(400);
  expect(
    (
      await request(
        '/api/reader-access',
        'POST',
        { username: 'reader' },
        { origin: 'https://other.example.test' },
      )
    ).status,
  ).toBe(403);
  const f = await auth();
  const access = (await table('reader_access'))[0]!;
  database.sqlite
    .prepare(
      'INSERT INTO reader_access(id,username,salt,password_hash,fever_hash,generation,created_at) VALUES(1,?,?,?,?,?,?)',
    )
    .run(
      access.username,
      access.salt,
      access.password_hash,
      access.fever_hash,
      access.generation,
      access.created_at,
    );
  const native = new NodeReaderAccess(database, () => now);
  expect(native.login(f.credentials.username, f.credentials.password)).toMatch(/^brs_/);
  expect(native.fever(f.key)?.generation).toBe(access.generation);
  const nodeToken = native.login(f.credentials.username, f.credentials.password)!;
  const nodeSession = database.sqlite
    .prepare('SELECT * FROM reader_sessions WHERE token_hash=?')
    .get(createHash('sha256').update(nodeToken).digest('hex')) as {
    token_hash: string;
    write_hash: string;
    generation: string;
    expires_at: number;
    created_at: number;
  };
  await env.DB.prepare(
    'INSERT INTO reader_sessions(token_hash,write_hash,generation,expires_at,created_at) VALUES(?,?,?,?,?)',
  )
    .bind(
      nodeSession.token_hash,
      nodeSession.write_hash,
      nodeSession.generation,
      nodeSession.expires_at,
      nodeSession.created_at,
    )
    .run();
  expect(
    (
      await request(prefix + '/subscription/list', 'GET', undefined, {
        authorization: `GoogleLogin auth=${nodeToken}`,
      })
    ).status,
  ).toBe(200);
  const sessions = await table('reader_sessions');
  for (const row of sessions)
    database.sqlite
      .prepare(
        'INSERT OR REPLACE INTO reader_sessions(token_hash,write_hash,generation,expires_at,created_at) VALUES(?,?,?,?,?)',
      )
      .run(row.token_hash, row.write_hash, row.generation, row.expires_at, row.created_at);
  expect(native.session(f.authorization)?.username).toBe('reader');
  expect(native.writeToken(native.session(f.authorization)!)).toBe(f.writeToken);
  expect(f.writeToken).toBe(
    createHmac('sha256', f.token).update('brew-reader-write-v1').digest('hex'),
  );
  for (const secret of [f.token, f.writeToken, f.key, f.credentials.password]) {
    expect(JSON.stringify(access)).not.toContain(secret);
    expect(JSON.stringify(sessions)).not.toContain(secret);
  }
  const response = await request('/api/reader-access');
  expect(await response.json()).toEqual({
    enabled: true,
    username: 'reader',
    serverUrl: origin,
    googleReaderUrl: origin + '/api/greader',
    feverUrl: origin + '/api/fever',
  });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(
    (await request('/api/feeds', 'GET', undefined, { authorization: f.authorization })).status,
  ).toBe(403);
  expect(
    (await request('/api/reader-access', 'GET', undefined, { authorization: `Bearer ${f.token}` }))
      .status,
  ).toBe(403);
  expect(
    (await json(prefix + '/subscription/list', 'GET', undefined, {
      authorization: f.authorization,
    })) as object,
  ).toHaveProperty('subscriptions');
});

it('matches Node Google Reader streams, contents, labels, metadata and complete stable cursor pages without read writes', async () => {
  const f = await auth(),
    native = new NodeReaderSyncStorage(database, () => now),
    storage = new CloudflareReaderSyncStorage(new CloudflareStorage(env.DB), () => now),
    before = await state();
  expect(await storage.metadata()).toEqual(native.metadata());
  const queries: SyncQuery[] = [
    { limit: 17 },
    { streams: [{ kind: 'unread' }], exclude: [{ kind: 'starred' }], limit: 13 },
    { streams: [{ kind: 'label', name: 'Brief' }] },
    { streams: [{ kind: 'feed', id: 2 }] },
    { ids: [4, 4294967301] },
    {
      streams: Array.from({ length: 100 }, () => ({ kind: 'feed', id: 1 })),
      exclude: Array.from({ length: 100 }, () => ({ kind: 'read' })),
      ids: Array.from({ length: 10000 }, (_, index) => index + 1),
      idsOnly: true,
    },
  ];
  for (const query of queries) expect(await storage.items(query)).toEqual(native.items(query));
  for (const oldest of [false, true]) {
    let cursor: string | undefined;
    const seen: number[] = [];
    do {
      const query = { oldest, limit: 19, cursor };
      const page = await storage.items(query);
      expect(page).toEqual(native.items(query));
      seen.push(...page.items.map((item) => item.id));
      cursor = page.continuation;
    } while (cursor);
    expect(seen.length).toBe(204);
    expect(new Set(seen).size).toBe(204);
  }
  const page = (await json(
    prefix + '/stream/contents/user/-/state/com.google/reading-list?n=19',
    'GET',
    undefined,
    { authorization: f.authorization },
  )) as { items: Array<{ id: string; summary: { content: string } }> };
  expect(page.items[0]!.id).toBe(googleItemId(4294967301));
  expect(page.items[0]!.summary.content).toBe('<p>Hello.</p>');
  for (const operation of ['subscription/list', 'unread-count', 'tag/list', 'user-info'])
    expect(
      (
        await request(prefix + '/' + operation, 'GET', undefined, {
          authorization: f.authorization,
        })
      ).status,
    ).toBe(200);
  expect(
    (
      await request(prefix + '/stream/contents?c=malformed', 'GET', undefined, {
        authorization: f.authorization,
      })
    ).status,
  ).toBe(400);
  expect(await state()).toEqual(before);
  const exported = await request(prefix + '/subscription/export', 'GET', undefined, {
    authorization: f.authorization,
  });
  expect(await exported.text()).toBe(new OpmlService(database).export());
  await noMarkers();
});

it('commits set-based Reader state and tag changes atomically, preserves timestamps and matches Node idempotence', async () => {
  const f = await auth(),
    native = new NodeReaderSyncStorage(database, () => now),
    storage = new CloudflareReaderSyncStorage(new CloudflareStorage(env.DB), () => now);
  for (const patch of [
    { read: true, starred: true, add: ['New tag', 'Brief'] },
    { read: true, starred: true, add: ['New tag', 'Brief'] },
    { read: false, starred: false, remove: ['Brief'] },
  ]) {
    const query = { ids: Array.from({ length: 10000 }, (_, index) => index + 1) };
    expect(await storage.change(query, patch)).toBe(native.change(query, patch));
    expect(
      await storage.items({
        limit: 1000,
        streams: [
          { kind: 'feed', id: 1 },
          { kind: 'feed', id: 2 },
        ],
      }),
    ).toEqual(
      native.items({
        limit: 1000,
        streams: [
          { kind: 'feed', id: 1 },
          { kind: 'feed', id: 2 },
        ],
      }),
    );
  }
  const changed = await post('edit-tag', f.authorization, f.writeToken, [
    ['i', '4294967301'],
    ['a', googleState('read')],
    ['a', googleLabel('Unicode Ω')],
  ]);
  expect(changed.status, await changed.clone().text()).toBe(200);
  native.change({ ids: [4294967301] }, { read: true, add: ['Unicode Ω'] });
  expect(await storage.items({ ids: [4294967301] })).toEqual(native.items({ ids: [4294967301] }));
  expect(
    (
      await post('edit-tag', '', f.writeToken, [
        ['i', '4294967301'],
        ['r', googleState('read')],
      ])
    ).status,
  ).toBe(200);
  expect(
    (
      await post('edit-tag', f.authorization, 'wrong', [
        ['i', '1'],
        ['a', googleState('read')],
      ])
    ).status,
  ).toBe(403);
  expect(
    (
      await post('edit-tag', f.authorization, 'x', [
        ['i', '1'],
        ['a', googleState('read')],
      ])
    ).status,
  ).toBe(200);
  expect(
    (
      await post('edit-tag', '', 'x', [
        ['i', '1'],
        ['a', googleState('read')],
      ])
    ).status,
  ).toBe(401);
  await noMarkers();
});

it('rolls back state, tags, revisions and transaction markers after a failed write and rejects a revoked generation', async () => {
  const f = await auth(),
    storage = new CloudflareReaderSyncStorage(new CloudflareStorage(env.DB), () => now),
    before = await state(),
    revision = await env.DB.prepare(
      "SELECT value FROM settings WHERE key='library_revision'",
    ).first();
  await env.DB.exec(
    "CREATE TRIGGER fail_sync BEFORE INSERT ON article_tags WHEN new.article_id=1 BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
  );
  try {
    expect(
      (
        await post('edit-tag', f.authorization, f.writeToken, [
          ['i', '1'],
          ['a', googleState('read')],
          ['a', googleLabel('Rollback')],
        ])
      ).status,
    ).toBe(503);
  } finally {
    await env.DB.exec('DROP TRIGGER fail_sync');
  }
  expect(await state()).toEqual(before);
  expect(
    await env.DB.prepare("SELECT value FROM settings WHERE key='library_revision'").first(),
  ).toEqual(revision);
  await noMarkers();
  const old = String((await table('reader_access'))[0]!.generation);
  await json('/api/reader-access', 'POST', { username: 'rotated' });
  await expect(
    storage.change({ ids: [1], generation: old }, { read: true, add: ['Revoked'] }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(storage.editFeed(1, 'Revoked', null, old)).rejects.toMatchObject({ status: 403 });
  await expect(storage.label('create', 'Revoked', undefined, old)).rejects.toMatchObject({
    status: 403,
  });
  expect(await state()).toEqual(before);
  expect(
    (
      await request(prefix + '/subscription/list', 'GET', undefined, {
        authorization: f.authorization,
      })
    ).status,
  ).toBe(401);
  await noMarkers();
});

it('matches Node label/feed edits, handles missing and conflicting labels, and preserves atomic folder/tag renames', async () => {
  await auth();
  const generation = String((await table('reader_access'))[0]!.generation),
    storage = new CloudflareReaderSyncStorage(new CloudflareStorage(env.DB), () => now),
    native = new NodeReaderSyncStorage(database, () => now);
  for (const [action, name, destination] of [
    ['create', 'Added', undefined],
    ['rename', 'Added', 'Moved'],
    ['rename', 'Brief', 'Renamed tag'],
    ['rename', 'Moved', 'Moved'],
    ['remove', 'Moved', undefined],
  ] as const) {
    await storage.label(action, name, destination, generation);
    native.label(action, name, destination);
    expect(await storage.metadata()).toEqual(native.metadata());
  }
  await expect(storage.label('remove', 'Missing', undefined, generation)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    storage.label('rename', 'Renamed tag', 'Research / Notes', generation),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    storage.label('rename', 'Renamed tag', 'x'.repeat(101), generation),
  ).rejects.toMatchObject({ status: 400 });
  await expect(storage.label('rename', 'Renamed tag', '', generation)).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    storage.label('rename', 'Renamed tag', '😀'.repeat(60), generation),
  ).rejects.toMatchObject({ status: 400 });
  await storage.editFeed(1, 'Renamed feed', null, generation);
  database.sqlite
    .prepare('INSERT INTO reader_access SELECT 1,?,?,?,?,?,?')
    .run('reader', 'salt', 'password', 'fever', generation, now);
  native.editFeed(1, 'Renamed feed', null, generation);
  expect((await storage.metadata()).feeds[0]!.title).toBe('Renamed feed');
  expect((await storage.metadata()).feeds[0]!.folderId).toBeNull();
  await noMarkers();
});

it('executes Fever forms against the same sanitized library and persisted read/star state across fresh invocations', async () => {
  const f = await auth();
  const fever = async (query: string, fields: Record<string, string> = {}) =>
    json(
      '/api/fever?api&' + query,
      'POST',
      new URLSearchParams({ api_key: f.key, ...fields }).toString(),
      { 'content-type': 'application/x-www-form-urlencoded' },
    );
  const result = (await fever('groups&feeds&items&unread_item_ids&saved_item_ids')) as {
    auth: number;
    items: Array<{ id: number; html: string }>;
    unread_item_ids: string;
  };
  expect(result.auth).toBe(1);
  expect(result.items).toHaveLength(50);
  expect(result.items[0]!.id).toBe(4294967301);
  expect(result.items[0]!.html).toBe('<p>Hello.</p>');
  expect(result.unread_item_ids.split(',')).not.toContain('4');
  await fever('', { mark: 'item', as: 'saved', id: '1' });
  expect(((await json('/api/articles/1')) as { starredAt: string | null }).starredAt).toBe(
    new Date(now).toISOString(),
  );
  await fever('', { mark: 'feed', as: 'read', id: '1', before: String(Math.floor(now / 1000)) });
  expect(((await fever('unread_item_ids')) as { unread_item_ids: string }).unread_item_ids).toBe(
    '',
  );
  expect(
    await json('/api/fever?api', 'POST', 'api_key=wrong', {
      'content-type': 'application/x-www-form-urlencoded',
    }),
  ).toEqual({ api_version: 3, auth: 0 });
  await request('/api/reader-access', 'DELETE', undefined, { origin });
  expect(((await fever('feeds')) as { auth: number }).auth).toBe(0);
  expect(((await json('/api/reader-access')) as { enabled: boolean }).enabled).toBe(false);
});

it('persists the shared login/Fever failure window across invocations and performs subscription actions with durable Undo', async () => {
  const f = await auth();
  const unavailable = await post('subscription/quickadd', f.authorization, f.writeToken, [
    ['quickadd', 'https://upstream.example.test/rss'],
  ]);
  expect(unavailable.status, await unavailable.clone().text()).toBe(200);
  expect((await table('feeds')).length).toBe(3);
  const undoId = unavailable.headers.get('x-brew-undo-id');
  expect(undoId).toMatch(/^[1-9]\d*$/);
  expect((await request(`/api/actions/${undoId}/undo`, 'POST')).status).toBe(200);
  expect((await table('feeds')).length).toBe(2);
  for (let index = 0; index < 30; index++) {
    const response = await request(
      '/api/greader/accounts/ClientLogin',
      'POST',
      'Email=reader&Passwd=wrong',
      { 'content-type': 'application/x-www-form-urlencoded' },
    );
    expect(response.status).toBe(401);
  }
  expect(
    (
      await request('/api/fever?api', 'POST', `api_key=${f.key}`, {
        'content-type': 'application/x-www-form-urlencoded',
      })
    ).status,
  ).toBe(429);
  expect(
    (
      await request('/api/fever?api', 'POST', `api_key=${f.key}`, {
        'content-type': 'application/x-www-form-urlencoded',
        'x-review-now': String(now + 60001),
      })
    ).status,
  ).toBe(200);
});

it('bounds durable sessions at 100 and rolls back both folder and article-tag names on a failed rename', async () => {
  const f = await auth(),
    generation = String((await table('reader_access'))[0]!.generation);
  const seeded = Array.from({ length: 110 }, (_, index) => ({
    token: `old-${index}`,
    write: `write-${index}`,
    at: now - index - 1,
  }));
  await env.DB.prepare(
    "INSERT INTO reader_sessions(token_hash,write_hash,generation,expires_at,created_at) SELECT json_extract(value,'$.token'),json_extract(value,'$.write'),?,0,json_extract(value,'$.at') FROM json_each(?)",
  )
    .bind(generation, JSON.stringify(seeded))
    .run();
  const login = await request(
    '/api/greader/accounts/ClientLogin',
    'POST',
    new URLSearchParams({ Email: 'reader', Passwd: f.credentials.password }).toString(),
    { 'content-type': 'application/x-www-form-urlencoded' },
  );
  expect(login.status).toBe(200);
  expect((await table('reader_sessions')).length).toBe(100);
  await env.DB.exec(
    "INSERT INTO folders(title) VALUES('Dual'); INSERT INTO tags(name,color) VALUES('Dual','#ffffff'); CREATE TRIGGER fail_rename BEFORE UPDATE ON tags WHEN old.name='Dual' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
  );
  const storage = new CloudflareReaderSyncStorage(new CloudflareStorage(env.DB), () => now),
    before = await storage.metadata();
  try {
    await storage.label('rename', 'Dual', 'Dual', generation);
    await expect(storage.label('rename', 'Dual', 'Changed', generation)).rejects.toThrow(
      'fixture failure',
    );
  } finally {
    await env.DB.exec('DROP TRIGGER fail_rename');
  }
  expect(await storage.metadata()).toEqual(before);
  await noMarkers();
  await storage.label('rename', 'Dual', 'Changed', generation);
  expect((await storage.metadata()).folders.some((folder) => folder.title === 'Changed')).toBe(
    true,
  );
  expect((await storage.metadata()).tags.some((tag) => tag.name === 'Changed')).toBe(true);
});
