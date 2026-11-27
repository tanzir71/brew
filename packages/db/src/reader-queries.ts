import type { ArticleSummary, ReaderNavigation } from '../../core/src/types/api.js';
import type { SearchOptions, SearchScope } from '../../core/src/ports.js';

export const readerNewsletterVisibility =
  "(f.kind<>'newsletter' OR coalesce(json_extract(f.settings_json,'$.onlyInBrew'),0)<>1)";
export interface ReaderArticleQuery {
  view: 'all' | 'today' | 'starred';
  feedId?: number;
  folderId?: number;
  limit?: number;
  unread?: boolean;
  sort?: 'newest' | 'oldest';
  cursor?: string;
  includeTotal?: boolean;
  offset?: number;
}
export interface SqlQuery {
  sql: string;
  values: Array<string | number>;
}
export type ArticleSummaryRow = Omit<ArticleSummary, 'publishedAt' | 'readAt' | 'starredAt'> & {
  publishedAt: number;
  readAt: number | null;
  starredAt: number | null;
};
export const articleSummaryColumns = `a.id,a.url,a.title,a.author,a.summary_html AS summaryHtml,a.image_url AS imageUrl,
  a.highlight_color AS highlightColor,a.enclosure_url AS enclosureUrl,a.enclosure_type AS enclosureType,
  a.published_at AS publishedAt,a.read_at AS readAt,a.starred_at AS starredAt,
  f.id AS feedId,f.title AS feedTitle,fo.id AS folderId,fo.title AS folderTitle`;
export const articleJoins =
  'FROM articles a JOIN feeds f ON f.id=a.feed_id LEFT JOIN folders fo ON fo.id=f.folder_id';
