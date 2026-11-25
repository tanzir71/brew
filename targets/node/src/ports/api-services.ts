import type { ApiServices } from '../../../../packages/api/src/ports.js';
import type { BrewDatabase } from '../db/database.js';
import { ArticleService } from '../services/article-service.js';
import { BrewService } from '../services/brew-service.js';
import { FeedService } from '../services/feed-service.js';
import { OpmlService } from '../services/opml-service.js';
import { ReaderService } from '../services/reader-service.js';
import { RulesService } from '../services/rules-service.js';
import { SearchService } from '../services/search-service.js';
import type { PollerService } from '../services/poller-service.js';
import type { SseBroker } from '../services/sse-broker.js';
import { NodeApiData } from './api-data.js';
import { nodeCapabilities } from '../capabilities.js';

export function nodeApiServices(
  database: BrewDatabase,
  poller: PollerService,
  broker: SseBroker,
  fetcher: typeof fetch = globalThis.fetch,
): ApiServices {
  return {
    capabilities: nodeCapabilities,
    feeds: new FeedService(database, fetcher),
    articles: new ArticleService(database, fetcher),
    reader: new ReaderService(database),
    brews: new BrewService(database),
    rules: new RulesService(database, fetcher, (article) =>
      broker.publish('notification', article),
    ),
    search: new SearchService(database),
    opml: new OpmlService(database),
    poller,
    data: new NodeApiData(database),
    events: broker,
    fetcher,
  };
}
