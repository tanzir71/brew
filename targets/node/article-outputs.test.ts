import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { articles, feeds } from './src/db/schema.js';

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
async function setup(publicUrl?: string) {
  const database = openDatabase(':memory:');
  const app = await createApp({ database, publicUrl });
  closes.push(() => app.close());
  const feed = database.db
    .insert(feeds)
    .values({ title: 'Fixture letters', kind: 'newsletter', url: 'mailto:editor@journal.test' })
    .returning()
    .get();
  const item = database.db
    .insert(articles)
    .values({
      feedId: feed.id,
      guid: 'fixture',
      hash: 'fixture',
      title: 'Read [slowly] & 😌',
      url: '/a/1',
      publishedAt: new Date('2026-11-25T01:00:00Z'),
      contentHtml:
        '<p>Clean <em>reading</em>. <a href="/b/7">Brew</a></p><script>attack()</script><img width="1" src="https://metrics.test/pixel">',
      fullTextHtml:
        '<p>The <strong>full</strong> letter. <a href="/b/7">Archive</a></p><ul><li>One</li><li>Two</li></ul>',
      rawHtml: '<p>private-original-token</p>',
      cleaningJson: '{"trackers":1}',
    })
    .returning()
    .get();
  const get = (path: string, method: 'GET' | 'HEAD' = 'GET') =>
    app.inject({ method, url: path, headers: { host: 'reader.example.test:4401' } });
  return { app, database, item, get };
}
describe('private article twins', () => {
  it('serves cleaned full content and absolute links as Markdown/JSON without reads, extraction or other writes', async () => {
    const f = await setup();
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    const json = await f.get(`/a/${f.item.id}.json`);
    expect(json.statusCode).toBe(200);
    expect(json.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(json.headers['cache-control']).toBe('private, no-store');
    expect(json.headers['x-robots-tag']).toContain('noindex');
    expect(json.headers.link).toContain(`/a/${f.item.id}.md`);
    expect(json.json()).toMatchObject({
      id: f.item.id,
      title: 'Read [slowly] & 😌',
      contentHtml: expect.stringContaining('The <strong>full</strong> letter'),
    });
    expect(json.body).not.toMatch(
      /rawHtml|private-original-token|cleaning|readAt|starredAt|highlightColor|attack|metrics\.test/,
    );
    expect(json.json().contentHtml).toContain('http://reader.example.test:4401/b/7');
    const md = await f.get(`/a/${f.item.id}.md`);
    expect(md.statusCode).toBe(200);
    expect(md.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(md.body).toContain('# Read \\[slowly\\] & 😌');
    expect(md.body).toContain('The **full** letter');
    expect(md.body).toContain('- One\n- Two');
    expect(md.body).not.toContain('<p>');
    expect((await f.get(`/a/${f.item.id}.md`, 'HEAD')).body).toBe('');
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  });
  it('uses the canonical origin and rejects malformed, missing or unsafe identities without a SPA/latest fallback', async () => {
    const f = await setup('https://canonical.example.test');
    expect((await f.get(`/a/${f.item.id}.json`)).json().contentHtml).toContain(
      'https://canonical.example.test/b/7',
    );
    for (const path of [
      '/a/0.json',
      '/a/01.md',
      '/a/-1.json',
      '/a/missing.md',
      '/a/9007199254740992.json',
      '/a/999.json',
    ]) {
      const response = await f.get(path);
      expect(response.statusCode, path).toBe(404);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).not.toContain('<!doctype html>');
    }
  });
});
