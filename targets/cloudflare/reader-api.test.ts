import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';
import { fileURLToPath } from 'node:url';
import type { ReaderTestEnv } from './test/reader-worker.js';
import { createApp } from '../node/src/app.js';
import { openDatabase } from '../node/src/db/database.js';
import { upstreamResponse } from './test/upstream.js';

const now = Date.parse('2026-11-27T12:00:00Z');
const server = createTestHarness({
  workers: [
    {
      config: {
        name: 'brew-reader-test',
        main: fileURLToPath(new URL('./test/reader-worker.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        compatibility_flags: ['nodejs_compat'],
        workers_dev: false,
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'reader-test',
            database_id: '00000000-0000-0000-0000-000000000001',
            migrations_dir: fileURLToPath(
              new URL('../../packages/db/migrations/', import.meta.url),
            ),
          },
        ],
        r2_buckets: [{ binding: 'IMAGES', bucket_name: 'reader-images-test' }],
        services: [{ binding: 'UPSTREAM', service: 'brew-upstream-test' }],
      },
    },
    {
      config: {
        name: 'brew-upstream-test',
        main: fileURLToPath(new URL('./test/upstream.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        workers_dev: false,
      },
    },
  ],
});
const worker = server.getWorker<ReaderTestEnv>('brew-reader-test');
let env: ReaderTestEnv;
let node: Awaited<ReturnType<typeof createApp>>;
const database = openDatabase(':memory:');

beforeAll(async () => {
  await server.listen();
  await worker.applyD1Migrations('DB');
  env = await worker.getEnv();
  node = await createApp({
    publicUrl: 'https://brew.example.test',
    database,
    logger: false,
    clock: { now: () => new Date(now), monotonic: () => 0 },
    fetcher: async (input, init) => upstreamResponse(new Request(input, init)),
  });
  const sql = [
    "INSERT INTO folders(id,title) VALUES(1,'Research'),(2,'Empty')",
    `INSERT INTO feeds(id,url,title,folder_id,kind,muted,settings_json) VALUES(1,'https://source.example.test/rss','Journal',1,'rss',0,'{}'),(2,'mailto:letter@example.test','Private letters',1,'newsletter',0,'{"onlyInBrew":true}'),(3,'https://muted.example.test/rss','Muted',NULL,'rss',1,'{}')`,
    "INSERT INTO tags(id,name,color) VALUES(1,'Alpha','#000000'),(2,'Zed','#ffffff')",
  ];
  for (let id = 1; id <= 75; id++) {
    const feed = id === 72 ? 2 : id === 73 ? 3 : 1,
      hidden = id === 7 ? 1 : 0,
      published = now - id * 3_600_000,
      read = id % 4 === 0 ? now : 'NULL',
      starred = id % 6 === 0 ? now : 'NULL';
    sql.push(
      `INSERT INTO articles(id,feed_id,guid,hash,url,title,content_html,summary_html,published_at,read_at,starred_at,hidden) VALUES(${id},${feed},'g-${id}','h-${id}','https://source.example.test/story','Design story ${id}','<p>Careful reading ${id}.</p>','<p>Excerpt ${id}.</p>',${published},${read},${starred},${hidden})`,
    );
  }
  sql.push('INSERT INTO article_tags(article_id,tag_id) VALUES(1,1)');
  database.sqlite.exec(sql.join(';'));
  await env.DB.batch(sql.map((query) => env.DB.prepare(query)));
}, 30_000);
afterAll(async () => {
  await node?.close();
  await server.close();
});
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return worker.fetch(`https://brew.example.test${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await request(path, method, body, headers);
  const value = await response.json();
  expect(response.status, JSON.stringify(value)).toBe(200);
  return value;
}
it('runs the shared Reader routes inside workerd with Node-identical navigation, filters, totals and cursors', async () => {
  for (const path of [
    '/api/reader/navigation',
    '/api/articles?limit=3&includeTotal=true',
    '/api/articles?view=today&unread=true&sort=oldest&includeTotal=true',
    '/api/articles?view=starred&includeTotal=true',
    '/api/articles?feedId=2&includeTotal=true',
    '/api/articles?folderId=1&offset=50&includeTotal=true',
    '/api/articles-hidden?includeTotal=true',
    '/api/articles/1',
    '/api/feeds',
    '/api/folders',
  ]) {
    expect(await json(path), path).toEqual((await node.inject(path)).json());
  }
  const first = (await json('/api/articles?limit=3&includeTotal=true')) as {
    nextCursor: string;
    items: Array<{ id: number }>;
  };
  const path =
    '/api/articles?limit=3&includeTotal=true&cursor=' + encodeURIComponent(first.nextCursor);
  expect(await json(path)).toEqual((await node.inject(path)).json());
  expect((await request('/api/articles?cursor=invalid')).status).toBe(400);
});
it('uses D1 FTS ranking, explicit newsletter search, scoped paging and private saved twins', async () => {
  for (const path of [
    '/api/search?q=design&includeTotal=true&limit=4',
    '/api/search?q=design&scope=folder&folderId=1&includeTotal=true&offset=10&sort=oldest',
    '/api/search?q=design&scope=starred&includeTotal=true',
    '/api/search?q=%22%3Bdelete&includeTotal=true',
  ]) {
    const actual = (await json(path)) as { durationMs: number },
      expected = (await node.inject(path)).json();
    delete (actual as Partial<typeof actual>).durationMs;
    delete expected.durationMs;
    expect(actual, path).toEqual(expected);
  }
  for (const path of ['/all.json?agent=1', '/search.json?q=design&scope=starred', '/a/1.md']) {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe(
      (await node.inject({ url: path, headers: { host: 'brew.example.test' } })).body,
    );
  }
});
it('persists read/star and atomic tag edits across new Worker service graphs, preserving state on invalid batches', async () => {
  const state = (await json('/api/articles/1', 'PATCH', { read: true, starred: true })) as {
    readAt: string;
    starredAt: string;
  };
  expect(state.readAt).toBe(new Date(now).toISOString());
  expect(state.starredAt).toBe(state.readAt);
  await json('/api/articles/1/tags', 'PUT', { tagIds: [1, 2] });
  expect(
    ((await json('/api/articles/1')) as { tags: Array<{ id: number }> }).tags.map((tag) => tag.id),
  ).toEqual([1, 2]);
  expect(
    (await request('/api/articles/1/tags', 'PATCH', { remove: [1], add: [9999] })).status,
  ).toBe(400);
  expect(
    ((await json('/api/articles/1')) as { tags: Array<{ id: number }> }).tags.map((tag) => tag.id),
  ).toEqual([1, 2]);
  await json('/api/articles/1/tags', 'PATCH', { remove: [1], add: [] });
  expect(
    ((await json('/api/articles/1')) as { tags: Array<{ id: number }> }).tags.map((tag) => tag.id),
  ).toEqual([2]);
});
it('durably restores a legacy read batch across requests, protects later changes and expires exactly once', async () => {
  await json('/api/articles/1', 'PATCH', { read: false });
  const marked = (await json('/api/articles/mark-all-read', 'POST', {
    view: 'all',
    feedId: 1,
  })) as { updated: number; undoToken: string };
  expect(marked.updated).toBeGreaterThan(0);
  await json('/api/articles/1', 'PATCH', { read: true }, { 'x-review-now': String(now + 1) });
  const restored = (await json('/api/articles/mark-all-read/undo', 'POST', {
    undoToken: marked.undoToken,
  })) as { restored: number };
  expect(restored.restored).toBe(marked.updated - 1);
  expect(((await json('/api/articles/1')) as { readAt: string }).readAt).toBe(
    new Date(now + 1).toISOString(),
  );
  expect(
    (await request('/api/articles/mark-all-read/undo', 'POST', { undoToken: marked.undoToken }))
      .status,
  ).toBe(410);
  const expires = (await json('/api/articles/mark-all-read', 'POST', { view: 'all' })) as {
    undoToken: string;
  };
  expect(
    (
      await request(
        '/api/articles/mark-all-read/undo',
        'POST',
        { undoToken: expires.undoToken },
        { 'x-review-now': String(now + 5000) },
      )
    ).status,
  ).toBe(410);
});
it('discovers real XML through the Worker parser, changes subscriptions/folders and extracts sanitized full text', async () => {
  const discovered = (await json('/api/feeds/discover', 'POST', {
    url: 'https://new.example.test/rss',
  })) as { candidates: Array<{ url: string }> };
  expect(discovered.candidates).toHaveLength(1);
  const folderResponse = await request('/api/folders', 'POST', { title: 'From Worker' });
  expect(folderResponse.status).toBe(201);
  const folder = (await folderResponse.json()) as { id: number };
  const added = await request('/api/feeds', 'POST', {
    url: discovered.candidates[0]!.url,
    folderId: folder.id,
  });
  expect(added.status).toBe(201);
  const feed = (await added.json()) as { id: number };
  await json(`/api/feeds/${feed.id}`, 'PATCH', { title: 'Renamed', folderId: null });
  expect((await request(`/api/feeds/${feed.id}`, 'DELETE')).status).toBe(204);
  expect((await request(`/api/folders/${folder.id}`, 'DELETE')).status).toBe(204);
  const article = (await json('/api/articles/2/full-text', 'POST')) as { fullTextHtml: string };
  expect(article.fullTextHtml).toContain('Thoughtful design');
  expect(article.fullTextHtml).not.toContain('script');
  expect(article.fullTextHtml).toContain('https://source.example.test/relative');
});
it('catches up live streams across separate Worker invocations and cleans up a cancelled subscriber', async () => {
  const response = await request('/api/events');
  expect(response.status).toBe(200);
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  const nextSync = async () => {
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (event.startsWith('event: reader:sync')) return;
      } else {
        const chunk = await reader.read();
        expect(chunk.done).toBe(false);
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    }
  };
  try {
    await nextSync();
    await json('/api/articles/1', 'PATCH', { starred: false });
    await nextSync();
  } finally {
    await reader.cancel();
  }
  expect((await request('/api/events', 'HEAD')).headers.get('content-type')).toBe(
    'text/event-stream',
  );
});

it('caches images in actual Worker R2 and keeps scoped credentials outside owner REST', async () => {
  const source = encodeURIComponent('https://source.example.test/image.png?signature=private');
  const first = await request('/api/img?src=' + source),
    second = await request('/api/img?src=' + source);
  expect(first.status).toBe(200);
  expect(await second.arrayBuffer()).toEqual(await first.arrayBuffer());
  const stats = await env.UPSTREAM.fetch('https://source.example.test/stats');
  expect(((await stats.json()) as { images: number }).images).toBe(1);
  const objects = await env.IMAGES.list();
  expect(objects.objects[0]!.key).toMatch(/^images\/[a-f\d]{64}$/);
  for (const authorization of ['GoogleLogin auth=reader', 'Bearer scoped'])
    expect((await request('/api/articles', 'GET', undefined, { authorization })).status).toBe(403);
  const schema = (await json('/api/openapi.json')) as {
    openapi: string;
    paths: Record<string, unknown>;
  };
  expect(schema.openapi).toBe('3.1.0');
  expect(schema.paths['/api/articles/{id}']).toBeTruthy();
});
