import { and, eq, or } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { BrewDatabase } from '../db/database.js';
import { articles, type Feed } from '../db/schema.js';
import type { ParsedArticle } from './feed-parser.js';
import { normalizedArticleUrl, sanitizeArticleHtml } from './html-sanitizer.js';
import type { RulesService } from './rules-service.js';

const normalizedTitle = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export const articleHash = (url: string, title: string): string => createHash('sha1').update(`${normalizedArticleUrl(url)}\n${normalizedTitle(title)}`).digest('hex');
export function trigramSimilarity(left: string, right: string): number {
  const grams = (value: string) => {
    const text = `  ${normalizedTitle(value)} `;
    const result = new Set<string>();
    for (let index = 0; index <= text.length - 3; index++) result.add(text.slice(index, index + 3));
    return result;
  };
  const a = grams(left); const b = grams(right);
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}

export class IngestPipeline {
  constructor(private readonly database: BrewDatabase, private readonly rules?: RulesService) {}

  async ingest(feed: Feed, incoming: ParsedArticle[]): Promise<number> {
    const insertedIds = this.database.sqlite.transaction(() => {
      const ids: number[] = [];
      for (const item of incoming) {
        const hash = articleHash(item.url, item.title);
        const duplicate = this.database.db.select({ id: articles.id }).from(articles).where(and(eq(articles.feedId, feed.id), or(eq(articles.guid, item.guid), eq(articles.hash, hash)))).get();
        if (duplicate) continue;
        const summaryHtml = sanitizeArticleHtml(item.summaryHtml);
        const contentHtml = sanitizeArticleHtml(item.contentHtml);
        const source = contentHtml ?? summaryHtml;
        let imageUrl: string | null = null;
        if (source) { const match = source.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i); imageUrl = match?.[1] ?? null; }
        const inserted = this.database.db.insert(articles).values({ feedId: feed.id, guid: item.guid, url: normalizedArticleUrl(item.url), title: item.title.trim() || '(untitled)', author: item.author?.trim() || null, summaryHtml, contentHtml, imageUrl, publishedAt: item.publishedAt, hash }).returning({ id: articles.id }).get();
        ids.push(inserted.id);
      }
      return ids;
    })();
    const duplicateFilter = this.database.sqlite.prepare("SELECT value FROM settings WHERE key = 'duplicate_filter_enabled'").get() as {value:string} | undefined;
    if (duplicateFilter?.value === 'true') {
      const cutoff = Date.now() - 3 * 86_400_000;
      for (const articleId of insertedIds) {
        const current = this.database.db.select({ title: articles.title }).from(articles).where(eq(articles.id, articleId)).get()!;
        const recent = this.database.sqlite.prepare('SELECT title FROM articles WHERE id != ? AND published_at >= ?').all(articleId, cutoff) as Array<{title:string}>;
        if (recent.some((candidate) => trigramSimilarity(current.title, candidate.title) >= 0.9))
          this.database.db.update(articles).set({ hidden: true }).where(eq(articles.id, articleId)).run();
      }
    }
    if (this.rules) for (const articleId of insertedIds) await this.rules.evaluateArticle(articleId);
    return insertedIds.length;
  }
}
