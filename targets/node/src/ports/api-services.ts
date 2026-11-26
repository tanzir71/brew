import type { OutboundMailPort } from '../../../../packages/core/src/types/delivery.js';
import type { ClockPort } from '../../../../packages/core/src/ports.js';
import type { InboundEmailPort } from '../../../../packages/api/src/inbound.js';
import type { Capabilities } from '../../../../packages/core/src/types/capabilities.js';
import { SourceService } from '../services/source-service.js';
import { NewsletterLibrary } from '../services/newsletter-library.js';
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
import { ActionsService } from '../../../../packages/core/src/actions.js';
import { NodeActionStorage } from './action-storage.js';

export function nodeApiServices(
  database: BrewDatabase,
  poller: PollerService,
  broker: SseBroker,
  fetcher: typeof fetch = globalThis.fetch,
  options: {
    outboundMail?: OutboundMailPort;
    publicUrl?: string;
    clock?: ClockPort;
    inboundEmail?: InboundEmailPort;
    inboundMail?: Capabilities['inboundMail'];
  } = {},
): ApiServices {
  const clock = options.clock;
  const now = clock ? () => clock.now() : undefined;
  return {
    actions: new ActionsService(
      new NodeActionStorage(database, options.clock, fetcher, (article) =>
        broker.publish('notification', article),
      ),
    ),
    outputBaseUrl: options.publicUrl,
    newsletters: new NewsletterLibrary(database, options.clock),
    capabilities: () => ({
      ...nodeCapabilities(),
      emailDelivery: options.outboundMail?.kind ?? null,
      inboundMail: options.inboundMail ?? null,
    }),
    outboundMail: options.outboundMail,
    inboundEmail: options.inboundEmail,
    sources: new SourceService(database, fetcher),
    feeds: new FeedService(database, fetcher),
    articles: new ArticleService(database, fetcher, now),
    reader: new ReaderService(database, now),
    brews: new BrewService(database, options.clock, {
      mail: options.outboundMail,
      fetcher,
      baseUrl: options.publicUrl,
    }),
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
