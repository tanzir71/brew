import type { BrewDatabase } from '../db/database.js';
import type {
  SearchPort,
  SearchScope,
  SearchOptions,
  SearchRow,
} from '../../../../packages/core/src/ports.js';
export class NodeSearch implements SearchPort {
  constructor(private readonly database: BrewDatabase) {}
  private filters(query: string, scope: SearchScope, options: SearchOptions) {
    const clauses = ['articles_fts MATCH ?', 'a.hidden = 0', 'f.muted = 0'];
    const parameters: Array<string | number> = [query];
    if (scope === 'folder') {
      if (options.folderId === undefined) throw new Error('folderId is required for folder search');
      clauses.push('f.folder_id = ?');
      parameters.push(options.folderId);
    }
    if (scope === 'starred') clauses.push('a.starred_at IS NOT NULL');
    if (options.unread) clauses.push('a.read_at IS NULL');
    return { clauses, parameters };
  }
  count(query: string, scope: SearchScope, options: SearchOptions): number {
    const { clauses, parameters } = this.filters(query, scope, options);
    return (
      this.database.sqlite
        .prepare(
          `SELECT count(*) AS count FROM articles_fts JOIN articles a ON a.id=articles_fts.rowid JOIN feeds f ON f.id=a.feed_id WHERE ${clauses.join(' AND ')}`,
        )
        .get(...parameters) as { count: number }
    ).count;
  }
  search(
    query: string,
    scope: SearchScope,
    options: SearchOptions & { limit: number; offset: number },
  ): SearchRow[] {
    const { clauses, parameters } = this.filters(query, scope, options);
    const limit = options.limit;
    const offset = options.offset;
    parameters.push(limit, offset);
    const direction = options.sort === 'oldest' ? 'ASC' : 'DESC';
    const order = options.sort
      ? `a.published_at ${direction}, bm25(articles_fts), a.id ${direction}`
      : 'bm25(articles_fts), a.published_at DESC, a.id DESC';
    const rows = this.database.sqlite
      .prepare(
        `SELECT a.id, a.url, a.title, a.author, a.summary_html AS summaryHtml, a.image_url AS imageUrl, a.highlight_color AS highlightColor, a.enclosure_url AS enclosureUrl, a.enclosure_type AS enclosureType, a.published_at AS publishedAt, a.read_at AS readAt, a.starred_at AS starredAt, f.id AS feedId, f.title AS feedTitle, fo.id AS folderId, fo.title AS folderTitle FROM articles_fts JOIN articles a ON a.id = articles_fts.rowid JOIN feeds f ON f.id = a.feed_id LEFT JOIN folders fo ON fo.id = f.folder_id WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...parameters) as SearchRow[];
    return rows;
  }
}
