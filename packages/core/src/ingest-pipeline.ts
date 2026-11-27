import type { HashPort, IngestStoragePort, ClockPort } from './ports.js';
import type { ParsedArticle } from './feed-parser.js';
import { normalizedArticleUrl, sanitizeArticleHtml } from './html-sanitizer.js';

const normalizedTitle = (value: string): string =>
  value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export const articleHash = (hash: HashPort, url: string, title: string): string =>
  hash.sha1(`${normalizedArticleUrl(url)}\n${normalizedTitle(title)}`);
export function trigramSimilarity(left: string, right: string): number {
  const grams = (value: string) => {
    const text = `  ${normalizedTitle(value)} `;
    const result = new Set<string>();
    for (let index = 0; index <= text.length - 3; index++) result.add(text.slice(index, index + 3));
    return result;
  };
  const a = grams(left);
  const b = grams(right);
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}

export class IngestPipeline {
  constructor(
    private readonly storage: IngestStoragePort,
    private readonly hash: HashPort,
    private readonly clock: ClockPort,
    private readonly rules?: { evaluateArticle(id: number): Promise<number> },
  ) {}

  async ingest(
    feed: { id: number; retentionDays: number },
    incoming: ParsedArticle[],
  ): Promise<number> {
    const insertedIds = await this.storage.insertBatch(
      incoming.map((item) => {
        const hash = articleHash(this.hash, item.url, item.title);
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
    );
    await this.processInserted(feed, insertedIds);
    return insertedIds.length;
  }

  /** Shared post-insert policy for feed articles and inbound letters. */
  async processInserted(
    feed: { id: number; retentionDays: number },
    insertedIds: number[],
  ): Promise<void> {
    if (await this.storage.duplicateFilterEnabled()) {
      const cutoff = this.clock.now().getTime() - 3 * 86_400_000;
      for (const id of insertedIds) {
        const title = await this.storage.title(id);
        if (
          (await this.storage.recentTitles(id, cutoff)).some(
            (candidate) => trigramSimilarity(title, candidate) >= 0.9,
          )
        )
          await this.storage.hide(id);
      }
    }
    if (this.rules) for (const id of insertedIds) await this.rules.evaluateArticle(id);
    await this.storage.prune(feed.id, this.clock.now().getTime() - feed.retentionDays * 86_400_000);
  }
}
