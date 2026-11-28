import { isSqliteConstraint } from './errors.js';
import {
  sampleFeed,
  sampleFeedUrl,
  sampleGroups,
} from '../../../packages/core/src/sample-library.js';
import Parser from 'rss-parser/dist/rss-parser.min.js';
import { parseFeedDocument } from '../../../packages/core/src/feed-parser.js';
import { readFeedBody } from '../../../packages/core/src/feed-body.js';
import {
  pollFeed,
  PollInterruptedError,
  type PollingFeed,
  type PollUpdate,
  type PollResult,
} from '../../../packages/core/src/feed-polling.js';
import { effectiveInterval } from '../../../packages/core/src/polling.js';
import { IngestPipeline } from '../../../packages/core/src/ingest-pipeline.js';
import { IngestProcessingService } from '../../../packages/core/src/ingest-processing.js';
import type { NotificationPort } from '../../../packages/core/src/ports.js';
import { SqlIngestStorage } from '../../../packages/db/src/sql-ingest-storage.js';
import { SqlIngestJobs } from '../../../packages/db/src/sql-ingest-jobs.js';
import { SqlRuleStorage } from '../../../packages/db/src/sql-rule-storage.js';
import { BrowserSqlStorage } from './sql-storage.js';
import { browserRegex } from './regex.js';
import { relayConfig, relayFetch, type RelayConfig } from './relay.js';

const configKey = 'browser_feed_relay';
const parser = new Parser();
type FeedRow = Omit<PollingFeed, 'failingSince'> & {
  failingSince: number | null;
  lastFetchedAt: number | null;
};
const feedColumns = `id,kind,url,title,site_url AS siteUrl,description,etag,last_modified AS lastModified,
 fetch_interval_minutes AS fetchIntervalMinutes,consecutive_failures AS consecutiveFailures,
 failing_since AS failingSince,retention_days AS retentionDays,last_fetched_at AS lastFetchedAt`;
export interface FetchCycle {
  state: 'ready' | 'needs-relay' | 'stopped';
  results: PollResult[];
  pending: number;
}
export interface RelayStatus {
  endpoint: string | null;
  configured: boolean;
}