export function articleSummary(row: ArticleSummaryRow): ArticleSummary {
  return {
    ...row,
    publishedAt: new Date(row.publishedAt).toISOString(),
    readAt: row.readAt === null ? null : new Date(row.readAt).toISOString(),
    starredAt: row.starredAt === null ? null : new Date(row.starredAt).toISOString(),
  };
}
export function readerScope(
  query: Pick<ReaderArticleQuery, 'view' | 'feedId' | 'folderId' | 'unread'>,
  now: number,
) {
  const clauses = ['a.hidden=0', 'f.muted=0'];
  const values: Array<string | number> = [];
  if (query.view !== 'starred' && query.feedId === undefined)
    clauses.push(readerNewsletterVisibility);
  if (query.view === 'today') {
    clauses.push('a.published_at>=?');
    values.push(now - 86_400_000);
  }
  if (query.view === 'starred') clauses.push('a.starred_at IS NOT NULL');
  if (query.unread) clauses.push('a.read_at IS NULL');
  if (query.feedId !== undefined) {
    clauses.push('a.feed_id=?');
    values.push(query.feedId);
  }
  if (query.folderId !== undefined) {
    clauses.push('f.folder_id=?');
    values.push(query.folderId);
  }
  return { clauses, values };
}
export function readerArticlesQuery(query: ReaderArticleQuery, now: number) {
  const { clauses, values } = readerScope(query, now);
  const count: SqlQuery = {
    sql: `SELECT count(*) AS count ${articleJoins} WHERE ${clauses.join(' AND ')}`,
    values: [...values],
  };
  const direction = query.sort === 'oldest' ? 'ASC' : 'DESC';
  if (query.cursor) {
    const [timestamp, id] = query.cursor.split(':').map(Number);
    if (!Number.isFinite(timestamp) || !Number.isFinite(id)) throw new Error('Invalid cursor');
    const operator = direction === 'ASC' ? '>' : '<';
    clauses.push(`(a.published_at ${operator} ? OR (a.published_at=? AND a.id ${operator} ?))`);
    values.push(timestamp!, timestamp!, id!);
  }
  const limit = Math.min(100, Math.max(1, query.limit ?? 50)),
    offset = query.cursor ? 0 : (query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 50_000_000)
    throw new Error('Invalid article offset');
  return {
    count,
    limit,
    page: {
      sql: `SELECT ${articleSummaryColumns} ${articleJoins} WHERE ${clauses.join(' AND ')} ORDER BY a.published_at ${direction},a.id ${direction} LIMIT ? OFFSET ?`,
      values: [...values, limit + 1, offset],
    } satisfies SqlQuery,
  };
}
export function readerPage(rows: ArticleSummaryRow[], limit: number, total?: number) {
  const page = rows.slice(0, limit),
    last = page.at(-1);
  return {
    items: page.map(articleSummary),
    nextCursor: rows.length > limit && last ? `${last.publishedAt}:${last.id}` : null,
    ...(total === undefined ? {} : { total }),
  };
}
export function navigationQueries(now: number): SqlQuery[] {
  const count = (where: string, values: Array<string | number> = [], saved = false): SqlQuery => ({
    sql: `SELECT count(*) AS count FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE a.hidden=0 AND f.muted=0 AND ${saved ? '1=1' : readerNewsletterVisibility} AND ${where}`,
    values,
  });
  return [
    count('a.read_at IS NULL'),
    count('a.read_at IS NULL AND a.published_at>=?', [now - 86_400_000]),
    count('a.starred_at IS NOT NULL', [], true),
    {
      sql: `SELECT f.id,f.folder_id AS folderId,f.title,f.muted,count(a.id) AS unreadCount FROM feeds f LEFT JOIN articles a ON a.feed_id=f.id AND a.read_at IS NULL AND a.hidden=0 WHERE f.muted=0 AND ${readerNewsletterVisibility} GROUP BY f.id ORDER BY f.title COLLATE NOCASE`,
      values: [],
    },
    {
      sql: 'SELECT id,title,position FROM folders ORDER BY position,title COLLATE NOCASE',
      values: [],
    },
  ];
}
export type NavigationFeedRow = {
  id: number;
  folderId: number | null;
  title: string;
  muted: number;
  unreadCount: number;
};
export type NavigationFolderRow = { id: number; title: string; position: number };
export function readerNavigation(
  counts: number[],
  feeds: NavigationFeedRow[],
  folders: NavigationFolderRow[],
): ReaderNavigation {
  const map = (feed: NavigationFeedRow) => ({ ...feed, muted: Boolean(feed.muted) });
  return {
    counts: { all: counts[0]!, today: counts[1]!, starred: counts[2]! },
    folders: folders.map((folder) => {
      const children = feeds.filter((feed) => feed.folderId === folder.id).map(map);
      return {
        id: folder.id,
        title: folder.title,
        unreadCount: children.reduce((sum, feed) => sum + feed.unreadCount, 0),
        feeds: children,
      };
    }),
    unfiled: feeds.filter((feed) => feed.folderId === null).map(map),
  };
}
export function searchQueries(
  query: string,
  scope: SearchScope,
  options: SearchOptions & { limit: number; offset: number },
) {
  const clauses = ['articles_fts MATCH ?', 'a.hidden=0', 'f.muted=0'],
    values: Array<string | number> = [query];
  if (scope === 'folder') {
    if (options.folderId === undefined) throw new Error('folderId is required for folder search');
    clauses.push('f.folder_id=?');
    values.push(options.folderId);
  }
  if (scope === 'starred') clauses.push('a.starred_at IS NOT NULL');
  if (options.unread) clauses.push('a.read_at IS NULL');
  const from = `FROM articles_fts JOIN articles a ON a.id=articles_fts.rowid JOIN feeds f ON f.id=a.feed_id LEFT JOIN folders fo ON fo.id=f.folder_id WHERE ${clauses.join(' AND ')}`;
  const direction = options.sort === 'oldest' ? 'ASC' : 'DESC',
    order = options.sort
      ? `a.published_at ${direction},bm25(articles_fts),a.id ${direction}`
      : 'bm25(articles_fts),a.published_at DESC,a.id DESC';
  return {
    count: { sql: `SELECT count(*) AS count ${from}`, values: [...values] } satisfies SqlQuery,
    page: {
      sql: `SELECT ${articleSummaryColumns} ${from} ORDER BY ${order} LIMIT ? OFFSET ?`,
      values: [...values, options.limit, options.offset],
    } satisfies SqlQuery,
  };
}
