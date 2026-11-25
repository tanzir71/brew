import type { ClockPort, HashPort, IngestStoragePort, StoredArticle } from './ports.js';
import { IngestPipeline } from './ingest-pipeline.js';
import { cleanNewsletterHtml, newsletterTextHtml } from './newsletter-cleaner.js';
import {
  normalizeNewsletterSender,
  parseNewsletterMime,
  validateNewsletterBody,
} from './newsletter-mime.js';
import type {
  NewsletterFeed,
  NewsletterIngestResult,
  NewsletterMessage,
} from './types/newsletters.js';

export interface NewsletterArticle extends StoredArticle {
  rawHtml: string;
  cleaningJson: string;
}

export interface NewsletterStoragePort extends IngestStoragePort {
  ensureSender(sender: { address: string; name: string }): NewsletterFeed;
  retentionFeeds(): Array<{ id: number; retentionDays: number }>;
  /** Atomic sender-scoped deduplication and insertion; empty URL becomes /a/:articleId. */
  insertLetter(article: NewsletterArticle): { id: number; inserted: boolean };
}

export class NewsletterPipeline {
  private readonly articles: IngestPipeline;
  constructor(
    private readonly storage: NewsletterStoragePort,
    private readonly hash: HashPort,
    private readonly clock: ClockPort,
    rules?: { evaluateArticle(id: number): Promise<number> },
  ) {
    this.articles = new IngestPipeline(storage, hash, clock, rules);
  }

  async ingest(raw: string | Uint8Array): Promise<NewsletterIngestResult> {
    return this.ingestMessage(await parseNewsletterMime(raw));
  }

  /** Hosts call this periodically, including for blocked or inactive senders. */
  prune(): void {
    const at = this.clock.now().getTime();
    for (const feed of this.storage.retentionFeeds())
      this.storage.prune(feed.id, at - feed.retentionDays * 86_400_000);
  }

  async ingestMessage(message: NewsletterMessage): Promise<NewsletterIngestResult> {
    const address = normalizeNewsletterSender(message.from.address);
    validateNewsletterBody(message);
    const feed = this.storage.ensureSender({ address, name: message.from.name?.trim() || address });
    if (feed.settings.blocked) {
      this.storage.prune(feed.id, this.clock.now().getTime() - feed.retentionDays * 86_400_000);
      return { feedId: feed.id, articleId: null, outcome: 'blocked' };
    }
    const rawHtml = message.html || newsletterTextHtml(message.text ?? '');
    const cleaned = cleanNewsletterHtml(rawHtml, {
      ...feed.settings.cleaning,
      archiveUrl: message.archiveUrl,
    });
    const title = message.subject?.trim() || '(untitled)';
    // Stable delivery identity, independent of title/URL. Daily letters often reuse both.
    const identity =
      message.messageId?.trim() ||
      this.hash.sha1(JSON.stringify([address, title, message.date ?? '', rawHtml]));
    const guid = `newsletter:${identity}`;
    const receivedAt = this.clock.now();
    const date = message.date ? new Date(message.date) : receivedAt;
    // Future sender clocks must not defeat retention or hide mail from current issues.
    const publishedAt =
      Number.isFinite(date.getTime()) && date.getTime() <= receivedAt.getTime() + 86_400_000
        ? date
        : receivedAt;
    const inserted = this.storage.insertLetter({
      feedId: feed.id,
      guid,
      hash: this.hash.sha1(`${address}\n${guid}`),
      url: cleaned.archiveUrl ?? '',
      title,
      author: message.from.name?.trim() || address,
      summaryHtml: null,
      contentHtml: cleaned.html,
      imageUrl: cleaned.html?.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1] ?? null,
      enclosureUrl: null,
      enclosureType: null,
      publishedAt,
      rawHtml,
      cleaningJson: JSON.stringify(cleaned.cleaning),
    });
    await this.articles.processInserted(feed, inserted.inserted ? [inserted.id] : []);
    return {
      feedId: feed.id,
      articleId: inserted.id,
      outcome: inserted.inserted ? 'inserted' : 'duplicate',
    };
  }
}
