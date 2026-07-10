import { and, eq, or } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { BrewDatabase } from '../db/database.js';
import { articles, type Feed } from '../db/schema.js';
import type { ParsedArticle } from './feed-parser.js';
import { normalizedArticleUrl, sanitizeArticleHtml } from './html-sanitizer.js';

const normalizedTitle = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export const articleHash = (url: string, title: string): string => createHash('sha1').update(`${normalizedArticleUrl(url)}\n${normalizedTitle(title)}`).digest('hex');

export class IngestPipeline {
  constructor(private readonly database: BrewDatabase) {}

  ingest(feed: Feed, incoming: ParsedArticle[]): number {
    return this.database.sqlite.transaction(() => {
      let inserted = 0;
      for (const item of incoming) {
        const hash = articleHash(item.url, item.title);
        const duplicate = this.database.db.select({ id: articles.id }).from(articles).where(and(eq(articles.feedId, feed.id), or(eq(articles.guid, item.guid), eq(articles.hash, hash)))).get();
        if (duplicate) continue;
        const summaryHtml = sanitizeArticleHtml(item.summaryHtml);
        const contentHtml = sanitizeArticleHtml(item.contentHtml);
        const source = contentHtml ?? summaryHtml;
        let imageUrl: string | null = null;
        if (source) { const match = source.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i); imageUrl = match?.[1] ?? null; }
        this.database.db.insert(articles).values({ feedId: feed.id, guid: item.guid, url: normalizedArticleUrl(item.url), title: item.title.trim() || '(untitled)', author: item.author?.trim() || null, summaryHtml, contentHtml, imageUrl, publishedAt: item.publishedAt, hash }).run();
        inserted++;
      }
      return inserted;
    })();
  }
}
