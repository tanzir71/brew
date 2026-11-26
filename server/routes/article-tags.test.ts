import { afterEach, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/database.js';
import { articles, feeds } from '../db/schema.js';
import { ArticleService } from '../services/article-service.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup() {
  const database = openDatabase(':memory:');
  const feed = database.db
    .insert(feeds)
    .values({ title: 'Tag journal', url: 'https://tags.test/feed' })
    .returning()
    .get();
  const article = database.db
    .insert(articles)
    .values({
      feedId: feed.id,
      guid: 'tags',
      url: 'https://tags.test/story',
      title: 'Tag story',
      hash: 'tags',
      publishedAt: new Date('2026-07-10T00:00:00Z'),
      contentHtml: '<p>Keep this body.</p>',
      fullTextHtml: '<p>Keep full text.</p>',
      readAt: new Date('2026-07-10T01:00:00Z'),
      starredAt: new Date('2026-07-10T02:00:00Z'),
    })
    .returning()
    .get();
  const service = new ArticleService(database);
  const tags = ['First', 'Second', 'Unrelated'].map((name) => service.createTag(name));
  service.setTags(article.id, [tags[0]!.id, tags[2]!.id]);
  const app = await createApp({ database });
  cleanup.push(() => app.close());
  const rows = () =>
    database.sqlite.prepare('SELECT * FROM article_tags ORDER BY article_id,tag_id').all();
  const changes = () =>
    (database.sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  const patch = (payload: unknown, id = String(article.id)) =>
    app.inject({ method: 'PATCH', url: `/api/articles/${id}/tags`, payload });
  return { database, service, app, article, tags, rows, changes, patch };
}

it('atomically changes only requested tags, retains unrelated fields and replays membership without writes', async () => {
  const f = await setup();
  const before = f.database.db.select().from(articles).get();
  const request = { add: [f.tags[1]!.id, f.tags[1]!.id], remove: [f.tags[0]!.id] };
  const first = await f.patch(request);
  expect(first.statusCode).toBe(200);
  expect(first.headers['cache-control']).toBe('private, no-store');
  expect(first.headers['x-robots-tag']).toBe('noindex');
  expect(first.headers['x-content-type-options']).toBe('nosniff');
  expect(first.json().tags.map((tag: { name: string }) => tag.name)).toEqual([
    'Second',
    'Unrelated',
  ]);
  expect(f.database.db.select().from(articles).get()).toEqual(before);
  const after = f.changes();
  expect((await f.patch(request)).json().tags).toEqual(first.json().tags);
  expect(f.changes()).toBe(after);
  const insert = f.database.sqlite.prepare('INSERT INTO tags(name,color) VALUES(?,?)');
  const many = f.database.sqlite.transaction(() =>
    Array.from({ length: 500 }, (_, index) =>
      Number(insert.run(`Batch ${index}`, '#a0471d').lastInsertRowid),
    ),
  )();
  expect((await f.patch({ add: many })).json().tags).toHaveLength(502);
  expect(
    (await f.patch({ remove: many })).json().tags.map((tag: { name: string }) => tag.name),
  ).toEqual(['Second', 'Unrelated']);
  const beforeNoop = f.changes();
  expect((await f.patch({ add: [], remove: [] })).statusCode).toBe(200);
  expect(f.changes()).toBe(beforeNoop);
});

it('rejects malformed tag intents and missing additions before changing any assignment', async () => {
  const f = await setup();
  const before = f.rows();
  const total = f.changes();
  for (const payload of [
    {},
    { tagIds: [1] },
    { add: null },
    { add: [0] },
    { add: [1.5] },
    { remove: 'all' },
    { add: [Number.MAX_SAFE_INTEGER + 1] },
    { add: [f.tags[0]!.id], remove: [f.tags[0]!.id] },
    { add: Array.from({ length: 501 }, (_, index) => index + 1) },
    { add: [999], remove: [f.tags[0]!.id] },
  ]) {
    expect((await f.patch(payload)).statusCode).toBe(400);
    expect(f.rows()).toEqual(before);
  }
  expect((await f.patch({ add: [] }, '0')).statusCode).toBe(400);
  expect((await f.patch({ remove: [] }, '999')).statusCode).toBe(404);
  expect(f.changes()).toBe(total);
});

it('rolls back a removal if a later addition fails and can safely retry the exact intent', async () => {
  const f = await setup();
  const before = f.rows();
  f.database.sqlite.exec(
    `CREATE TEMP TRIGGER reject_tag BEFORE INSERT ON article_tags WHEN NEW.tag_id=${f.tags[1]!.id} BEGIN SELECT RAISE(ABORT, 'tag write rejected'); END`,
  );
  const request = { add: [f.tags[1]!.id], remove: [f.tags[0]!.id] };
  expect((await f.patch(request)).statusCode).toBe(400);
  expect(f.rows()).toEqual(before);
  f.database.sqlite.exec('DROP TRIGGER reject_tag');
  expect((await f.patch(request)).statusCode).toBe(200);
  expect(f.service.get(f.article.id)!.tags.map((tag) => tag.name)).toEqual(['Second', 'Unrelated']);
});

it('keeps the legacy replacement API and reuses tag definitions after a lost creation acknowledgement', async () => {
  const f = await setup();
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/tags',
    payload: { name: 'New tag' },
  });
  const replay = await f.app.inject({
    method: 'POST',
    url: '/api/tags',
    payload: { name: '  New tag  ' },
  });
  expect(replay.json()).toEqual(created.json());
  expect(f.service.listTags().filter((tag) => tag.name === 'New tag')).toHaveLength(1);
  const legacy = await f.app.inject({
    method: 'PUT',
    url: `/api/articles/${f.article.id}/tags`,
    payload: { tagIds: [created.json().id] },
  });
  expect(legacy.statusCode).toBe(200);
  expect(legacy.json().tags).toEqual([created.json()]);
  expect(
    (await f.patch({ add: [f.tags[1]!.id] })).json().tags.map((tag: { name: string }) => tag.name),
  ).toEqual(['New tag', 'Second']);
});
