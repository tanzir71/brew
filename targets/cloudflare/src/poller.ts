import {
  pollFeed,
  type PollingFeed,
  type PollResult,
  type PollUpdate,
} from '../../../packages/core/src/feed-polling.js';
import type { ParsedArticle } from '../../../packages/core/src/feed-parser.js';
import { CloudflareStorage } from './storage.js';
import { CloudflareFetchBudget, MAX_FETCH_REDIRECTS } from './fetch-budget.js';
import { parseCloudflareFeed, readFeedBody } from './feed-parser.js';
import type { IngestAdmission } from './ingest-storage.js';
import { libraryRevision } from './events.js';

// Exceeds the Cron Trigger's maximum 15 minute wall duration: a dead invocation
// cannot overlap a replacement, and its lease is recoverable without a queue.
export const POLL_LEASE_MS = 16 * 60_000;
// Saturate before shifting (SQLite shifts are signed 64-bit). Valid intervals
// are positive whole minutes; this is the shared effectiveInterval policy.
const dueAt = `CASE WHEN f.last_fetched_at IS NULL THEN 0 ELSE
  f.last_fetched_at + min(1440, f.fetch_interval_minutes * (1 << min(30,max(0,f.consecutive_failures)))) * 60000 END`;
const columns = `f.id,f.kind,f.url,f.title,f.site_url AS siteUrl,f.description,f.etag,f.last_modified AS lastModified,
 f.fetch_interval_minutes AS fetchIntervalMinutes,f.consecutive_failures AS consecutiveFailures,
 f.failing_since AS failingSince,f.retention_days AS retentionDays`;
type FeedRow = Omit<PollingFeed, 'failingSince'> & { failingSince: number | null };
type Ingest = (
  feed: PollingFeed,
  articles: ParsedArticle[],
  admission: IngestAdmission,
) => Promise<number>;

export class CloudflarePoller {
  constructor(
    private readonly storage: CloudflareStorage,
    private readonly budget: CloudflareFetchBudget,
    private readonly ingest: Ingest,
    private readonly now: () => Date = () => new Date(),
    private readonly afterPolling?: () => Promise<unknown>,
  ) {}
  private async claim(runner: string, limit: number, id?: number): Promise<PollingFeed[]> {
    if (!limit) return [];
    const now = this.now().getTime();
    const result = await this.storage.batch<FeedRow>([
      this.storage.statement(
        `INSERT INTO feed_poll_leases(feed_id,runner,expires_at)
         SELECT f.id,?,? FROM feeds f LEFT JOIN feed_poll_leases l ON l.feed_id=f.id
         WHERE f.kind='rss' AND (l.feed_id IS NULL OR l.expires_at<=?)
         AND ${id === undefined ? `${dueAt}<=?` : 'f.id=?'}
         ORDER BY ${dueAt},f.id LIMIT ?
         ON CONFLICT(feed_id) DO UPDATE SET runner=excluded.runner,expires_at=excluded.expires_at
         WHERE feed_poll_leases.expires_at<=?`,
        [runner, now + POLL_LEASE_MS, now, id ?? now, limit, now],
      ),
      this.storage.statement(
        `SELECT ${columns} FROM feeds f JOIN feed_poll_leases l ON l.feed_id=f.id
         WHERE l.runner=? ORDER BY ${dueAt},f.id`,
        [runner],
      ),
    ]);
    return result[1]!.results.map((row) => ({
      ...row,
      failingSince: row.failingSince === null ? null : new Date(row.failingSince),
    }));
  }
  private admission(feed: PollingFeed, runner: string): IngestAdmission {
    return () => ({
      predicate: `EXISTS(SELECT 1 FROM feed_poll_leases l JOIN feeds f ON f.id=l.feed_id
        WHERE l.feed_id=? AND l.runner=? AND l.expires_at>? AND f.url=? AND f.kind='rss')`,
      values: [feed.id, runner, this.now().getTime(), feed.url],
    });
  }
  private async update(feed: PollingFeed, runner: string, patch: PollUpdate) {
    const names: Record<keyof PollUpdate, string> = {
      title: 'title',
      siteUrl: 'site_url',
      description: 'description',
      fetchIntervalMinutes: 'fetch_interval_minutes',
      etag: 'etag',
      lastModified: 'last_modified',
      lastFetchedAt: 'last_fetched_at',
      lastStatus: 'last_status',
      consecutiveFailures: 'consecutive_failures',
      failingSince: 'failing_since',
    };
    const entries = Object.entries(patch) as Array<
      [keyof PollUpdate, PollUpdate[keyof PollUpdate]]
    >;
    const gate = this.admission(feed, runner)();
    const result = await this.storage.batch([
      this.storage.statement(
        `UPDATE feeds SET ${entries.map(([key]) => `${names[key]}=?`).join(',')}
        WHERE id=? AND (${gate.predicate})`,
        [
          ...entries.map(([, value]) => (value instanceof Date ? value.getTime() : value)),
          feed.id,
          ...gate.values,
        ],
      ),
      libraryRevision(this.storage),
    ]);
    return result[0]!.meta.changes > 0;
  }
  private async run(runner: string, queue: PollingFeed[]) {
    const results: PollResult[] = [];
    let cursor = 0;
    const work = async () => {
      while (cursor < queue.length && this.budget.remaining > 0) {
        const feed = queue[cursor++]!;
        results.push(
          await pollFeed(feed, {
            fetcher: this.budget.fetch,
            now: this.now,
            parse: (body, type) => parseCloudflareFeed(body, type, this.now),
            readBody: readFeedBody,
            ingest: (value, articles) =>
              this.ingest(value, articles, this.admission(value, runner)),
            update: (value, patch) => this.update(value, runner, patch),
          }),
        );
      }
    };
    // Drain every worker before releasing leases, including after a D1 failure.
    try {
      // Six simultaneous long redirect chains could exhaust all 40 slots
      // without completing any source, forever starving the oldest feeds.
      const concurrency = Math.min(
        6,
        Math.max(1, Math.floor(this.budget.remaining / (MAX_FETCH_REDIRECTS + 1))),
      );
      const settled = await Promise.allSettled(
        Array.from({ length: Math.min(concurrency, queue.length) }, work),
      );
      const failed = settled.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      await this.afterPolling?.();
      return results.sort((a, b) => a.feedId - b.feedId);
    } finally {
      await this.storage.run('DELETE FROM feed_poll_leases WHERE runner=?', [runner]);
    }
  }
  async pollDue() {
    const runner = crypto.randomUUID();
    return this.run(runner, await this.claim(runner, this.budget.remaining));
  }
  async pollFeedById(id: number): Promise<PollResult | null> {
    if (!Number.isSafeInteger(id) || id < 1) return null;
    const feed = await this.storage.first<{ kind: string }>('SELECT kind FROM feeds WHERE id=?', [
      id,
    ]);
    if (!feed) return null;
    if (feed.kind === 'newsletter')
      return {
        feedId: id,
        status: 0,
        newItems: 0,
        outcome: 'error',
        error: 'Newsletter senders receive mail instead of RSS polling.',
      };
    const runner = crypto.randomUUID();
    const result = (
      await this.run(runner, await this.claim(runner, Math.min(1, this.budget.remaining), id))
    )[0];
    return (
      result ?? {
        feedId: id,
        status: 0,
        newItems: 0,
        outcome: 'error',
        error: 'Feed polling is already running or this invocation has no fetch allowance left.',
      }
    );
  }
}
