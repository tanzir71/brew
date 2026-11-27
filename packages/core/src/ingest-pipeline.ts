import type {
  HashPort,
  AsyncHashPort,
  IngestStoragePort,
  ClockPort,
  IngestRulesPort,
} from './ports.js';
import type { ParsedArticle } from './feed-parser.js';
import { normalizedArticleUrl, sanitizeArticleHtml } from './html-sanitizer.js';

const normalizedTitle = (value: string): string =>
  value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const articleHashInput = (url: string, title: string) =>
  `${normalizedArticleUrl(url)}\n${normalizedTitle(title)}`;
export const articleHash = (hash: HashPort, url: string, title: string): string =>
  hash.sha1(articleHashInput(url, title));
function titleTrigrams(value: string) {
  const text = `  ${normalizedTitle(value)} `;
  const result = new Set<string>();
  for (let index = 0; index <= text.length - 3; index++) result.add(text.slice(index, index + 3));
  return result;
}
function trigramScore(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}
export function trigramSimilarity(left: string, right: string): number {
  return trigramScore(titleTrigrams(left), titleTrigrams(right));
}

export class IngestPipeline {
  constructor(
    private readonly storage: IngestStoragePort,
    private readonly hash: AsyncHashPort,
    private readonly clock: ClockPort,
    private readonly rules?: IngestRulesPort,
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
    if (insertedIds.length) {
      const cutoff = this.clock.now().getTime() - 3 * 86_400_000;
      const titles = await this.storage.duplicateTitles(insertedIds, cutoff);
      if (titles) {
        const subjects = new Map(titles.subjects.map((row) => [row.id, row.title]));
        // A three-day library can contain many thousands of titles. Reuse hot
        // candidates without retaining a Set for every row on a Worker heap.
        const cache = new Map<string, Set<string>>();
        const candidateGrams = (title: string) => {
          let grams = cache.get(title);
          if (!grams) {
            grams = titleTrigrams(title);
            if (cache.size >= 256) cache.delete(cache.keys().next().value!);
            cache.set(title, grams);
          }
          return grams;
        };
        const hidden: number[] = [];
        for (const id of insertedIds) {
          if (!subjects.has(id)) throw new Error('Article not found');
          const grams = titleTrigrams(subjects.get(id)!);
          if (
            titles.recent.some(
              (row) => row.id !== id && trigramScore(grams, candidateGrams(row.title)) >= 0.9,
            )
          )
            hidden.push(id);
        }
        await this.storage.hideMany(hidden);
      }
    }
    if (this.rules?.evaluateArticles) await this.rules.evaluateArticles(insertedIds);
    else if (this.rules) for (const id of insertedIds) await this.rules.evaluateArticle(id);
    await this.storage.prune(feed.id, this.clock.now().getTime() - feed.retentionDays * 86_400_000);
  }
}
