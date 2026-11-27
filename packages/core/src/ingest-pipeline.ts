import type {
  HashPort,
  AsyncHashPort,
  IngestStoragePort,
  ClockPort,
  IngestRulesPort,
} from './ports.js';
import { duplicateArticleIds, normalizedTitle } from './ingest-duplicates.js';
export { trigramSimilarity } from './ingest-duplicates.js';
import type { ParsedArticle } from './feed-parser.js';
import { normalizedArticleUrl, sanitizeArticleHtml } from './html-sanitizer.js';

const articleHashInput = (url: string, title: string) =>
  `${normalizedArticleUrl(url)}\n${normalizedTitle(title)}`;
export const articleHash = (hash: HashPort, url: string, title: string): string =>
  hash.sha1(articleHashInput(url, title));
export class IngestPipeline {
  constructor(
    private readonly storage: IngestStoragePort,
    private readonly hash: AsyncHashPort,
    private readonly clock: ClockPort,
    private readonly rules?: IngestRulesPort,
    private readonly processing?: {
      processInserted(feed: { id: number; retentionDays: number }, ids: number[]): Promise<void>;
    },
  ) {}

  async ingest(
    feed: { id: number; retentionDays: number },
    incoming: ParsedArticle[],
  ): Promise<number> {
    const insertedIds = await this.storage.insertBatch(
      await Promise.all(
        incoming.map(async (source) => {
          const item = { ...source, publishedAt: new Date(source.publishedAt) };
          const hash = await this.hash.sha1(articleHashInput(item.url, item.title));
          return {
            feedId: feed.id,
            guid: item.guid,
            hash,
            prepare: () => {
              const summaryHtml = sanitizeArticleHtml(item.summaryHtml);
              const contentHtml = sanitizeArticleHtml(item.contentHtml);
              const source = contentHtml ?? summaryHtml;
              const imageUrl = source?.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1] ?? null;
              return {
                feedId: feed.id,
                guid: item.guid,
                url: normalizedArticleUrl(item.url),
                title: item.title.trim() || '(untitled)',
                author: item.author?.trim() || null,
                summaryHtml,
                contentHtml,
                imageUrl,
                enclosureUrl: item.enclosureUrl ?? null,
                enclosureType: item.enclosureType ?? null,
                publishedAt: item.publishedAt,
                hash,
              };
            },
          };
        }),
      ),
    );
    await this.processInserted(feed, insertedIds);
    return insertedIds.length;
  }

  /** Shared post-insert policy for feed articles and inbound letters. */
  async processInserted(
    feed: { id: number; retentionDays: number },
    insertedIds: number[],
  ): Promise<void> {
    if (this.processing) {
      await this.processing.processInserted(feed, insertedIds);
      return;
    }
    if (insertedIds.length) {
      const cutoff = this.clock.now().getTime() - 3 * 86_400_000;
      const titles = await this.storage.duplicateTitles(insertedIds, cutoff);
      if (titles) {
        const hidden = duplicateArticleIds(insertedIds, titles);
        await this.storage.hideMany(hidden);
      }
    }
    if (this.rules?.evaluateArticles) await this.rules.evaluateArticles(insertedIds);
    else if (this.rules) for (const id of insertedIds) await this.rules.evaluateArticle(id);
    await this.storage.prune(feed.id, this.clock.now().getTime() - feed.retentionDays * 86_400_000);
  }
}
