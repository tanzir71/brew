import type { ArticlePage, ArticleSummary, ReaderFeed, ReaderFolder, ReaderNavigation } from '../../shared/api.js';
import type { BrewDatabase } from '../db/database.js';

interface CountRow { count: number }
interface FeedRow { id: number; folderId: number | null; title: string; muted: number; unreadCount: number }
interface FolderRow { id: number; title: string; position: number }
interface ArticleRow { id: number; url: string; title: string; author: string | null; summaryHtml: string | null; imageUrl: string | null; highlightColor: string | null; publishedAt: number; readAt: number | null; starredAt: number | null; feedId: number; feedTitle: string; folderId: number | null; folderTitle: string | null }

export type ReaderView = 'all' | 'today' | 'starred';
export interface ArticleQuery { view: ReaderView; feedId?: number; folderId?: number; limit?: number; unread?: boolean; sort?: 'newest' | 'oldest'; cursor?: string }

export class ReaderService {
  constructor(private readonly database: BrewDatabase, private readonly now: () => Date = () => new Date()) {}

  navigation(): ReaderNavigation {
    const todaySince = this.now().getTime() - 86_400_000;
    const count = (where: string, value?: number) => (this.database.sqlite.prepare(`SELECT count(*) AS count FROM articles a JOIN feeds f ON f.id = a.feed_id WHERE a.hidden = 0 AND f.muted = 0 AND ${where}`).get(...(value === undefined ? [] : [value])) as CountRow).count;
    const feedRows = this.database.sqlite.prepare(`SELECT f.id, f.folder_id AS folderId, f.title, f.muted, count(a.id) AS unreadCount FROM feeds f LEFT JOIN articles a ON a.feed_id = f.id AND a.read_at IS NULL AND a.hidden = 0 WHERE f.muted = 0 GROUP BY f.id ORDER BY f.title COLLATE NOCASE`).all() as FeedRow[];
    const folderRows = this.database.sqlite.prepare('SELECT id, title, position FROM folders ORDER BY position, title COLLATE NOCASE').all() as FolderRow[];
    const mapFeed = (feed: FeedRow): ReaderFeed => ({ id: feed.id, folderId: feed.folderId, title: feed.title, unreadCount: feed.unreadCount, muted: Boolean(feed.muted) });
    const folders: ReaderFolder[] = folderRows.map((folder) => { const childFeeds = feedRows.filter((feed) => feed.folderId === folder.id).map(mapFeed); return { id: folder.id, title: folder.title, unreadCount: childFeeds.reduce((sum, feed) => sum + feed.unreadCount, 0), feeds: childFeeds }; });
    return { counts: { all: count('a.read_at IS NULL'), today: count('a.read_at IS NULL AND a.published_at >= ?', todaySince), starred: count('a.starred_at IS NOT NULL') }, folders, unfiled: feedRows.filter((feed) => feed.folderId === null).map(mapFeed) };
  }

  articles(query: ArticleQuery): ArticlePage {
    const clauses = ['a.hidden = 0', 'f.muted = 0'];
    const parameters: number[] = [];
    if (query.view === 'today') { clauses.push('a.published_at >= ?'); parameters.push(this.now().getTime() - 86_400_000); }
    if (query.view === 'starred') clauses.push('a.starred_at IS NOT NULL');
    if (query.unread) clauses.push('a.read_at IS NULL');
    if (query.feedId !== undefined) { clauses.push('a.feed_id = ?'); parameters.push(query.feedId); }
    if (query.folderId !== undefined) { clauses.push('f.folder_id = ?'); parameters.push(query.folderId); }
    const direction = query.sort === 'oldest' ? 'ASC' : 'DESC';
    if (query.cursor) {
      const [timestamp, id] = query.cursor.split(':').map(Number);
      if (!Number.isFinite(timestamp) || !Number.isFinite(id)) throw new Error('Invalid cursor');
      const operator = direction === 'ASC' ? '>' : '<';
      clauses.push(`(a.published_at ${operator} ? OR (a.published_at = ? AND a.id ${operator} ?))`);
      parameters.push(timestamp!, timestamp!, id!);
    }
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    parameters.push(limit + 1);
    const rows = this.database.sqlite.prepare(`SELECT a.id, a.url, a.title, a.author, a.summary_html AS summaryHtml, a.image_url AS imageUrl, a.highlight_color AS highlightColor, a.published_at AS publishedAt, a.read_at AS readAt, a.starred_at AS starredAt, f.id AS feedId, f.title AS feedTitle, fo.id AS folderId, fo.title AS folderTitle FROM articles a JOIN feeds f ON f.id = a.feed_id LEFT JOIN folders fo ON fo.id = f.folder_id WHERE ${clauses.join(' AND ')} ORDER BY a.published_at ${direction}, a.id ${direction} LIMIT ?`).all(...parameters) as ArticleRow[];
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map((row): ArticleSummary => ({ ...row, publishedAt: new Date(row.publishedAt).toISOString(), readAt: row.readAt === null ? null : new Date(row.readAt).toISOString(), starredAt: row.starredAt === null ? null : new Date(row.starredAt).toISOString() }));
    const last = pageRows.at(-1);
    return { items, nextCursor: hasMore && last ? `${last.publishedAt}:${last.id}` : null };
  }
}
