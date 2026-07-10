import { expect, test } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { createApp } from '../../server/app.js';
import { openDatabase } from '../../server/db/database.js';
import { feeds, folders } from '../../server/db/schema.js';

test('FTS5 returns scoped results from 1,000 indexed articles in under 50ms', async ({
  request,
}) => {
  const database = openDatabase(':memory:');
  const folder = database.db.insert(folders).values({ title: 'Design' }).returning().get();
  const feed = database.db
    .insert(feeds)
    .values({ title: 'Fixture feed', url: 'https://fixture.test/feed', folderId: folder.id })
    .returning()
    .get();
  const insert = database.sqlite.prepare(
    'INSERT INTO articles (feed_id, guid, url, title, content_html, published_at, starred_at, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  database.sqlite.transaction(() => {
    for (let index = 0; index < 1_000; index++)
      insert.run(
        feed.id,
        `fixture-${index}`,
        `https://fixture.test/${index}`,
        index % 10 === 0 ? `Needle interface ${index}` : `Article ${index}`,
        `<p>${index % 25 === 0 ? 'needle research' : 'ordinary fixture content'}</p>`,
        Date.now() - index,
        index % 100 === 0 ? Date.now() : null,
        `fixture-hash-${index}`,
      );
  })();
  const app = await createApp({ database });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  try {
    await request.get(`${address}/api/search?q=warmup`);
    const started = performance.now();
    const response = await request.get(
      `${address}/api/search?q=needle&scope=folder&folderId=${folder.id}&limit=50`,
    );
    const elapsed = performance.now() - started;
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as {
      items: unknown[];
      durationMs: number;
      nextOffset: number | null;
    };
    expect(body.items).toHaveLength(50);
    expect(body.nextOffset).toBe(50);
    expect(body.durationMs).toBeLessThan(50);
    expect(elapsed).toBeLessThan(50);
  } finally {
    await app.close();
  }
});
