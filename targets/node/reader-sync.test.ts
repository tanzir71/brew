import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeReaderAccess } from './src/ports/reader-access.js';
import { NodeReaderSyncStorage } from './src/ports/reader-sync-storage.js';
import {
  defaultDelivery,
  newBrewSection,
  sectionWithSources,
} from '../../packages/core/src/composition-model.js';
import { createApp, nodeServices } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import {
  googleItemId,
  syncId,
  googleLabel,
  googleState,
} from '../../packages/core/src/reader-sync.js';

const closes: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
const now = Date.parse('2026-11-26T12:00:00Z'),
  prefix = '/api/greader/reader/api/0';
async function fixture() {
  const database = openDatabase(':memory:');
  const fetcher = vi.fn(
    async () =>
      new Response(
        '<rss version="2.0"><channel><title>New subscription</title><link>https://new.example.test</link><description>Test</description></channel></rss>',
        { headers: { 'content-type': 'application/rss+xml' } },
      ),
  );
  const app = await createApp({
    database,
    logger: false,
    fetcher,
    clock: { now: () => new Date(now), monotonic: () => 0 },
  });
  closes.push(() => app.close());
  database.sqlite.exec(
    `INSERT INTO folders(title) VALUES('Research / Notes'); INSERT INTO feeds(url,title,folder_id) VALUES('https://source.example.test/rss','Engineering',1); INSERT INTO feeds(url,title,kind,settings_json) VALUES('https://letters.example.test/rss','Private letters','newsletter','{"onlyInBrew":true}'); INSERT INTO tags(name,color) VALUES('Brief','#ffffff');`,
  );
  const insert = database.sqlite.prepare(
    'INSERT INTO articles(id,feed_id,guid,hash,title,url,content_html,published_at,read_at,starred_at,hidden) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
  );
  for (const [id, feedId, read, starred, hidden] of [
    [1, 1, false, false, false],
    [2, 1, true, true, false],
    [3, 1, false, false, true],
    [4, 2, false, false, false],
    [4294967301, 1, false, false, false],
  ] as const)
    insert.run(
      id,
      feedId,
      `g-${id}`,
      `h-${id}`,
      `Story ${id}`,
      `https://source.example.test/${id}`,
      '<p>Hello.</p><script>steal()</script>',
      now - 10000,
      read ? now : null,
      starred ? now : null,
      hidden ? 1 : 0,
    );
  database.sqlite.prepare('INSERT INTO article_tags VALUES(?,1)').run(4294967301);
  database.sqlite.prepare('UPDATE articles SET fetched_at=?').run(now - 10000);
  const services = nodeServices(app);
  const configured = await app.inject({
    method: 'POST',
    url: '/api/reader-access',
    headers: { origin: 'http://localhost' },
    payload: { username: 'reader' },
  });
  expect(configured.statusCode, configured.body).toBe(200);
  const credentials = configured.json() as { username: string; password: string };
  const form = (values: Array<[string, string]>) => new URLSearchParams(values).toString();
  const logged = await app.inject({
    method: 'POST',
    url: '/api/greader/accounts/ClientLogin',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: form([
      ['Email', credentials.username],
      ['Passwd', credentials.password],
    ]),
  });
  expect(logged.statusCode, logged.body).toBe(200);
  const token = /^Auth=(.+)$/m.exec(logged.body)![1]!;
  const authorization = `GoogleLogin auth=${token}`;
  const writeToken = (await app.inject({ url: `${prefix}/token`, headers: { authorization } }))
    .body;
  const get = (path: string) =>
    app.inject({ url: `${prefix}/${path}`, headers: { authorization } });
  const post = (path: string, values: Array<[string, string]>, header = true) =>
    app.inject({
      method: 'POST',
      url: `${prefix}/${path}`,
      headers: {
        ...(header ? { authorization } : {}),
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: form([['T', writeToken], ...values]),
    });
  const key = createHash('md5')
    .update(`${credentials.username}:${credentials.password}`)
    .digest('hex');
  const fever = (query: string, values: Array<[string, string]> = []) =>
    app.inject({
      method: 'POST',
      url: `/api/fever?api&${query}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form([['api_key', key], ...values]),
    });
  return {
    app,
    database,
    services,
    credentials,
    token,
    authorization,
    writeToken,
    get,
    post,
    key,
    fever,
    fetcher,
    form,
  };
}

it('creates a separate app credential once, stores only verifiers, and never permits credential fallback', async () => {
  const f = await fixture();
  expect((await f.app.inject('/api/capabilities')).json().readerApi).toBe(true);
  const status = await f.app.inject('/api/reader-access');
  expect(status.json()).toEqual({ enabled: true, username: 'reader' });
  expect(status.headers['cache-control']).toBe('private, no-store');
  const stored = JSON.stringify(f.database.sqlite.prepare('SELECT * FROM reader_access').get());
  for (const secret of [f.credentials.password, f.key, f.token, f.writeToken])
    expect(stored).not.toContain(secret);
  const sessions = JSON.stringify(f.database.sqlite.prepare('SELECT * FROM reader_sessions').all());
  expect(sessions).not.toContain(f.token);
  expect(sessions).not.toContain(f.writeToken);
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/reader-access',
        payload: { username: 'hijack' },
      })
    ).statusCode,
  ).toBe(403);
  const mcp = f.services.agentAccess!.create({ name: 'Unrelated token', scopes: 'write' });
  expect(
    (
      await f.app.inject({
        url: `${prefix}/subscription/list`,
        headers: { authorization: `Bearer ${mcp.token}` },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (await f.app.inject({ url: '/api/feeds', headers: { authorization: `Bearer ${f.token}` } }))
      .statusCode,
  ).toBe(403);
  expect(
    (await f.app.inject({ url: '/api/reader-access', headers: { authorization: f.authorization } }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await f.app.inject({
        url: `${prefix}/subscription/list`,
        headers: { authorization: f.authorization, origin: 'https://other.example.test' },
      })
    ).statusCode,
  ).toBe(403);
  const head = await f.app.inject({
    method: 'HEAD',
    url: `${prefix}/tag/list`,
    headers: { authorization: f.authorization },
  });
  expect(head.statusCode).toBe(200);
  expect(head.body).toBe('');
  expect(head.headers['x-robots-tag']).toBe('noindex, nofollow');
});

it('drives Google Reader login, metadata, decimal/hex IDs, content, read/star writes and valid T-only clients', async () => {
  const f = await fixture();
  expect((await f.get('user-info')).json()).toMatchObject({ userId: '1', userName: 'reader' });
  const subscriptions = (await f.get('subscription/list?output=json')).json().subscriptions;
  expect(subscriptions[0]).toMatchObject({
    id: 'feed/1',
    categories: [{ id: googleLabel('Research / Notes'), label: 'Research / Notes' }],
  });
  expect((await f.get('tag/list')).json().tags).toContainEqual({
    id: googleLabel('Brief'),
    type: 'folder',
    label: 'Brief',
  });
  const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
  const refs = (
    await f.get(
      `stream/items/ids?s=${encodeURIComponent(googleState('reading-list'))}&xt=${encodeURIComponent(googleState('read'))}&n=1000`,
    )
  ).json();
  expect(refs.itemRefs.map((v: { id: string }) => v.id)).toEqual(['4294967301', '1']);
  const content = await f.post(
    'stream/items/contents',
    [
      ['i', refs.itemRefs[0].id],
      ['i', '1'],
    ],
    false,
  );
  expect(content.statusCode, content.body).toBe(200);
  expect(content.json().items[0]).toMatchObject({
    id: googleItemId(4294967301),
    origin: { streamId: 'feed/1' },
  });
  expect(content.json().items[0].summary.content).toBe('<p>Hello.</p>');
  expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  const args: Array<[string, string]> = [
    ['i', googleItemId(1)],
    ['i', '0000000100000005'],
    ['a', googleState('read')],
    ['a', googleState('starred')],
  ];
  expect((await f.post('edit-tag', args)).body).toBe('OK');
  const after = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
  expect((await f.post('edit-tag', args)).body).toBe('OK');
  expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(after);
  expect((await f.get('unread-count')).json().unreadcounts[0].count).toBe(0);
  expect(
    (
      await f.post('edit-tag', [
        ['i', '1'],
        ['r', googleState('read')],
        ['r', googleState('starred')],
      ])
    ).statusCode,
  ).toBe(200);
  expect((await f.services.articles.get(1))?.readAt).toBeNull();
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(syncId(googleItemId(4294967301))).toBe(4294967301);
});

it('pages equal-date streams without repeats after concurrent inserts, filters labels and preserves visibility', async () => {
  const f = await fixture();
  const first = (await f.get('stream/items/ids?n=1')).json();
  expect(first.itemRefs[0].id).toBe('4294967301');
  f.database.sqlite
    .prepare(
      "INSERT INTO articles(feed_id,guid,hash,title,url,published_at) VALUES(1,'later','later','Later','https://source.example.test/later',?)",
    )
    .run(now);
  const second = (
    await f.get(`stream/items/ids?n=1&c=${encodeURIComponent(first.continuation)}`)
  ).json();
  expect(second.itemRefs[0].id).toBe('2');
  const label = (
    await f.get(`stream/contents/user/-/label/${encodeURIComponent('Research / Notes')}`)
  ).json();
  expect(label.items).toHaveLength(4);
  expect(
    (await f.get('stream/contents/feed/2')).json().items.map((v: { id: string }) => v.id),
  ).toEqual([googleItemId(4)]);
  const explicit = (
    await f.post('stream/items/contents', [
      ['i', '3'],
      ['i', '4'],
    ])
  ).json();
  expect(explicit.items.map((v: { id: string }) => v.id)).toEqual([googleItemId(4)]);
  expect((await f.get('stream/items/ids?n=2&r=o&c=garbage')).statusCode).toBe(400);
});

it('rejects an invalid member or conflicting batch before any write and honors mark-all timestamps', async () => {
  const f = await fixture(),
    before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
  expect(
    (
      await f.post('edit-tag', [
        ['i', '1'],
        ['i', 'invalid'],
        ['a', googleState('read')],
      ])
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await f.post('edit-tag', [
        ['i', '1'],
        ['a', googleState('read')],
        ['r', googleState('read')],
      ])
    ).statusCode,
  ).toBe(400);
  expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  const missing = await f.app.inject({
    method: 'POST',
    url: `${prefix}/edit-tag`,
    headers: {
      authorization: f.authorization,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: 'i=1&a=user%2F-%2Fstate%2Fcom.google%2Fread',
  });
  expect(missing.statusCode).toBe(403);
  expect(
    (
      await f.post('mark-all-as-read', [
        ['s', 'feed/1'],
        ['ts', String((now - 20_000) * 1000)],
      ])
    ).statusCode,
  ).toBe(200);
  expect((await f.services.articles.get(1))?.readAt).toBeNull();
  expect(
    (
      await f.post('mark-all-as-read', [
        ['s', 'feed/1'],
        ['ts', String(now * 1000)],
      ])
    ).statusCode,
  ).toBe(200);
  expect((await f.services.articles.get(1))?.readAt).not.toBeNull();
  expect((await f.services.articles.get(3))?.readAt).toBeNull();
  expect((await f.services.articles.get(4))?.readAt).toBeNull();
});

it('returns combined Fever v3 selectors and performs idempotent read/saved changes in the same library', async () => {
  const f = await fixture();
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/fever?api&groups',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'api_key=wrong',
      })
    ).json(),
  ).toEqual({ api_version: 3, auth: 0 });
  const result = (
    await f.fever('groups&feeds&items&unread_item_ids&saved_item_ids&favicons')
  ).json();
  expect(result).toMatchObject({
    api_version: 3,
    auth: 1,
    groups: [{ id: 1, title: 'Research / Notes' }],
    unread_item_ids: '1,4294967301',
    saved_item_ids: '2',
    favicons: [],
    total_items: 3,
  });
  expect(result.feeds_groups[0].feed_ids).toBe('1');
  expect(result.items).toHaveLength(3);
  for (let i = 0; i < 2; i++)
    expect(
      (
        await f.fever('', [
          ['mark', 'item'],
          ['as', 'saved'],
          ['id', '1'],
        ])
      ).json().auth,
    ).toBe(1);
  expect((await f.services.articles.get(1))?.starredAt).not.toBeNull();
  expect(
    (
      await f.fever('', [
        ['mark', 'item'],
        ['as', 'unsaved'],
        ['id', '1'],
      ])
    ).statusCode,
  ).toBe(200);
  expect((await f.services.articles.get(1))?.starredAt).toBeNull();
  expect(
    (
      await f.fever('', [
        ['mark', 'feed'],
        ['as', 'read'],
        ['id', '1'],
        ['before', String(now / 1000)],
      ])
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await f.get(
        `stream/items/ids?s=${encodeURIComponent(googleState('reading-list'))}&xt=${encodeURIComponent(googleState('read'))}`,
      )
    ).json().itemRefs,
  ).toEqual([]);
  const getWrite = await f.app.inject({
    url: `/api/fever?api_key=${f.key}&mark=item&as=unread&id=1`,
  });
  expect(getWrite.statusCode).toBe(400);
});

it('rotates or disables all Reader sessions and Fever keys without changing MCP tokens or library state', async () => {
  const f = await fixture(),
    mcp = f.services.agentAccess!.create({ name: 'Independent' });
  await f.app.inject({
    method: 'POST',
    url: '/api/reader-access',
    headers: { origin: 'http://localhost' },
    payload: { username: 'reader' },
  });
  expect((await f.get('subscription/list')).statusCode).toBe(401);
  expect(
    (
      await f.post(
        'edit-tag',
        [
          ['i', '1'],
          ['a', googleState('read')],
        ],
        false,
      )
    ).statusCode,
  ).toBe(401);
  expect((await f.fever('items')).json()).toEqual({ api_version: 3, auth: 0 });
  expect(f.services.agentAccess!.authenticate(`Bearer ${mcp.token}`)).not.toBeNull();
  expect((await f.services.articles.get(1))?.readAt).toBeNull();
  expect(
    (
      await f.app.inject({
        method: 'DELETE',
        url: '/api/reader-access',
        headers: { origin: 'http://localhost' },
      })
    ).statusCode,
  ).toBe(200);
  expect((await f.app.inject('/api/capabilities')).json().readerApi).toBe(false);
});

it('supports subscription creation, folder movement, rename and unsubscribe with a real owner Undo receipt', async () => {
  const f = await fixture();
  const added = await f.post('subscription/quickadd', [
    ['quickadd', 'https://new.example.test/feed'],
  ]);
  expect(added.statusCode, added.body).toBe(200);
  expect(added.json()).toMatchObject({ numResults: 1, streamName: 'New subscription' });
  const feedId = Number(added.json().streamId.split('/')[1]);
  expect(
    (
      await f.post('subscription/edit', [
        ['ac', 'edit'],
        ['s', `feed/${feedId}`],
        ['a', googleLabel('New folder')],
        ['t', 'Renamed'],
      ])
    ).statusCode,
  ).toBe(200);
  expect(
    (await f.get('subscription/list'))
      .json()
      .subscriptions.find((v: { id: string }) => v.id === `feed/${feedId}`),
  ).toMatchObject({ title: 'Renamed', categories: [{ id: googleLabel('New folder') }] });
  const removed = await f.post('subscription/edit', [
    ['ac', 'unsubscribe'],
    ['s', `feed/${feedId}`],
  ]);
  expect(removed.statusCode, removed.body).toBe(200);
  const receipt = Number(removed.headers['x-brew-undo-id']);
  expect(receipt).toBeGreaterThan(0);
  expect((await f.services.feeds.listFeeds()).some((feed) => feed.id === feedId)).toBe(false);
  expect((await f.services.actions!.undo(receipt)).status).toBe('undone');
  expect((await f.services.feeds.listFeeds()).find((feed) => feed.id === feedId)?.title).toBe(
    'Renamed',
  );
});

it('continues beyond 10000 items, returns complete Fever state lists and applies bulk changes beyond a page', async () => {
  const f = await fixture();
  f.database.sqlite
    .exec(`WITH RECURSIVE n(x) AS (VALUES(100) UNION ALL SELECT x+1 FROM n WHERE x<10100)
    INSERT INTO articles(id,feed_id,guid,hash,title,url,published_at)
    SELECT x,1,'bulk-'||x,'bulk-'||x,'Bulk '||x,'https://source.example.test/'||x,${now - 10000} FROM n`);
  const first = (await f.get('stream/items/ids?n=10000&r=o')).json();
  expect(first.itemRefs).toHaveLength(10000);
  expect(first.continuation).toBeTypeOf('string');
  const second = (
    await f.get(`stream/items/ids?n=10000&r=o&c=${encodeURIComponent(first.continuation)}`)
  ).json();
  const ids = [...first.itemRefs, ...second.itemRefs].map((v: { id: string }) => v.id);
  expect(ids).toHaveLength(10004);
  expect(new Set(ids).size).toBe(10004);
  expect(second.continuation).toBeUndefined();
  const fever = (await f.fever('items&since_id=0&unread_item_ids')).json();
  expect(fever.total_items).toBe(10004);
  expect(fever.items).toHaveLength(50);
  expect(fever.items[0].id).toBe(1);
  expect(fever.unread_item_ids.split(',')).toHaveLength(10003);
  const next = (await f.fever(`items&since_id=${fever.items.at(-1).id}`)).json();
  expect(next.items).toHaveLength(50);
  expect(next.items[0].id).toBeGreaterThan(fever.items.at(-1).id);
  expect((await f.post('mark-all-as-read', [['s', googleState('reading-list')]])).statusCode).toBe(
    200,
  );
  expect((await f.fever('unread_item_ids')).json().unread_item_ids).toBe('');
  expect((await f.services.articles.get(4))?.readAt).toBeNull();
});

it('imports the authenticated XML used by Reader clients and provides export and durable Undo', async () => {
  const f = await fixture();
  const imported = await f.app.inject({
    method: 'POST',
    url: `${prefix}/subscription/import`,
    headers: { authorization: f.authorization, 'content-type': 'text/xml' },
    payload:
      '<opml version="2.0"><body><outline text="Imported"><outline text="Native client" xmlUrl="https://native.example.test/rss"/></outline></body></opml>',
  });
  expect(imported.statusCode, imported.body).toBe(200);
  expect(imported.body).toBe('OK');
  expect(f.fetcher).not.toHaveBeenCalled();
  const exported = await f.get('subscription/export');
  expect(exported.headers['content-type']).toContain('text/x-opml');
  expect(exported.body).toContain('https://native.example.test/rss');
  expect((await f.services.actions!.undo(Number(imported.headers['x-brew-undo-id']))).status).toBe(
    'undone',
  );
  expect((await f.get('subscription/export')).body).not.toContain(
    'https://native.example.test/rss',
  );
  const unauthenticated = await f.app.inject({
    method: 'POST',
    url: `${prefix}/subscription/import`,
    headers: { 'content-type': 'text/xml' },
    payload: '<opml><body/></opml>',
  });
  expect(unauthenticated.statusCode).toBe(401);
});

it('rejects credentials rotated while feed metadata is being fetched before committing a subscription', async () => {
  const f = await fixture();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.fetcher.mockImplementationOnce(async () => {
    started();
    await held;
    return new Response(
      '<rss version="2.0"><channel><title>Held</title><description>Test</description></channel></rss>',
      { headers: { 'content-type': 'application/rss+xml' } },
    );
  });
  const pending = f.post('subscription/edit', [
    ['ac', 'subscribe'],
    ['s', 'feed/https://held.example.test/rss'],
  ]);
  const result = Promise.resolve(pending);
  await entered;
  f.services.readerSync!.access.configure({ username: 'rotated' });
  release();
  expect((await result).statusCode).toBe(403);
  expect(
    (await f.services.feeds.listFeeds()).some((feed) => feed.url.includes('held.example')),
  ).toBe(false);
  expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
    n: 0,
  });
});

it('persists verifiers, Reader sessions and stable item IDs across reopen and invalidates stale transactions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'brew-reader-reopen-'));
  const path = join(directory, 'reader.db');
  let database = openDatabase(path);
  try {
    const access = new NodeReaderAccess(database, () => now),
      credentials = access.configure({ username: 'native' });
    const token = access.login(credentials.username, credentials.password)!;
    const generation = access.session(`GoogleLogin auth=${token}`)!.generation;
    database.sqlite.exec(
      "INSERT INTO feeds(url,title) VALUES('https://stable.test/rss','Stable'); INSERT INTO articles(feed_id,guid,hash,title,url,published_at) VALUES(1,'old','old','Old','https://stable.test/old',1)",
    );
    const id = (database.sqlite.prepare('SELECT id FROM articles').get() as { id: number }).id;
    database.close();
    database = openDatabase(path);
    const reopened = new NodeReaderAccess(database, () => now);
    expect(reopened.session(`GoogleLogin auth=${token}`)?.generation).toBe(generation);
    expect(reopened.login(credentials.username, credentials.password)).toBeTypeOf('string');
    database.sqlite.prepare('DELETE FROM articles WHERE id=?').run(id);
    database.sqlite.exec(
      "INSERT INTO articles(feed_id,guid,hash,title,url,published_at) VALUES(1,'new','new','New','https://stable.test/new',2)",
    );
    const next = (database.sqlite.prepare('SELECT id FROM articles').get() as { id: number }).id;
    expect(next).toBeGreaterThan(id);
    reopened.disable();
    expect(reopened.session(`GoogleLogin auth=${token}`)).toBeNull();
    const storage = new NodeReaderSyncStorage(database, () => now);
    expect(() => storage.change({ ids: [next], generation }, { read: true })).toThrow(
      'Reader access has changed',
    );
    expect(database.sqlite.prepare('SELECT read_at FROM articles').get()).toEqual({
      read_at: null,
    });
  } finally {
    database.close();
    for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
    rmdirSync(directory);
  }
});

it('publishes an actual SSE frame after a sync write without including credentials or article bodies', async () => {
  const f = await fixture(),
    base = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { signal: controller.signal });
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  try {
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('event: heartbeat');
    await f.post('edit-tag', [
      ['i', '1'],
      ['a', googleState('starred')],
    ]);
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain('event: reader:sync\ndata: {}');
    expect(frame).not.toContain(f.credentials.password);
  } finally {
    controller.abort();
    await reader.cancel().catch(() => {});
  }
});

it('updates live Brew reading state without changing a saved issue payload', async () => {
  const f = await fixture();
  const config = await f.services.brews.createComposition({
    name: 'Frozen sync',
    enabled: false,
    timezone: 'UTC',
    schedule: { kind: 'daily', time: '07:00' },
    delivery: defaultDelivery(),
    sections: [sectionWithSources(newBrewSection('stories'), [{ kind: 'feed', id: 1 }])],
  });
  const issue = await f.services.brews.generateComposition(config.id);
  const before = f.database.sqlite
    .prepare('SELECT payload_json FROM brews WHERE id=?')
    .get(issue.id);
  await f.post('edit-tag', [
    ['i', '1'],
    ['a', googleState('read')],
    ['a', googleState('starred')],
  ]);
  const state = (await f.app.inject(`/api/brews/${issue.id}/state`)).json();
  expect(state.articles.find((item: { id: number }) => item.id === 1)).toMatchObject({
    id: 1,
    readAt: new Date(now).toISOString(),
    starredAt: new Date(now).toISOString(),
  });
  expect(
    f.database.sqlite.prepare('SELECT payload_json FROM brews WHERE id=?').get(issue.id),
  ).toEqual(before);
});

it('accepts native multipart fields and keeps label creation, rename and removal consistent', async () => {
  const f = await fixture();
  expect((await f.post('tag/edit', [['a', googleLabel('Inbox / Native')]])).statusCode).toBe(200);
  const form = new FormData();
  form.append('T', f.writeToken);
  form.append('i', googleItemId(1));
  form.append('a', googleLabel('Inbox / Native'));
  const request = new Request('http://localhost', { method: 'POST', body: form });
  const changed = await f.app.inject({
    method: 'POST',
    url: `${prefix}/edit-tag`,
    headers: {
      authorization: f.authorization,
      'content-type': request.headers.get('content-type')!,
    },
    payload: Buffer.from(await request.arrayBuffer()),
  });
  expect(changed.statusCode, changed.body).toBe(200);
  expect(
    (
      await f.post('rename-tag', [
        ['s', googleLabel('Inbox / Native')],
        ['dest', googleLabel('Renamed / Native')],
      ])
    ).statusCode,
  ).toBe(200);
  expect(
    (await f.get(`stream/items/ids?s=${encodeURIComponent(googleLabel('Renamed / Native'))}`))
      .json()
      .itemRefs.map((v: { id: string }) => v.id),
  ).toEqual(['1']);
  expect((await f.post('disable-tag', [['s', googleLabel('Renamed / Native')]])).statusCode).toBe(
    200,
  );
  expect(
    (await f.get('tag/list'))
      .json()
      .tags.some((tag: { id: string }) => tag.id === googleLabel('Renamed / Native')),
  ).toBe(false);
  expect((await f.services.articles.get(1))?.readAt).toBeNull();
});

it('uses crawl time for incremental Reader sync and requires an authenticated header for Reeder T=x', async () => {
  const f = await fixture();
  f.database.sqlite.prepare('UPDATE articles SET fetched_at=?').run(now - 60_000);
  f.database.sqlite
    .prepare('UPDATE articles SET fetched_at=?,published_at=? WHERE id=1')
    .run(now, now - 7 * 86400000);
  const recent = (await f.get(`stream/items/ids?ot=${now / 1000}`)).json();
  expect(recent.itemRefs.map((v: { id: string }) => v.id)).toEqual(['1']);
  expect(
    (await f.get(`stream/items/ids?ot=${now / 1000}&nt=${now / 1000}`)).json().itemRefs,
  ).toEqual([]);
  const payload = f.form([
    ['T', 'x'],
    ['i', '1'],
    ['a', googleState('starred')],
  ]);
  const withoutHeader = await f.app.inject({
    method: 'POST',
    url: `${prefix}/edit-tag`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload,
  });
  expect(withoutHeader.statusCode).toBe(401);
  expect((await f.services.articles.get(1))?.starredAt).toBeNull();
  const withHeader = await f.app.inject({
    method: 'POST',
    url: `${prefix}/edit-tag`,
    headers: {
      authorization: f.authorization,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload,
  });
  expect(withHeader.statusCode, withHeader.body).toBe(200);
  expect((await f.services.articles.get(1))?.starredAt).not.toBeNull();
  const content = (await f.get('stream/items/contents?i=1')).json().items[0];
  expect(content.timestampUsec).toBe(String(now * 1000));
  expect(content.published).toBe((now - 7 * 86400000) / 1000);
  await f.post('mark-all-as-read', [
    ['s', 'feed/1'],
    ['ts', String((now - 1000) * 1000)],
  ]);
  expect((await f.services.articles.get(1))?.readAt).toBeNull();
});
