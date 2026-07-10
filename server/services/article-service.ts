import { eq, inArray } from 'drizzle-orm';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { randomUUID } from 'node:crypto';
import type { ArticleDetail } from '../../shared/api.js';
import type { BrewDatabase } from '../db/database.js';
import { articleTags, articles, tags } from '../db/schema.js';
import { sanitizeArticleHtml } from './html-sanitizer.js';

type Fetch = typeof globalThis.fetch;
interface UndoEntry { articleIds: number[]; expiresAt: number }
export interface MarkAllScope { view: 'all' | 'today' | 'starred'; feedId?: number; folderId?: number }
interface DetailRow { id: number; title: string; author: string | null; summaryHtml: string | null; contentHtml: string | null; fullTextHtml: string | null; imageUrl: string | null; highlightColor: string | null; url: string; publishedAt: number; readAt: number | null; starredAt: number | null; feedId: number; feedTitle: string; folderId: number | null; folderTitle: string | null }
interface TagRow { id: number; name: string; color: string }

const wordCount = (html: string | null): number => {
  if (!html) return 0;
  const text = parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body.textContent ?? '';
  return text.trim() ? text.trim().split(/\s+/).length : 0;
};
const readTime = (html: string | null): number => Math.max(1, Math.ceil(wordCount(html) / 225));

export class ArticleService {
  private readonly undoEntries = new Map<string, UndoEntry>();
  constructor(private readonly database: BrewDatabase, private readonly fetcher: Fetch = globalThis.fetch, private readonly now: () => Date = () => new Date()) {}

  get(id: number): ArticleDetail | null {
    const row = this.database.sqlite.prepare('SELECT a.id, a.title, a.author, a.summary_html AS summaryHtml, a.content_html AS contentHtml, a.full_text_html AS fullTextHtml, a.image_url AS imageUrl, a.highlight_color AS highlightColor, a.url, a.published_at AS publishedAt, a.read_at AS readAt, a.starred_at AS starredAt, f.id AS feedId, f.title AS feedTitle, fo.id AS folderId, fo.title AS folderTitle FROM articles a JOIN feeds f ON f.id = a.feed_id LEFT JOIN folders fo ON fo.id = f.folder_id WHERE a.id = ?').get(id) as DetailRow | undefined;
    if (!row) return null;
    const tags = this.database.sqlite.prepare('SELECT t.id, t.name, t.color FROM tags t JOIN article_tags at ON at.tag_id = t.id WHERE at.article_id = ? ORDER BY t.name').all(id) as TagRow[];
    return { ...row, publishedAt: new Date(row.publishedAt).toISOString(), readAt: row.readAt === null ? null : new Date(row.readAt).toISOString(), starredAt: row.starredAt === null ? null : new Date(row.starredAt).toISOString(), readTimeMinutes: readTime(row.fullTextHtml ?? row.contentHtml ?? row.summaryHtml), tags };
  }

