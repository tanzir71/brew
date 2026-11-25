import type { BrewDatabase } from '../db/database.js';
import type {
  SearchPort,
  SearchScope,
  SearchOptions,
  SearchRow,
} from '../../../../packages/core/src/ports.js';
export class NodeSearch implements SearchPort {
  constructor(private readonly database: BrewDatabase) {}
  search(
    query: string,
    scope: SearchScope,
    options: SearchOptions & { limit: number; offset: number },
  ): SearchRow[] {
    const clauses = ['articles_fts MATCH ?', 'a.hidden = 0', 'f.muted = 0'];
    const parameters: Array<string | number> = [query];
    if (scope === 'folder') {
      if (options.folderId === undefined) throw new Error('folderId is required for folder search');
      clauses.push('f.folder_id = ?');
      parameters.push(options.folderId);
    }
    if (scope === 'starred') clauses.push('a.starred_at IS NOT NULL');
    const limit = options.limit;
    const offset = options.offset;
    parameters.push(limit, offset);
    const rows = this.database.sqlite
      .prepare(
        `SELECT a.id, a.url, a.title, a.author, a.summary_html AS summaryHtml, a.image_url AS imageUrl, a.highlight_color AS highlightColor, a.enclosure_url AS enclosureUrl, a.enclosure_type AS enclosureType, a.published_at AS publishedAt, a.read_at AS readAt, a.starred_at AS starredAt, f.id AS feedId, f.title AS feedTitle, fo.id AS folderId, fo.title AS folderTitle FROM articles_fts JOIN articles a ON a.id = articles_fts.rowid JOIN feeds f ON f.id = a.feed_id LEFT JOIN folders fo ON fo.id = f.folder_id WHERE ${clauses.join(' AND ')} ORDER BY bm25(articles_fts), a.published_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...parameters) as SearchRow[];
    return rows;
  }
}
