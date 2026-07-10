import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/database.js';
import { articles, feeds, folders } from '../db/schema.js';

describe('reader navigation and views', () => {
  it('calculates calm unread counts and filters All, Today, and Starred', async () => {
    const database = openDatabase(':memory:');
    const folder = database.db.insert(folders).values({ title: 'Design' }).returning().get();
    const active = database.db.insert(feeds).values({ title: 'Active', url: 'https://active.test/feed', folderId: folder.id }).returning().get();
    const muted = database.db.insert(feeds).values({ title: 'Muted', url: 'https://muted.test/feed', folderId: folder.id, muted: true }).returning().get();
    const now = Date.now();
    database.db.insert(articles).values([
      { feedId: active.id, guid: 'today-unread', url: 'https://active.test/1', title: 'Today unread', publishedAt: new Date(now - 60_000), hash: 'h1' },
      { feedId: active.id, guid: 'today-read', url: 'https://active.test/2', title: 'Today read', publishedAt: new Date(now - 120_000), readAt: new Date(now), hash: 'h2' },
      { feedId: active.id, guid: 'old-star', url: 'https://active.test/3', title: 'Old starred', publishedAt: new Date(now - 3 * 86_400_000), starredAt: new Date(now), hash: 'h3' },
      { feedId: active.id, guid: 'hidden', url: 'https://active.test/4', title: 'Hidden', publishedAt: new Date(now), hidden: true, hash: 'h4' },
      { feedId: muted.id, guid: 'muted', url: 'https://muted.test/1', title: 'Muted item', publishedAt: new Date(now), hash: 'h5' },
    ]).run();
    const app = await createApp({ database });
    const navigation = (await app.inject('/api/reader/navigation')).json();
    expect(navigation.counts).toEqual({ all: 2, today: 1, starred: 1 });
    expect(navigation.folders[0]).toMatchObject({ title: 'Design', unreadCount: 2, feeds: [{ title: 'Active', unreadCount: 2 }] });
    expect((await app.inject('/api/articles?view=all')).json().items.map((item: { title: string }) => item.title)).toEqual(['Today unread', 'Today read', 'Old starred']);
    expect((await app.inject('/api/articles?view=today')).json().items).toHaveLength(2);
    expect((await app.inject('/api/articles?view=starred')).json().items).toEqual([expect.objectContaining({ title: 'Old starred' })]);
    const firstPage = (await app.inject('/api/articles?view=all&unread=true&sort=oldest&limit=1')).json();
    expect(firstPage).toMatchObject({ items: [expect.objectContaining({ title: 'Old starred' })], nextCursor: expect.any(String) });
    expect((await app.inject(`/api/articles?view=all&unread=true&sort=oldest&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`)).json()).toMatchObject({ items: [expect.objectContaining({ title: 'Today unread' })], nextCursor: null });
    expect((await app.inject('/api/articles?cursor=broken')).statusCode).toBe(400);
    const marked = (await app.inject({ method: 'POST', url: '/api/articles/mark-all-read', payload: { view: 'today', folderId: folder.id } })).json();
    expect(marked).toMatchObject({ updated: 1, undoToken: expect.any(String), expiresAt: expect.any(String) });
    expect((await app.inject('/api/reader/navigation')).json().counts.today).toBe(0);
    expect((await app.inject({ method: 'POST', url: '/api/articles/mark-all-read/undo', payload: { undoToken: marked.undoToken } })).json()).toEqual({ restored: 1 });
    expect((await app.inject('/api/reader/navigation')).json().counts.today).toBe(1);
    expect((await app.inject({ method: 'POST', url: '/api/articles/mark-all-read/undo', payload: { undoToken: marked.undoToken } })).statusCode).toBe(410);
    await app.close();
  });
});
