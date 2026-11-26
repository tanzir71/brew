import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { articles, feeds, folders } from './src/db/schema.js';
import {
  parseReaderPage,
  readerPageHref,
  textTwinHref,
} from '../../packages/core/src/reader-pages.js';

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
async function setup() {
  const database = openDatabase(':memory:');
  const now = new Date('2026-11-26T01:00:00Z');
  const app = await createApp({
    database,
    publicUrl: 'https://brew.example.test/base',
    clock: { now: () => now, monotonic: () => performance.now() },
  });
  closes.push(() => app.close());
  const folder = database.db.insert(folders).values({ title: 'Design' }).returning().get();
  const feed = database.db
    .insert(feeds)
    .values({ title: 'Journal [one]', folderId: folder.id, url: 'https://journal.test/feed' })
    .returning()
    .get();
  database.sqlite.transaction(() => {
    for (let i = 0; i < 112; i++)
      database.db
        .insert(articles)
        .values({
          feedId: feed.id,
          guid: String(i),
          hash: String(i),
          title: `Needle ${i}`,
          url: `https://journal.test/${i}`,
          publishedAt: new Date(now.getTime() - i * 3_600_000),
          readAt: i % 3 === 0 ? now : null,
          starredAt: i % 5 === 0 ? now : null,
          contentHtml: '<p>Readable content.</p>',
          rawHtml: 'private-original-token',
        })
        .run();
    const other = database.db
      .insert(feeds)
      .values({ title: 'Other', url: 'https://other.test/feed' })
      .returning()
      .get();
    for (let i = 0; i < 2; i++)
      database.db
        .insert(articles)
        .values({
          feedId: other.id,
          guid: `other-${i}`,
          hash: `other-${i}`,
          title: `Needle other ${i}`,
          url: 'https://other.test/story',
          publishedAt: now,
        })
        .run();
    for (const [index, values] of [
      { muted: true },
      { kind: 'newsletter' as const, settingsJson: '{"onlyInBrew":true}' },
    ].entries()) {
      const ignored = database.db
        .insert(feeds)
        .values({ ...values, title: `Excluded ${index}`, url: `https://excluded.test/${index}` })
        .returning()
        .get();
      database.db
        .insert(articles)
        .values({
          feedId: ignored.id,
          guid: 'excluded',
          hash: `excluded-${index}`,
          title: 'Needle excluded',
          url: 'https://excluded.test/story',
          publishedAt: now,
          starredAt: now,
        })
        .run();
    }
    database.db
      .insert(articles)
      .values({
        feedId: feed.id,
        guid: 'hidden',
        hash: 'hidden',
        title: 'Needle hidden',
        url: 'https://journal.test/hidden',
        hidden: true,
        publishedAt: now,
      })
      .run();
  })();
  const get = (url: string, method: 'GET' | 'HEAD' = 'GET') => app.inject({ method, url });
  return { app, database, feed, folder, get };
}
describe('Reader URLs, exact totals and private page twins', () => {
  it('round-trips canonical and legacy URL filters, placing extensions before query strings', () => {
    const url = new URL(
      'https://local.test/?view=reader&folder=7&unread=true&sort=oldest&density=title&page=3&agent=1',
    );
    const state = parseReaderPage(url)!;
    const href = readerPageHref(state);
    expect(href).toBe('/f/7?page=3&density=title&unread=true&sort=oldest&agent=1');
    expect(parseReaderPage(new URL(href, url))).toEqual(state);
    expect(textTwinHref(href, 'json')).toBe(
      '/f/7.json?page=3&density=title&unread=true&sort=oldest&agent=1',
    );
    expect(parseReaderPage(new URL('/b/1/compose', url))).toBeNull();
    expect(parseReaderPage(new URL('/?view=reader&folder=7&q=Needle', url))).toMatchObject({
      kind: 'search',
      folderId: 7,
      q: 'Needle',
    });
    expect(parseReaderPage(new URL('/?view=reader&feed=8&q=Needle', url))).toMatchObject({
      kind: 'search',
      contextFeedId: 8,
      q: 'Needle',
    });
  });
  it('reports whole-filter totals independently of cursor/offset and preserves legacy DTO keys', async () => {
    const f = await setup();
    const legacy = await f.get('/api/articles?view=all&limit=1');
    expect(Object.keys(legacy.json())).toEqual(['items', 'nextCursor']);
    const first = (
      await f.get(
        `/api/articles?view=all&feedId=${f.feed.id}&unread=true&includeTotal=true&limit=5`,
      )
    ).json();
    expect(first.total).toBe(74);
    const next = (
      await f.get(
        `/api/articles?view=all&feedId=${f.feed.id}&unread=true&includeTotal=true&limit=5&cursor=${first.nextCursor}`,
      )
    ).json();
    expect(next.total).toBe(74);
    expect(next.items[0].id).not.toBe(first.items[0].id);
    expect(
      (await f.get('/api/articles?view=all&includeTotal=true&offset=100')).json(),
    ).toMatchObject({ total: 114, items: expect.any(Array) });
    expect((await f.get('/api/articles?view=today&includeTotal=true')).json().total).toBe(27);
    expect((await f.get('/api/articles?view=starred&includeTotal=true')).json().total).toBe(24);
    expect((await f.get('/api/articles?view=all&offset=-1')).statusCode).toBe(400);
  });
  it('serves the exact sorted, unread, numbered page with content-only links and no writes or private originals', async () => {
    const f = await setup();
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    const path = `/f/${f.folder.id}.json?page=2&unread=true&sort=oldest&density=title`;
    const response = await f.get(path);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['x-robots-tag']).toContain('noindex');
    const value = response.json();
    expect(value).toMatchObject({
      title: 'Design',
      page: 2,
      total: 74,
      showing: { from: 51, to: 74 },
    });
    expect(value.items).toHaveLength(24);
    expect(value.items[0].title).toBe('Needle 35');
    expect(value.items[0].readAt).toBeNull();
    expect(value.items[0].markdown).toBe(`https://brew.example.test/a/${value.items[0].id}.md`);
    expect(value.previous).toContain('/f/1?density=title&unread=true&sort=oldest');
    expect(value.next).toBeNull();
    expect(response.body).not.toMatch(
      /rawHtml|private-original-token|contentHtml|cleaning|settingsJson/,
    );
    expect(response.headers.link).toContain(
      `/f/${f.folder.id}.md?page=2&density=title&unread=true&sort=oldest`,
    );
    const markdown = await f.get(path.replace('.json', '.md'));
    expect(markdown.headers['content-type']).toContain('text/markdown');
    expect(markdown.body).toContain('Showing 51–74 of 74');
    expect(markdown.body).toContain('## Needle 35');
    expect((await f.get(path, 'HEAD')).body).toBe('');
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  });
  it('counts and exports all/folder/starred search scopes using the actual FTS query', async () => {
    const f = await setup();
    const legacy = (await f.get('/api/search?q=Needle')).json();
    expect(Object.keys(legacy)).toEqual(['items', 'nextOffset', 'durationMs']);
    expect(
      (await f.get(`/search.json?q=Needle&scope=folder&folderId=${f.folder.id}&page=3`)).json(),
    ).toMatchObject({ total: 112, showing: { from: 101, to: 112 } });
    expect((await f.get('/search.json?q=Needle&scope=starred&unread=true')).json().total).toBe(16);
    expect((await f.get('/search.json?q=Needle')).json().total).toBe(115);
    const chronological = (await f.get('/search.json?q=Needle&sort=oldest')).json();
    expect(chronological.items[0].title).toBe('Needle 111');
    const times = chronological.items.map((item: { publishedAt: string }) =>
      Date.parse(item.publishedAt),
    );
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect((await f.get('/search.json?q=!!!')).json()).toMatchObject({
      total: 0,
      items: [],
      showing: { from: 0, to: 0 },
    });
  });
  it('rejects invalid identities, sources and filters without falling back to HTML/latest', async () => {
    const f = await setup();
    for (const path of ['/f/0.json', '/feed/01.md', '/feed/999.json', '/f/999.json'])
      expect((await f.get(path)).statusCode, path).toBe(404);
    for (const query of [
      'page=0',
      'page=1e2',
      'page=1000001',
      'sort=random',
      'density=compact',
      'unread=1',
    ])
      expect((await f.get(`/all.json?${query}`)).statusCode, query).toBe(400);
    expect((await f.get('/search.json?q=Needle&scope=folder')).statusCode).toBe(400);
    expect((await f.get('/search.json?q=Needle&scope=folder&folderId=999')).statusCode).toBe(404);
  });
  it('paginates all hidden articles beyond the legacy cap with exact totals and private read-only twins', async () => {
    const f = await setup();
    f.database.sqlite.prepare('UPDATE articles SET hidden=1').run();
    const insert = f.database.sqlite.prepare(
      'INSERT INTO articles(feed_id,guid,hash,title,url,published_at,hidden,raw_html) VALUES(?,?,?,?,?,?,1,?)',
    );
    f.database.sqlite.transaction(() => {
      for (let i = 0; i < 510; i++)
        insert.run(
          f.feed.id,
          `hidden-${i}`,
          `hidden-${i}`,
          `Hidden ${i}`,
          `https://hidden.test/${i}`,
          1_000_000,
          'private-hidden-original',
        );
    })();
    const expected = f.database.sqlite
      .prepare('SELECT id FROM articles WHERE hidden=1 ORDER BY published_at DESC,id DESC')
      .all() as { id: number }[];
    expect(expected.length).toBeGreaterThan(500);
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    const legacy = (await f.get('/api/articles-hidden')).json();
    expect(legacy).toHaveLength(500);
    expect(Object.keys(legacy[0])).toEqual(['id', 'title', 'feedTitle', 'publishedAt']);
    const ids: number[] = [];
    for (let page = 1; page <= Math.ceil(expected.length / 50); page++) {
      const response = await f.get(`/api/articles-hidden?includeTotal=true&page=${page}`);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      const value = response.json();
      expect(value).toMatchObject({ total: expected.length, page, pageSize: 50 });
      expect(value.items.length).toBeLessThanOrEqual(50);
      ids.push(...value.items.map((item: { id: number }) => item.id));
      expect(response.body).not.toMatch(
        /rawHtml|private-hidden-original|contentHtml|cleaning|mailto:/,
      );
    }
    expect(ids).toEqual(expected.map((item) => item.id));
    expect(new Set(ids).size).toBe(expected.length);
    const twin = (await f.get('/feeds.json?section=hidden&page=3')).json();
    expect(twin.state).toEqual({ section: 'hidden', page: 3 });
    expect(twin.sections[0].data).toMatchObject({
      total: expected.length,
      page: 3,
      showing: { from: 101, to: 150 },
      previous: 'https://brew.example.test/feeds?section=hidden&page=2',
      next: 'https://brew.example.test/feeds?section=hidden&page=4',
    });
    expect(twin.sections[0].items.map((item: { id: number }) => item.id)).toEqual(
      expected.slice(100, 150).map((item) => item.id),
    );
    expect((await f.get('/feeds.md?section=hidden&page=3')).body).toContain(
      `Showing 101–150 of ${expected.length}`,
    );
    expect((await f.get('/feeds.md?section=hidden&page=3')).body).toContain(
      '[Next hidden articles]',
    );
    expect((await f.get('/api/articles-hidden?includeTotal=true', 'HEAD')).body).toBe('');
    for (const page of ['0', '1e2', '1000001']) {
      expect((await f.get(`/api/articles-hidden?includeTotal=true&page=${page}`)).statusCode).toBe(
        400,
      );
      expect((await f.get(`/feeds.json?section=hidden&page=${page}`)).statusCode).toBe(400);
    }
    expect((await f.get('/api/articles-hidden?includeTotal=true&page=100')).json()).toMatchObject({
      total: expected.length,
      items: [],
    });
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  });
});
