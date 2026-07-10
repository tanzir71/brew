import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { articles, feeds } from '../db/schema.js';
import type { ParsedArticle } from './feed-parser.js';
import { sanitizeArticleHtml } from './html-sanitizer.js';
import { articleHash, IngestPipeline } from './ingest-pipeline.js';

const hostile = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/hostile-article.html'), 'utf8');
const baseArticle = (values: Partial<ParsedArticle> = {}): ParsedArticle => ({ guid: 'guid-1', url: 'https://example.test/story?utm_source=rss', title: ' A  Story ', author: 'Author', summaryHtml: '<p>Summary</p>', contentHtml: hostile, publishedAt: new Date('2026-07-10T03:00:00Z'), ...values });

describe('article sanitization', () => {
  it('removes executable markup, tracking pixels, and known link parameters', () => {
    const clean = sanitizeArticleHtml(hostile)!;
    expect(clean).not.toMatch(/script|iframe|onclick|onerror|javascript:/i);
    expect(clean).not.toContain('pixel.gif');
    expect(clean).not.toMatch(/utm_source|fbclid/);
    expect(clean).toContain('keep=yes');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain('hero.jpg');
  });

  it.each([
    ['tracking parameters', 'https://example.test/story?utm_medium=rss&keep=1', 'https://example.test/story?keep=1'],
    ['case and spacing', 'https://example.test/story', 'https://example.test/story'],
  ])('produces stable hashes across %s', (_name, left, right) => {
    expect(articleHash(left, ' A  Story ')).toBe(articleHash(right, 'a story'));
  });
});

describe('IngestPipeline', () => {
  it('persists sanitized articles and deduplicates by guid then normalized hash', () => {
    const database = openDatabase(':memory:');
    const feed = database.db.insert(feeds).values({ url: 'https://example.test/feed', title: 'Example' }).returning().get();
    const pipeline = new IngestPipeline(database);
    expect(pipeline.ingest(feed, [
      baseArticle(),
      baseArticle({ url: 'https://example.test/different', title: 'Different duplicate guid' }),
      baseArticle({ guid: 'guid-2', url: 'https://example.test/story?fbclid=other', title: 'a story' }),
    ])).toBe(1);
    const stored = database.db.select().from(articles).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ guid: 'guid-1', url: 'https://example.test/story', title: 'A  Story', imageUrl: 'https://images.test/hero.jpg' });
    expect(stored[0]?.contentHtml).not.toMatch(/script|iframe|onclick|pixel.gif|utm_source|fbclid/i);
    expect(pipeline.ingest(feed, [baseArticle({ guid: 'guid-3', url: 'https://example.test/new', title: 'New' })])).toBe(1);
    expect(database.db.select().from(articles).all()).toHaveLength(2);
    database.close();
  });

  it('allows the same normalized hash in different feeds', () => {
    const database = openDatabase(':memory:');
    const one = database.db.insert(feeds).values({ url: 'https://one.test/feed', title: 'One' }).returning().get();
    const two = database.db.insert(feeds).values({ url: 'https://two.test/feed', title: 'Two' }).returning().get();
    const pipeline = new IngestPipeline(database);
    expect(pipeline.ingest(one, [baseArticle()])).toBe(1);
    expect(pipeline.ingest(two, [baseArticle()])).toBe(1);
    database.close();
  });
});
