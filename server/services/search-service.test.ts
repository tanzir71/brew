import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../db/database.js';
import { articles, feeds, folders } from '../db/schema.js';
import { compileFtsQuery, SearchService } from './search-service.js';

describe('SearchService', () => {
  it('searches title and content with folder and starred scopes while triggers stay synchronized', () => {
    const database = openDatabase(':memory:');
    const folder = database.db.insert(folders).values({ title: 'Design' }).returning().get();
    const feed = database.db
      .insert(feeds)
      .values({ title: 'Notes', url: 'https://search.test/feed', folderId: folder.id })
      .returning()
      .get();
    const first = database.db
      .insert(articles)
      .values({
        feedId: feed.id,
        guid: 'one',
        url: 'https://search.test/one',
        title: 'Calm interfaces',
        contentHtml: '<p>A semantic comet appears.</p>',
        publishedAt: new Date(),
        starredAt: new Date(),
        hash: 'search-one',
      })
      .returning()
      .get();
    database.db
      .insert(articles)
      .values({
        feedId: feed.id,
        guid: 'two',
        url: 'https://search.test/two',
        title: 'Other note',
        contentHtml: '<p>Nothing relevant.</p>',
        publishedAt: new Date(),
        hash: 'search-two',
      })
      .run();
    const service = new SearchService(database);
    expect(service.search('semantic comet', 'all').items).toEqual([
      expect.objectContaining({ title: 'Calm interfaces' }),
    ]);
    expect(service.search('calm', 'folder', { folderId: folder.id }).items).toHaveLength(1);
    expect(service.search('calm', 'starred').items).toHaveLength(1);
    database.db
      .update(articles)
      .set({ title: 'Quiet geometry' })
      .where(eq(articles.id, first.id))
      .run();
    expect(service.search('geometry', 'all').items).toHaveLength(1);
    database.db.delete(articles).where(eq(articles.id, first.id)).run();
    expect(service.search('geometry', 'all').items).toHaveLength(0);
    database.close();
  });

  it('compiles user text into bounded literal prefix terms', () => {
    expect(compileFtsQuery('  design + systems  ')).toBe('"design"* AND "systems"*');
    expect(compileFtsQuery('" OR *')).toBe('"OR"*');
    expect(compileFtsQuery('!!!')).toBeNull();
  });
});
