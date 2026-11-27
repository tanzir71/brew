import { asc, eq } from 'drizzle-orm';
import cron, { type ScheduledTask } from 'node-cron';
import type { BrewDatabase } from '../db/database.js';
import { feeds, type Feed } from '../db/schema.js';
import { parseFeedDocument, type ParsedArticle } from './feed-parser.js';

type Fetch = typeof globalThis.fetch;
export type { PollResult } from '../../../../packages/core/src/feed-polling.js';
import {
  pollFeed as pollSharedFeed,
  type PollResult,
} from '../../../../packages/core/src/feed-polling.js';
type Ingest = (feed: Feed, articles: ParsedArticle[]) => Promise<number> | number;
type CycleComplete = (results: PollResult[]) => void;

export { adaptiveInterval, effectiveInterval } from '../../../../packages/core/src/polling.js';
import { effectiveInterval } from '../../../../packages/core/src/polling.js';

export class PollerService {
  private task: ScheduledTask | null = null;
  constructor(
    private readonly database: BrewDatabase,
    private readonly fetcher: Fetch = globalThis.fetch,
    private readonly ingest: Ingest = () => 0,
    private readonly now: () => Date = () => new Date(),
    private readonly cycleComplete: CycleComplete = () => undefined,
  ) {}

  start(): void {
    if (!this.task)
      this.task = cron.schedule('* * * * *', () => {
        void this.pollDue();
      });
  }
  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  dueFeeds(): Feed[] {
    const now = this.now().getTime();
    return this.database.db
      .select()
      .from(feeds)
      .where(eq(feeds.kind, 'rss'))
      .orderBy(asc(feeds.id))
      .all()
      .filter(
        (feed) =>
          !feed.lastFetchedAt ||
          now - feed.lastFetchedAt.getTime() >= effectiveInterval(feed) * 60_000,
      );
  }

  async pollDue(): Promise<PollResult[]> {
    const queue = this.dueFeeds();
    const results: PollResult[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const feed = queue[cursor++];
        if (feed) results.push(await this.pollFeed(feed));
      }
    };
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
    return pollSharedFeed(feed, {
      fetcher: this.fetcher,
      now: this.now,
      parse: parseFeedDocument,
      ingest: this.ingest,
      update: (value, patch) => {
        this.database.db.update(feeds).set(patch).where(eq(feeds.id, value.id)).run();
      },
    });
  }
}
