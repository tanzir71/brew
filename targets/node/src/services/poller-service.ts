import { asc, eq } from 'drizzle-orm';
import cron, { type ScheduledTask } from 'node-cron';
import type { BrewDatabase } from '../db/database.js';
import { feeds, type Feed } from '../db/schema.js';
import { parseFeedDocument, type ParsedArticle } from './feed-parser.js';

type Fetch = typeof globalThis.fetch;
export interface PollResult { feedId: number; status: number; newItems: number; outcome: 'success' | 'not-modified' | 'error'; error?: string }
type Ingest = (feed: Feed, articles: ParsedArticle[]) => Promise<number> | number;
type CycleComplete = (results: PollResult[]) => void;

export { adaptiveInterval, effectiveInterval } from '../../../../packages/core/src/polling.js';
import { adaptiveInterval, effectiveInterval } from '../../../../packages/core/src/polling.js';

export class PollerService {
  private task: ScheduledTask | null = null;
  constructor(private readonly database: BrewDatabase, private readonly fetcher: Fetch = globalThis.fetch, private readonly ingest: Ingest = () => 0, private readonly now: () => Date = () => new Date(), private readonly cycleComplete: CycleComplete = () => undefined) {}

  start(): void { if (!this.task) this.task = cron.schedule('* * * * *', () => { void this.pollDue(); }); }
  stop(): void { this.task?.stop(); this.task = null; }

  dueFeeds(): Feed[] {
    const now = this.now().getTime();
    return this.database.db.select().from(feeds).orderBy(asc(feeds.id)).all().filter((feed) => !feed.lastFetchedAt || now - feed.lastFetchedAt.getTime() >= effectiveInterval(feed) * 60_000);
  }

  async pollDue(): Promise<PollResult[]> {
    const queue = this.dueFeeds();
    const results: PollResult[] = [];
    let cursor = 0;
    const worker = async () => { while (cursor < queue.length) { const feed = queue[cursor++]; if (feed) results.push(await this.pollFeed(feed)); } };
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
    const sorted = results.sort((a, b) => a.feedId - b.feedId);
    this.cycleComplete(sorted);
    return sorted;
  }

  async pollFeedById(id: number): Promise<PollResult | null> {
    const feed = this.database.db.select().from(feeds).where(eq(feeds.id, id)).get();
    if (!feed) return null;
    const result = await this.pollFeed(feed);
    this.cycleComplete([result]);
    return result;
  }

  async pollFeed(feed: Feed): Promise<PollResult> {
    const fetchedAt = this.now();
    try {
      const headers = new Headers({ Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/json, text/xml, application/xml;q=0.9' });
      if (feed.etag) headers.set('If-None-Match', feed.etag);
      if (feed.lastModified) headers.set('If-Modified-Since', feed.lastModified);
      const response = await this.fetcher(feed.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (response.status === 304) {
        this.database.db.update(feeds).set({ lastFetchedAt: fetchedAt, lastStatus: 304, consecutiveFailures: 0, failingSince: null }).where(eq(feeds.id, feed.id)).run();
        return { feedId: feed.id, status: 304, newItems: 0, outcome: 'not-modified' };
      }
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
      const document = await parseFeedDocument(await response.text(), response.headers.get('content-type') ?? '');
      const newItems = await this.ingest(feed, document.articles);
      const interval = adaptiveInterval(feed.fetchIntervalMinutes, document.articles, fetchedAt);
      this.database.db.update(feeds).set({ title: document.title || feed.title, siteUrl: document.siteUrl ?? feed.siteUrl, description: document.description ?? feed.description, fetchIntervalMinutes: interval, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), lastFetchedAt: fetchedAt, lastStatus: response.status, consecutiveFailures: 0, failingSince: null }).where(eq(feeds.id, feed.id)).run();
      return { feedId: feed.id, status: response.status, newItems, outcome: 'success' };
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number' ? error.status : 0;
      this.database.db.update(feeds).set({ lastFetchedAt: fetchedAt, lastStatus: status, consecutiveFailures: feed.consecutiveFailures + 1, failingSince: feed.failingSince ?? fetchedAt }).where(eq(feeds.id, feed.id)).run();
      return { feedId: feed.id, status, newItems: 0, outcome: 'error', error: error instanceof Error ? error.message : 'Unknown polling error' };
    }
  }
}
