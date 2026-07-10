import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database.js';
import { feeds } from '../db/schema.js';
import { adaptiveInterval, effectiveInterval, PollerService } from './poller-service.js';

const fixture = (name: string) => fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures', name), 'utf8');
const now = new Date('2026-07-10T04:00:00Z');

describe('PollerService', () => {
  it.each([
    ['rss2.xml', 'application/rss+xml', 'RSS Two', 'rss-1'],
    ['atom.xml', 'application/atom+xml', 'Atom Notes', 'atom-1'],
    ['feed.json', 'application/feed+json', 'JSON Notes', 'json-1'],
  ])('parses and ingests %s', async (filename, contentType, title, guid) => {
    const database = openDatabase(':memory:');
    const feed = database.db.insert(feeds).values({ url: `https://fixture.test/${filename}`, title: 'Pending' }).returning().get();
    const ingested: string[] = [];
    const fetcher = vi.fn(async () => new Response(fixture(filename), { status: 200, headers: { 'content-type': contentType, etag: '"v1"', 'last-modified': 'Fri, 10 Jul 2026 03:00:00 GMT' } })) as unknown as typeof fetch;
    const result = await new PollerService(database, fetcher, (_feed, articles) => { ingested.push(...articles.map((article) => article.guid)); return articles.length; }, () => now).pollFeed(feed);
    expect(result).toMatchObject({ outcome: 'success', status: 200, newItems: 1 });
    expect(ingested).toEqual([guid]);
    expect(database.db.select().from(feeds).get()).toMatchObject({ title, etag: '"v1"', consecutiveFailures: 0 });
    database.close();
  });

  it.each([
    ['malformed XML', async () => new Response(fixture('malformed.xml'), { status: 200, headers: { 'content-type': 'application/rss+xml' } }), 0],
    ['HTTP 410', async () => new Response('Gone', { status: 410 }), 410],
  ])('backs off safely for %s', async (_name, responder, status) => {
    const database = openDatabase(':memory:');
    const feed = database.db.insert(feeds).values({ url: 'https://broken.test/feed', title: 'Broken', fetchIntervalMinutes: 30 }).returning().get();
    const result = await new PollerService(database, vi.fn(responder) as unknown as typeof fetch, undefined, () => now).pollFeed(feed);
    expect(result).toMatchObject({ outcome: 'error', status });
    const updated = database.db.select().from(feeds).get()!;
    expect(updated.consecutiveFailures).toBe(1);
    expect(updated.failingSince).toEqual(now);
    expect(effectiveInterval(updated)).toBe(60);
    database.close();
  });

  it('sends validators, treats 304 as success, and resets failures', async () => {
    const database = openDatabase(':memory:');
    const feed = database.db.insert(feeds).values({ url: 'https://cached.test/feed', title: 'Cached', etag: '"old"', lastModified: 'Thu, 09 Jul 2026 00:00:00 GMT', consecutiveFailures: 3 }).returning().get();
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('if-none-match')).toBe('"old"');
      expect(headers.get('if-modified-since')).toContain('09 Jul');
      return new Response(null, { status: 304 });
    }) as unknown as typeof fetch;
    expect(await new PollerService(database, fetcher, undefined, () => now).pollFeed(feed)).toMatchObject({ outcome: 'not-modified', status: 304 });
    expect(database.db.select().from(feeds).get()).toMatchObject({ consecutiveFailures: 0, lastStatus: 304, failingSince: null });
    database.close();
  });

  it('requests redirect following and caps concurrency at six', async () => {
    const database = openDatabase(':memory:');
    for (let index = 0; index < 9; index++) database.db.insert(feeds).values({ url: `https://redirect.test/${index}`, title: `Feed ${index}` }).run();
    let active = 0; let peak = 0;
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe('follow');
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return new Response(fixture('rss2.xml'), { status: 200, headers: { 'content-type': 'application/rss+xml' } });
    }) as unknown as typeof fetch;
    const results = await new PollerService(database, fetcher, undefined, () => now).pollDue();
    expect(results).toHaveLength(9);
    expect(peak).toBe(6);
    database.close();
  });

  it('adapts toward fifteen minutes for busy feeds and six hours for quiet feeds', () => {
    const busy = Array.from({ length: 11 }, (_, index) => ({ guid: `${index}`, url: '', title: '', author: null, summaryHtml: null, contentHtml: null, publishedAt: new Date(now.getTime() - index * 1000) }));
    expect(adaptiveInterval(30, busy, now)).toBe(23);
    expect(adaptiveInterval(20, busy, now)).toBe(15);
    expect(adaptiveInterval(240, [], now)).toBe(360);
    expect(adaptiveInterval(360, [], now)).toBe(360);
  });
});