  async extractFullText(id: number): Promise<ArticleDetail | null> {
    const current = this.database.db.select().from(articles).where(eq(articles.id, id)).get();
    if (!current) return null;
    if (current.fullTextHtml) return this.get(id);
    const target = new URL(current.url);
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Article URL is not fetchable');
    const response = await this.fetcher(target, { headers: { Accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Article returned HTTP ${response.status}`);
    const html = await response.text();
    if (html.length > 5_000_000) throw new Error('Article page is too large');
    const { document } = parseHTML(html);
    for (const element of document.querySelectorAll('a[href], img[src]')) {
      const attribute = element.localName === 'a' ? 'href' : 'src';
      const value = element.getAttribute(attribute);
      if (value) { try { element.setAttribute(attribute, new URL(value, response.url || target).toString()); } catch { element.removeAttribute(attribute); } }
    }
    const parsed = new Readability(document as unknown as Document).parse();
    if (!parsed?.content) throw new Error('Could not extract readable article content');
    const clean = sanitizeArticleHtml(parsed.content);
    if (!clean) throw new Error('Extracted article was empty');
    this.database.db.update(articles).set({ fullTextHtml: clean }).where(eq(articles.id, id)).run();
    return this.get(id);
  }

  updateState(id: number, values: { read?: boolean; starred?: boolean }): ArticleDetail | null {
    if (!this.database.db.select({ id: articles.id }).from(articles).where(eq(articles.id, id)).get()) return null;
    const changes: { readAt?: Date | null; starredAt?: Date | null } = {};
    if (values.read !== undefined) changes.readAt = values.read ? new Date() : null;
    if (values.starred !== undefined) changes.starredAt = values.starred ? new Date() : null;
    if (Object.keys(changes).length) this.database.db.update(articles).set(changes).where(eq(articles.id, id)).run();
    return this.get(id);
  }

  listTags(): TagRow[] { return this.database.db.select().from(tags).orderBy(tags.name).all(); }
  createTag(name: string, color = '#b45309'): TagRow {
    const normalized = name.trim();
    if (!normalized) throw new Error('Tag name is required');
    this.database.db.insert(tags).values({ name: normalized, color }).onConflictDoNothing({ target: tags.name }).run();
    return this.database.db.select().from(tags).where(eq(tags.name, normalized)).get()!;
  }
  setTags(id: number, tagIds: number[]): ArticleDetail | null {
    if (!this.database.db.select({ id: articles.id }).from(articles).where(eq(articles.id, id)).get()) return null;
    const uniqueIds = [...new Set(tagIds)];
    if (uniqueIds.length) {
      const existing = this.database.db.select({ id: tags.id }).from(tags).where(inArray(tags.id, uniqueIds)).all();
      if (existing.length !== uniqueIds.length) throw new Error('One or more tags do not exist');
    }
    this.database.sqlite.transaction(() => {
      this.database.db.delete(articleTags).where(eq(articleTags.articleId, id)).run();
      if (uniqueIds.length) this.database.db.insert(articleTags).values(uniqueIds.map((tagId) => ({ articleId: id, tagId }))).run();
    })();
    return this.get(id);
  }

  markAllRead(scope: MarkAllScope): { updated: number; undoToken: string; expiresAt: string } {
    const clauses = ['a.hidden = 0', 'a.read_at IS NULL', 'f.muted = 0'];
    const parameters: number[] = [];
    if (scope.view === 'today') { clauses.push('a.published_at >= ?'); parameters.push(this.now().getTime() - 86_400_000); }
    if (scope.view === 'starred') clauses.push('a.starred_at IS NOT NULL');
    if (scope.feedId !== undefined) { clauses.push('a.feed_id = ?'); parameters.push(scope.feedId); }
    if (scope.folderId !== undefined) { clauses.push('f.folder_id = ?'); parameters.push(scope.folderId); }
    const ids = (this.database.sqlite.prepare(`SELECT a.id FROM articles a JOIN feeds f ON f.id = a.feed_id WHERE ${clauses.join(' AND ')}`).all(...parameters) as Array<{ id: number }>).map(({ id }) => id);
    const readAt = this.now();
    this.database.sqlite.transaction(() => { const update = this.database.sqlite.prepare('UPDATE articles SET read_at = ? WHERE id = ?'); for (const id of ids) update.run(readAt.getTime(), id); })();
    const token = randomUUID();
    const expiresAt = this.now().getTime() + 5_000;
    this.undoEntries.set(token, { articleIds: ids, expiresAt });
    for (const [key, entry] of this.undoEntries) if (entry.expiresAt < this.now().getTime()) this.undoEntries.delete(key);
    return { updated: ids.length, undoToken: token, expiresAt: new Date(expiresAt).toISOString() };
  }

  undoMarkAll(token: string): number | null {
    const entry = this.undoEntries.get(token);
    if (!entry || entry.expiresAt <= this.now().getTime()) { this.undoEntries.delete(token); return null; }
    this.database.sqlite.transaction(() => { const update = this.database.sqlite.prepare('UPDATE articles SET read_at = NULL WHERE id = ?'); for (const id of entry.articleIds) update.run(id); })();
    this.undoEntries.delete(token);
    return entry.articleIds.length;
  }
}
