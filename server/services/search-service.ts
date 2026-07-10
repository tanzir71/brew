import { performance } from 'node:perf_hooks';
import type { ArticleSummary, SearchPage } from '../../shared/api.js';
import type { BrewDatabase } from '../db/database.js';

export type SearchScope = 'all' | 'folder' | 'starred';
interface SearchRow {
  id: number;
  url: string;
  title: string;
  author: string | null;
  summaryHtml: string | null;
  imageUrl: string | null;
  publishedAt: number;
  readAt: number | null;
  starredAt: number | null;
  feedId: number;
  feedTitle: string;
  folderId: number | null;
  folderTitle: string | null;
}

export function compileFtsQuery(input: string): string | null {
  const terms =
    input
      .normalize('NFKC')
      .match(/[\p{L}\p{N}_-]+/gu)
      ?.slice(0, 12) ?? [];
  return terms.length
    ? terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' AND ')
    : null;
}

export class SearchService {
  constructor(private readonly database: BrewDatabase) {}

  search(
    input: string,
    scope: SearchScope,
    options: { folderId?: number; limit?: number; offset?: number } = {},
  ): SearchPage {
    const started = performance.now();
    const query = compileFtsQuery(input);
    if (!query) return { items: [], nextOffset: null, durationMs: performance.now() - started };
    const clauses = ['articles_fts MATCH ?', 'a.hidden = 0', 'f.muted = 0'];
    const parameters: Array<string | number> = [query];
    if (scope === 'folder') {
      if (options.folderId === undefined) throw new Error('folderId is required for folder search');
      clauses.push('f.folder_id = ?');
      parameters.push(options.folderId);
    }
    if (scope === 'starred') clauses.push('a.starred_at IS NOT NULL');
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);
    parameters.push(limit + 1, offset);
    const rows = this.database.sqlite
      .prepare(
        `SELECT a.id, a.url, a.title, a.author, a.summary_html AS summaryHtml, a.image_url AS imageUrl, a.published_at AS publishedAt, a.read_at AS readAt, a.starred_at AS starredAt, f.id AS feedId, f.title AS feedTitle, fo.id AS folderId, fo.title AS folderTitle FROM articles_fts JOIN articles a ON a.id = articles_fts.rowid JOIN feeds f ON f.id = a.feed_id LEFT JOIN folders fo ON fo.id = f.folder_id WHERE ${clauses.join(' AND ')} ORDER BY bm25(articles_fts), a.published_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...parameters) as SearchRow[];
    const hasMore = rows.length > limit;
    const items = rows
      .slice(0, limit)
      .map((row): ArticleSummary => ({
        ...row,
        publishedAt: new Date(row.publishedAt).toISOString(),
        readAt: row.readAt === null ? null : new Date(row.readAt).toISOString(),
        starredAt: row.starredAt === null ? null : new Date(row.starredAt).toISOString(),
      }));
    return {
      items,
      nextOffset: hasMore ? offset + limit : null,
      durationMs: performance.now() - started,
    };
  }
}