/** Runs in its own worker; SQL goes through the library owner's serialized connection. */
export class BrowserFetching {
  private lifetime = new AbortController();
  private queue = Promise.resolve();
  readonly fetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (!['GET', 'HEAD'].includes(method.toUpperCase()))
      return fetch(input, {
        ...init,
        credentials: 'omit',
        signal: AbortSignal.any([
          this.lifetime.signal,
          init?.signal ?? AbortSignal.timeout(20_000),
        ]),
      });
    if (this.sampleBase) {
      const base = new URL(this.sampleBase);
      if (
        url.origin === base.origin &&
        [new URL('figma/', base).pathname, new URL('samples/', base).pathname].some((path) =>
          url.pathname.startsWith(path),
        ) &&
        !url.pathname.endsWith('.json')
      )
        return fetch(input, {
          ...init,
          credentials: 'omit',
          signal: AbortSignal.any([
            this.lifetime.signal,
            init?.signal ?? AbortSignal.timeout(20_000),
          ]),
        });
      const group = sampleGroups.find(
        (group) => url.href === sampleFeedUrl(group.id, this.sampleBase!),
      );
      if (group) {
        const response = Response.json(sampleFeed(group.id, this.sampleBase), {
          headers: { 'Cache-Control': 'no-store' },
        });
        Object.defineProperty(response, 'url', { value: url.href });
        return Promise.resolve(response);
      }
    }
    if (!this.config)
      return Promise.reject(new PollInterruptedError('Set up a feed relay in Where Brew runs.'));
    return relayFetch(this.config, this.lifetime.signal)(input, init);
  };
  private controller = new AbortController();
  private stopped = false;
  private config: RelayConfig | null = null;
  constructor(
    private storage: BrowserSqlStorage,
    private notifications: NotificationPort,
    private sampleBase?: string,
  ) {}
  async initialize() {
    // The database's lifetime Web Lock proves no other runtime still owns these leases.
    await this.storage.run('UPDATE ingest_jobs SET runner=NULL,expires_at=0');
    const row = await this.storage.first<{ value: string }>(
      'SELECT value FROM settings WHERE key=?',
      [configKey],
    );
    this.config = row ? relayConfig(JSON.parse(row.value)) : null;
    return this.status();
  }
  status(): RelayStatus {
    return { endpoint: this.config?.endpoint ?? null, configured: this.config !== null };
  }
  configure(value: RelayConfig | null) {
    this.abort();
    return this.enqueue(() => this.configureNow(value));
  }
  private async configureNow(value: RelayConfig | null) {
    const config = value === null ? null : relayConfig(value);
    if (config)
      await this.storage.run(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
        [configKey, JSON.stringify(config)],
      );
    else await this.storage.run('DELETE FROM settings WHERE key=?', [configKey]);
    this.config = config;
    return this.status();
  }
  abort() {
    this.controller.abort();
  }
  close() {
    this.stopped = true;
    this.lifetime.abort();
    this.abort();
  }
  private async update(feed: PollingFeed, values: PollUpdate) {
    if (this.controller.signal.aborted) return false;
    const columns: Record<keyof PollUpdate, string> = {
      lastFetchedAt: 'last_fetched_at',
      lastStatus: 'last_status',
      consecutiveFailures: 'consecutive_failures',
      failingSince: 'failing_since',
      title: 'title',
      siteUrl: 'site_url',
      description: 'description',
      fetchIntervalMinutes: 'fetch_interval_minutes',
      etag: 'etag',
      lastModified: 'last_modified',
    };
    const entries = Object.entries(values) as Array<[keyof PollUpdate, unknown]>;
    try {
      return (
        (
          await this.storage.run(
            `UPDATE feeds SET ${entries.map(([key]) => `${columns[key]}=?`).join(',')} WHERE id=? AND url=? AND kind='rss'`,
            [
              ...entries.map(([, value]) => (value instanceof Date ? value.getTime() : value)),
              feed.id,
              feed.url,
            ],
          )
        ).meta.changes > 0
      );
    } catch (error) {
      throw new PollInterruptedError(
        'Feed status could not be saved. Check browser storage and retry.',
        { cause: error },
      );
    }
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(work);
    this.queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
  refresh(feedId?: number): Promise<FetchCycle> {
    return this.enqueue(() => this.refreshNow(feedId));
  }
  private async refreshNow(feedId?: number): Promise<FetchCycle> {
    if (this.stopped) return { state: 'stopped', results: [], pending: 0 };
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const clock = { now: () => new Date(), monotonic: () => performance.now() };
    const storage = new SqlIngestStorage(this.storage);
    const processing = new IngestProcessingService(
      new SqlIngestJobs(this.storage, isSqliteConstraint),
      storage,
      new SqlRuleStorage(this.storage, isSqliteConstraint),
      browserRegex,
      {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            credentials: 'omit',
            signal: AbortSignal.any([signal, init?.signal ?? AbortSignal.timeout(10_000)]),
          }),
      },
      {
        notify: (article) =>
          new Promise<void>((resolve, reject) => {
            const aborted = () =>
              finish(new PollInterruptedError('Browser notification was interrupted.'));
            const timer = setTimeout(
              () => finish(new Error('Browser notification did not acknowledge delivery.')),
              10_000,
            );
            function finish(error?: unknown) {
              clearTimeout(timer);
              signal.removeEventListener('abort', aborted);
              if (error) reject(error);
              else resolve();
            }
            signal.addEventListener('abort', aborted, { once: true });
            if (signal.aborted) aborted();
            else
              Promise.resolve()
                .then(() => this.notifications.notify(article))
                .then(() => finish(), finish);
          }),
      },
      clock,
      () => crypto.randomUUID(),
      { remaining: Infinity, reserve: () => (signal.aborted ? null : () => {}) },
    );
    await processing.drain();
    const config = this.config;
    const now = Date.now();
    const queue = (
      await this.storage.all<FeedRow>(
        `SELECT ${feedColumns} FROM feeds WHERE kind='rss'${feedId === undefined ? '' : ' AND id=?'} ORDER BY id`,
        feedId === undefined ? [] : [feedId],
      )
    )
      .filter(
        (feed) =>
          feedId !== undefined ||
          feed.lastFetchedAt === null ||
          now - feed.lastFetchedAt >= effectiveInterval(feed) * 60_000,
      )
      .map((feed) => ({
        ...feed,
        failingSince: feed.failingSince === null ? null : new Date(feed.failingSince),
      }));
    const results: PollResult[] = [];
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(6, queue.length) }, async () => {
        while (cursor < queue.length && !signal.aborted) {
          const feed = queue[cursor++]!;
          const pipeline = new IngestPipeline(
            new SqlIngestStorage(
              this.storage,
              () => ({
                predicate: "EXISTS(SELECT 1 FROM feeds WHERE id=? AND url=? AND kind='rss')",
                values: [feed.id, feed.url],
              }),
              true,
            ),
            {
              sha1: async (value) =>
                Array.from(
                  new Uint8Array(
                    await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value)),
                  ),
                  (byte) => byte.toString(16).padStart(2, '0'),
                ).join(''),
            },
            clock,
            undefined,
            { processInserted: async () => {} },
          );
          results.push(
            await pollFeed(feed, {
              fetcher: (input, init) =>
                this.fetch(input, {
                  ...init,
                  signal: AbortSignal.any([signal, init?.signal ?? this.lifetime.signal]),
                }),
              now: clock.now,
              readBody: readFeedBody,
              parse: (body, type) =>
                parseFeedDocument(
                  body,
                  type,
                  { parse: (xml) => parser.parseString(xml) },
                  clock.now,
                ),
              ingest: async (value, articles) => {
                if (signal.aborted) throw new PollInterruptedError('Browser fetching stopped.');
                try {
                  return await pipeline.ingest(value, articles);
                } catch (error) {
                  if (error instanceof PollInterruptedError) throw error;
                  throw new PollInterruptedError(
                    'Articles could not be saved. Check browser storage and retry.',
                    { cause: error },
                  );
                }
              },
              update: (value, patch) => this.update(value, patch),
            }),
          );
        }
      }),
    );
    await processing.drain();
    return {
      state: signal.aborted ? 'stopped' : config ? 'ready' : 'needs-relay',
      results: results.sort((a, b) => a.feedId - b.feedId),
      pending: await this.pending(),
    };
  }
  private async pending() {
    return (await this.storage.first<{ total: number }>(
      'SELECT count(*) AS total FROM ingest_jobs',
    ))!.total;
  }
}
