import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { ClockPort } from '../../../packages/core/src/ports.js';
import type { ApiServices } from '../../../packages/api/src/ports.js';
import { createApiBase } from '../../../packages/api/src/api-base.js';
import { registerInstanceRoutes } from '../../../packages/api/src/routes/instance.js';
import { registerReaderRoutes } from '../../../packages/api/src/routes/reader.js';
import { registerArticleRoutes } from '../../../packages/api/src/routes/articles.js';
import { registerFeedRoutes } from '../../../packages/api/src/routes/feeds.js';
import { registerSearchRoutes } from '../../../packages/api/src/routes/search.js';
import { registerMediaRoutes } from '../../../packages/api/src/routes/media.js';
import { registerArticleOutputRoutes } from '../../../packages/api/src/routes/article-outputs.js';
import { registerReaderOutputRoutes } from '../../../packages/api/src/routes/reader-outputs.js';
import { registerOpenApi } from '../../../packages/api/src/openapi.js';
import { CloudflareStorage } from './storage.js';
import { CloudflareReader } from './reader-service.js';
import { CloudflareSearch } from './search-service.js';
import { CloudflareArticles } from './article-service.js';
import { CloudflareApiData } from './api-data.js';
import { CloudflareFeeds } from './feed-service.js';
import { CloudflareEvents } from './events.js';
import { R2ImageCache } from './image-cache.js';
import type { CloudflareQueryBudget } from './query-budget.js';

/** Reader graph; the full Worker also needs Brew/rules/agent/inbound adapters. */
export function cloudflareReaderServices(
  bindings: { DB: D1Database; IMAGES: R2Bucket },
  options: {
    capabilities: ApiServices['capabilities'];
    clock?: ClockPort;
    fetcher?: typeof fetch;
    outputBaseUrl?: string;
    eventPollMs?: number;
    eventLifetimeMs?: number;
    queryBudget?: CloudflareQueryBudget;
  },
) {
  const storage = new CloudflareStorage(bindings.DB, options.queryBudget),
    clock = options.clock ?? { now: () => new Date(), monotonic: () => performance.now() },
    fetcher = options.fetcher ?? globalThis.fetch;
  return {
    capabilities: options.capabilities,
    outputBaseUrl: options.outputBaseUrl,
    fetcher,
    imageCache: new R2ImageCache(bindings.IMAGES, () => clock.now().getTime()),
    reader: new CloudflareReader(storage, () => clock.now()),
    search: new CloudflareSearch(storage, clock),
    articles: new CloudflareArticles(storage, fetcher, () => clock.now()),
    data: new CloudflareApiData(storage),
    feeds: new CloudflareFeeds(storage, fetcher, () => clock.now()),
    events: new CloudflareEvents(storage, options.eventPollMs, options.eventLifetimeMs),
  } satisfies Pick<
    ApiServices,
    | 'capabilities'
    | 'outputBaseUrl'
    | 'fetcher'
    | 'imageCache'
    | 'reader'
    | 'search'
    | 'articles'
    | 'data'
    | 'feeds'
    | 'events'
  >;
}
export function createCloudflareReaderApi(services: ReturnType<typeof cloudflareReaderServices>) {
  const app = createApiBase();
  registerReaderRoutes(app, services);
  registerArticleRoutes(app, services);
  registerFeedRoutes(app, services);
  registerSearchRoutes(app, services);
  registerMediaRoutes(app, services);
  registerInstanceRoutes(app, services);
  registerArticleOutputRoutes(app, services);
  registerReaderOutputRoutes(app, services);
  registerOpenApi(app);
  return app;
}
