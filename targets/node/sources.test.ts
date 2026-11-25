import { afterEach, describe, expect, it } from 'vitest';
import Parser from 'rss-parser';
import {
  SourceDiscoveryService,
  nativeSource,
  sourceUrl,
} from '../../packages/core/src/source-discovery.js';
import { SourceService } from './src/services/source-service.js';
import { openDatabase } from './src/db/database.js';
import { createApp } from './src/app.js';
import { BrewService } from './src/services/brew-service.js';
import { newBrewSection, defaultDelivery } from '../../packages/core/src/composition-model.js';
import { articles, feeds } from './src/db/schema.js';

const xml = { parse: (body: string) => new Parser().parseString(body) };
const rss = (title = 'Essays') =>
  `<rss version="2.0"><channel><title>${title}</title><link>https://lowtide.news</link><item><guid>a</guid><title>Quiet tools</title><link>https://lowtide.news/a</link><pubDate>Wed, 25 Nov 2026 00:00:00 GMT</pubDate></item><item><guid>b</guid><title>Figma essay</title><link>https://lowtide.news/b</link><pubDate>Wed, 18 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
const closes: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
describe('native source discovery', () => {
  it.each([
    [
      'youtube.com/channel/UCquiet',
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCquiet',
      'youtube',
    ],
    [
      'https://youtube.com/playlist?list=PLquiet',
      'https://www.youtube.com/feeds/videos.xml?playlist_id=PLquiet',
      'youtube',
    ],
    ['https://reddit.com/r/design/', 'https://www.reddit.com/r/design/.rss', 'subreddit'],
    ['https://mastodon.social/@brew', 'https://mastodon.social/@brew.rss', 'mastodon'],
    [
      'https://bsky.app/profile/brew.bsky.social/post/123',
      'https://bsky.app/profile/brew.bsky.social/rss',
      'bluesky',
    ],
    ['pcast://publisher.test/podcast.xml', 'https://publisher.test/podcast.xml', 'podcast'],
  ])('converts %s to its native feed', (input, url, kind) =>
    expect(nativeSource(input!)).toMatchObject({ url: new URL(url!), kind }),
  );
  it('accepts bare domains/ports and rejects non-HTTP URLs', () => {
    expect(sourceUrl('localhost:4400/rss#x').toString()).toBe('https://localhost:4400/rss');
    expect(() => sourceUrl('javascript:alert(1)')).toThrow('HTTP');
  });
  it('discovers multiple validated feeds, resolves base URLs, deduplicates redirects, and detects a real subscription hint', async () => {
    const calls: string[] = [];
    const service = new SourceDiscoveryService(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://lowtide.news/')
        return new Response(
          '<html><head><meta property="og:site_name" content="Low Tide"><base href="/public/"><link rel="alternate" type="application/rss+xml" href="essays.xml"><link rel="alternate" type="application/atom+xml" href="links.xml"></head><body><a href="/subscribe">Subscribe by email</a></body></html>',
        );
      if (url.includes('/public/'))
        return new Response(
          rss(url.includes('essays') ? 'Low Tide · Essays' : 'Low Tide · Links'),
          { headers: { 'content-type': 'application/rss+xml' } },
        );
      return new Response('', { status: 404 });
    }, xml);
    const result = await service.discover('lowtide.news');
    expect(result.newsletter).toEqual({ title: 'Low Tide' });
    expect(result.candidates.map((item) => [item.title, item.url, item.cadence])).toEqual([
      ['Low Tide · Essays', 'https://lowtide.news/public/essays.xml', 'about 1 a week'],
      ['Low Tide · Links', 'https://lowtide.news/public/links.xml', 'about 1 a week'],
    ]);
    expect(calls).toHaveLength(7);
  });
  it('resolves a YouTube handle and Apple podcast ID before validating the native feed', async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://youtube.com/@brew')
        return new Response('<meta itemprop="channelId" content="UCbrew">');
      if (url.includes('itunes.apple.com/lookup'))
        return Response.json({ results: [{ feedUrl: 'https://publisher.test/feed.xml' }] });
      return new Response(rss());
    };
    const service = new SourceDiscoveryService(fetcher, xml);
    expect((await service.discover('https://youtube.com/@brew')).candidates[0]?.url).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCbrew',
    );
    expect(
      (await service.discover('https://podcasts.apple.com/us/podcast/quiet/id123')).candidates[0]
        ?.url,
    ).toBe('https://publisher.test/feed.xml');
    expect(calls).toContain('https://itunes.apple.com/lookup?id=123&entity=podcast');
  });
  it('does not invent feeds when providers reject or retire them', async () => {
    const service = new SourceDiscoveryService(async () => new Response('', { status: 403 }), xml);
    const result = await service.discover('https://reddit.com/r/design');
    expect(result.candidates).toEqual([]);
    expect(result.notice).toContain('no longer supports');
    await expect(service.discover('https://bsky.app/profile/locked.test')).rejects.toThrow(
      'HTTP 403',
    );
  });
  it('omits posting cadence when a feed does not declare publication dates', async () => {
    const service = new SourceDiscoveryService(
      async () =>
        new Response(
          '<rss version="2.0"><channel><title>Undated</title><item><guid>a</guid><title>A</title></item><item><guid>b</guid><title>B</title></item></channel></rss>',
        ),
      xml,
    );
    expect((await service.discover('https://example.test/rss')).candidates[0]).toEqual({
      url: 'https://example.test/rss',
      title: 'Undated',
      type: 'rss',
    });
  });
});
describe('source state and REST integration', () => {
  it('persists a browser saved search and uses the Reader FTS compiler before section filtering/limits', async () => {
    const database = openDatabase(':memory:');
    closes.push(database.close);
    const sources = new SourceService(database);
    const saved = sources.saveSearch({
      clientId: 'browser-search',
      name: 'Figma mentions',
      query: 'figma',
    });
    expect(
      sources.saveSearch({ clientId: 'browser-search', name: 'Figma mentions', query: 'figma' }).id,
    ).toBe(saved.id);
    const feed = database.db
      .insert(feeds)
      .values({ title: 'Design', url: 'https://example.test/rss' })
      .returning()
      .get();
    for (let index = 0; index < 25; index++)
      database.db
        .insert(articles)
        .values({
          feedId: feed.id,
          guid: String(index),
          hash: String(index),
          url: `https://example.test/${index}`,
          title: index === 24 ? 'Figma notes' : 'Other notes',
          publishedAt: new Date('2026-11-25T00:00:00Z'),
        })
        .run();
    const brews = new BrewService(database);
    const value = {
      name: 'Morning',
      enabled: true,
      timezone: 'UTC',
      schedule: { kind: 'daily' as const, time: '07:00' },
      delivery: defaultDelivery(),
      sections: [
        {
          ...newBrewSection('search'),
          sources: [{ kind: 'saved_search' as const, id: saved.id }],
          maxItems: 1,
        },
      ],
    };
    const preview = await brews.previewComposition(value, 0, '2026-11-25T07:00:00Z');
    expect(preview.snapshot.sections[0]!.items.map((item) => item.title)).toEqual(['Figma notes']);
    expect(preview.snapshot.sections[0]!.matchingItems).toBe(1);
    expect(sources.searches()).toEqual([saved]);
  });
  it('returns no fabricated inbound address, and reads only an active configured address', () => {
    const database = openDatabase(':memory:');
    closes.push(database.close);
    const sources = new SourceService(database);
    expect(sources.mailbox()).toEqual({ address: null });
    database.sqlite.exec(
      "INSERT INTO inbound_addresses(id,address,mechanism,active) VALUES(1,'inactive@example.test','imap',0),(2,'letters@example.test','imap',1)",
    );
    expect(sources.mailbox()).toEqual({ address: 'letters@example.test' });
  });
  it('exposes discovery without writes and rejects malformed saved searches', async () => {
    const database = openDatabase(':memory:');
    const app = await createApp({ database, fetcher: async () => new Response(rss()) });
    closes.push(() => app.close());
    const before = database.sqlite.prepare('SELECT total_changes() AS count').get();
    const response = await app.inject({
      method: 'POST',
      url: '/api/sources/discover',
      payload: { url: 'lowtide.news/feed' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().candidates).toHaveLength(1);
    expect(database.sqlite.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/sources/searches',
          payload: { clientId: 'x', name: '', query: 'a' },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject('/api/sources/mailbox')).json()).toEqual({ address: null });
  });
});
