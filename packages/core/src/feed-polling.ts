import type { ParsedArticle, ParsedFeedDocument } from './feed-parser.js';
import { adaptiveInterval } from './polling.js';

export interface PollingFeed {
  id: number;
  kind: 'rss' | 'newsletter';
  url: string;
  title: string;
  siteUrl: string | null;
  description: string | null;
  etag: string | null;
  lastModified: string | null;
  fetchIntervalMinutes: number;
  consecutiveFailures: number;
  failingSince: Date | null;
  retentionDays: number;
}
export interface PollResult {
  feedId: number;
  status: number;
  newItems: number;
  outcome: 'success' | 'not-modified' | 'error';
  error?: string;
}
export interface PollUpdate {
  lastFetchedAt: Date;
  lastStatus: number;
  consecutiveFailures: number;
  failingSince: Date | null;
  title?: string;
  siteUrl?: string | null;
  description?: string | null;
  fetchIntervalMinutes?: number;
  etag?: string | null;
  lastModified?: string | null;
}
/** Local capacity or lost ownership must not make a healthy source back off. */
export class PollInterruptedError extends Error {}
export interface FeedPollingPorts<F extends PollingFeed> {
  fetcher: typeof fetch;
  now(): Date;
  parse(body: string, contentType: string): Promise<ParsedFeedDocument>;
  ingest(feed: F, articles: ParsedArticle[]): Promise<number> | number;
  update(feed: F, values: PollUpdate): Promise<boolean | void> | boolean | void;
  readBody?(response: Response): Promise<string>;
}
/** Shared Node-first conditional fetch, parser, adaptive interval and health policy. */
export async function pollFeed<F extends PollingFeed>(
  feed: F,
  ports: FeedPollingPorts<F>,
): Promise<PollResult> {
  if (feed.kind === 'newsletter')
    return {
      feedId: feed.id,
      status: 0,
      newItems: 0,
      outcome: 'error',
      error: 'Newsletter senders receive mail instead of RSS polling.',
    };
  const fetchedAt = ports.now();
  try {
    const headers = new Headers({
      Accept:
        'application/rss+xml, application/atom+xml, application/feed+json, application/json, text/xml, application/xml;q=0.9',
    });
    if (feed.etag) headers.set('If-None-Match', feed.etag);
    if (feed.lastModified) headers.set('If-Modified-Since', feed.lastModified);
    const response = await ports.fetcher(feed.url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 304) {
      await response.body?.cancel();
      if (
        (await ports.update(feed, {
          lastFetchedAt: fetchedAt,
          lastStatus: 304,
          consecutiveFailures: 0,
          failingSince: null,
        })) === false
      )
        throw new PollInterruptedError('Feed polling ownership changed.');
      return { feedId: feed.id, status: 304, newItems: 0, outcome: 'not-modified' };
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    }
    const document = await ports.parse(
      await (ports.readBody?.(response) ?? response.text()),
      response.headers.get('content-type') ?? '',
    );
    const newItems = await ports.ingest(feed, document.articles);
    const updated = await ports.update(feed, {
      title: document.title || feed.title,
      siteUrl: document.siteUrl ?? feed.siteUrl,
      description: document.description ?? feed.description,
      fetchIntervalMinutes: adaptiveInterval(
        feed.fetchIntervalMinutes,
        document.articles,
        fetchedAt,
      ),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      lastFetchedAt: fetchedAt,
      lastStatus: response.status,
      consecutiveFailures: 0,
      failingSince: null,
    });
    if (updated === false) throw new PollInterruptedError('Feed polling ownership changed.');
    return { feedId: feed.id, status: response.status, newItems, outcome: 'success' };
  } catch (error) {
    const status =
      typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 0;
    if (!(error instanceof PollInterruptedError))
      await ports.update(feed, {
        lastFetchedAt: fetchedAt,
        lastStatus: status,
        consecutiveFailures: feed.consecutiveFailures + 1,
        failingSince: feed.failingSince ?? fetchedAt,
      });
    return {
      feedId: feed.id,
      status,
      newItems: 0,
      outcome: 'error',
      error: error instanceof Error ? error.message : 'Unknown polling error',
    };
  }
}
