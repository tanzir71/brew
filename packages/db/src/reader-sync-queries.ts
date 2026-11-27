import {
  ReaderSyncError,
  type SyncQuery,
  type SyncStream,
  type SyncItem,
} from '../../core/src/reader-sync.js';
import { readerNewsletterVisibility } from './reader-queries.js';
export type SyncRow = Omit<SyncItem, 'read' | 'starred' | 'tags'> & {
  read: number;
  starred: number;
};
export const syncFrom =
  'FROM articles a JOIN feeds f ON f.id=a.feed_id LEFT JOIN folders fo ON fo.id=f.folder_id';
export const syncFeedsQuery = `SELECT f.id,f.title,f.url,f.site_url AS siteUrl,f.folder_id AS folderId,f.favicon_url AS faviconUrl,coalesce(f.last_fetched_at,f.created_at) AS updated, count(CASE WHEN a.hidden=0 AND a.read_at IS NULL AND ${readerNewsletterVisibility} THEN 1 END) AS unread FROM feeds f LEFT JOIN articles a ON a.feed_id=f.id GROUP BY f.id ORDER BY f.id`;
export const syncSummaryQuery = `SELECT count(*) AS totalItems,count(CASE WHEN a.read_at IS NULL THEN 1 END) AS totalUnread,coalesce(max(CASE WHEN a.read_at IS NULL THEN a.published_at END),0) AS newestUnread ${syncFrom} WHERE a.hidden=0 AND ${readerNewsletterVisibility}`;
export function syncWhere(query: SyncQuery) {
  const values: unknown[] = [],
    clauses = ['a.hidden=0'];
  const streams = (input: SyncStream[]) => {
    if (
      input.some(
        (s) => !['all', 'read', 'unread', 'starred', 'feed', 'folder', 'label'].includes(s.kind),
      )
    )
      throw new ReaderSyncError(400, 'Unsupported reader stream.');
    values.push(JSON.stringify(input));
    return `EXISTS(SELECT 1 FROM json_each(?) s WHERE
        json_extract(s.value,'$.kind')='all'
        OR (json_extract(s.value,'$.kind')='read' AND a.read_at IS NOT NULL)
        OR (json_extract(s.value,'$.kind')='unread' AND a.read_at IS NULL)
        OR (json_extract(s.value,'$.kind')='starred' AND a.starred_at IS NOT NULL)
        OR (json_extract(s.value,'$.kind')='feed' AND a.feed_id=json_extract(s.value,'$.id'))
        OR (json_extract(s.value,'$.kind')='folder' AND f.folder_id=json_extract(s.value,'$.id'))
        OR (json_extract(s.value,'$.kind')='label' AND (fo.title=json_extract(s.value,'$.name') OR EXISTS(SELECT 1 FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id=a.id AND t.name=json_extract(s.value,'$.name')))))`;
  };
  if (!query.ids && !query.streams?.some((s) => s.kind === 'feed'))
    clauses.push(readerNewsletterVisibility);
  if (query.streams?.length) clauses.push(streams(query.streams));
  if (query.exclude?.length) clauses.push(`NOT (${streams(query.exclude)})`);
  if (query.ids) {
    clauses.push('a.id IN (SELECT value FROM json_each(?))');
    values.push(JSON.stringify(query.ids));
  }
  for (const [key, comparison, column] of [
    ['after', '>', 'published_at'],
    ['before', '<', 'published_at'],
    ['fetchedAfter', '>=', 'fetched_at'],
    ['fetchedBefore', '<', 'fetched_at'],
    ['afterId', '>', 'id'],
    ['beforeId', '<', 'id'],
  ] as const)
    if (query[key] !== undefined) {
      clauses.push(`a.${column}${comparison}?`);
      values.push(query[key]);
    }
  return { values, clause: clauses.map((value) => `(${value})`).join(' AND ') };
}

export function syncItemsQuery(query: SyncQuery) {
  const { values, clause } = syncWhere(query);
  const pagination: unknown[] = [],
    limit = query.limit ?? 1000,
    oldest = query.oldest === true;
  let boundary = '';
  if (query.cursor) {
    const match = /^bs1:([on]):(-?\d+):([1-9]\d*)$/.exec(query.cursor);
    if (
      !match ||
      (match[1] === 'o') !== oldest ||
      !Number.isSafeInteger(Number(match[2])) ||
      !Number.isSafeInteger(Number(match[3]))
    )
      throw new ReaderSyncError(400, 'Invalid reader continuation.');
    const comparison = oldest ? '>' : '<';
    boundary = ` AND (a.published_at${comparison}? OR (a.published_at=? AND a.id${comparison}?))`;
    pagination.push(Number(match[2]), Number(match[2]), Number(match[3]));
  }

  return {
    limit,
    oldest,
    count: { sql: `SELECT count(*) AS n ${syncFrom} WHERE ${clause}`, values },
    rows: {
      sql: `SELECT a.id,a.feed_id AS feedId,a.title,a.author,a.url,${query.idsOnly ? "''" : "coalesce(a.full_text_html,a.content_html,a.summary_html,'')"} AS html,a.published_at AS published,a.fetched_at AS fetched,a.read_at IS NOT NULL AS read,a.starred_at IS NOT NULL AS starred,f.title AS feedTitle,f.url AS feedUrl,f.site_url AS siteUrl,fo.title AS folder ${syncFrom} WHERE ${clause}${boundary} ORDER BY ${query.byId ? 'a.id' : 'a.published_at'} ${oldest ? 'ASC' : 'DESC'}, a.id ${oldest ? 'ASC' : 'DESC'} LIMIT ?`,
      values: [...values, ...pagination, limit + 1],
    },
  };
}
export const syncLabelsQuery =
  'SELECT at.article_id AS id,t.name FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id IN (SELECT value FROM json_each(?)) ORDER BY t.name';
export function syncItemPage(
  rows: SyncRow[],
  total: number,
  query: SyncQuery,
  tags: Array<{ id: number; name: string }>,
) {
  const limit = query.limit ?? 1000,
    page = rows.slice(0, limit),
    labels = new Map<number, string[]>();
  for (const tag of tags) labels.set(tag.id, [...(labels.get(tag.id) ?? []), tag.name]);
  const last = page.at(-1);
  return {
    total,
    items: page.map((row) => ({
      ...row,
      read: Boolean(row.read),
      starred: Boolean(row.starred),
      tags: labels.get(row.id) ?? [],
    })),
    ...(rows.length > limit && last
      ? { continuation: `bs1:${query.oldest === true ? 'o' : 'n'}:${last.published}:${last.id}` }
      : {}),
  };
}
