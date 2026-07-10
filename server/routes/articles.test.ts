import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/database.js';
import { articles, feeds } from '../db/schema.js';
import { ArticleService } from '../services/article-service.js';

const fullPage = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/full-article.html'), 'utf8');

describe('article detail and full-text extraction', () => {
  it('returns reading metadata and stores sanitized readable content', async () => {
    const database = openDatabase(':memory:');
    const feed = database.db.insert(feeds).values({ title: 'Journal', url: 'https://journal.test/feed' }).returning().get();
    const article = database.db.insert(articles).values({ feedId: feed.id, guid: 'one', url: 'https://journal.test/story', title: 'Field guide', contentHtml: '<p>Short version.</p>', publishedAt: new Date('2026-07-10T03:00:00Z'), hash: 'one' }).returning().get();
    const fetcher = vi.fn(async () => new Response(fullPage, { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    const app = await createApp({ database, fetcher });
    expect((await app.inject(`/api/articles/${article.id}`)).json()).toMatchObject({ title: 'Field guide', readTimeMinutes: 1, fullTextHtml: null });
    const extracted = await app.inject({ method: 'POST', url: `/api/articles/${article.id}/full-text` });
    expect(extracted.statusCode).toBe(200);
    const detail = extracted.json();
    expect(detail.fullTextHtml).toContain('Careful reading');
    expect(detail.fullTextHtml).toContain('https://journal.test/related');
    expect(detail.fullTextHtml).not.toMatch(/script|onerror|utm_source/i);
    expect(detail.readTimeMinutes).toBeGreaterThanOrEqual(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await app.inject({ method: 'POST', url: `/api/articles/${article.id}/full-text` });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const starred = await app.inject({ method: 'PATCH', url: `/api/articles/${article.id}`, payload: { read: true, starred: true } });
    expect(starred.json()).toMatchObject({ readAt: expect.any(String), starredAt: expect.any(String) });
    const tag = (await app.inject({ method: 'POST', url: '/api/tags', payload: { name: 'Long reads', color: '#7c3aed' } })).json();
    expect((await app.inject({ method: 'PUT', url: `/api/articles/${article.id}/tags`, payload: { tagIds: [tag.id] } })).json()).toMatchObject({ tags: [{ name: 'Long reads', color: '#7c3aed' }] });
    expect((await app.inject({ method: 'PATCH', url: `/api/articles/${article.id}`, payload: { read: false, starred: false } })).json()).toMatchObject({ readAt: null, starredAt: null });
    await app.close();
  });

  it('expires bulk-read undo tokens after five seconds', () => {
    const database = openDatabase(':memory:');
    const feed = database.db.insert(feeds).values({ title: 'Journal', url: 'https://journal.test/feed' }).returning().get();
    database.db.insert(articles).values({ feedId: feed.id, guid: 'undo', url: 'https://journal.test/undo', title: 'Undo', publishedAt: new Date(), hash: 'undo' }).run();
    let time = new Date('2026-07-10T04:00:00Z');
    const service = new ArticleService(database, fetch, () => time);
    const result = service.markAllRead({ view: 'all' });
    time = new Date(time.getTime() + 5_000);
    expect(service.undoMarkAll(result.undoToken)).toBeNull();
    expect(database.db.select().from(articles).get()?.readAt).not.toBeNull();
    database.close();
  });
});
