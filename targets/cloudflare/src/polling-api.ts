import { IngestPipeline } from '../../../packages/core/src/ingest-pipeline.js';
import type { ApiServices } from '../../../packages/api/src/ports.js';
import { registerPollerRoutes } from '../../../packages/api/src/routes/poller.js';
import { cloudflareLibraryServices, createCloudflareLibraryApi } from './library-api.js';
import { CloudflarePoller } from './poller.js';
import { CloudflareFetchBudget } from './fetch-budget.js';
import { CloudflareStorage } from './storage.js';
import { CloudflareIngestStorage } from './ingest-storage.js';
import { cloudflareHash } from './ingestion.js';
import {
  IngestProcessingService,
  type IngestStepBudget,
} from '../../../packages/core/src/ingest-processing.js';
import { CloudflareIngestJobs } from './ingest-jobs.js';
import { CloudflareRuleStorage } from './rule-storage.js';
import { CloudflareQueryBudget } from './query-budget.js';
import { CloudflareEvents } from './events.js';
import { ScheduledBrewProcessor } from '../../../packages/core/src/brew-scheduled-processing.js';
import { CloudflareScheduledBrewJobs } from './brew-scheduled-jobs.js';
import { CloudflareBrewStorage } from './brew-storage.js';

/** Real polling graph; the product entrypoint still needs owner/email admission. */
export function cloudflarePollingServices(
  bindings: Parameters<typeof cloudflareLibraryServices>[0],
  options: Parameters<typeof cloudflareLibraryServices>[1] & {
    budget: CloudflareFetchBudget;
    processingBudget?: IngestStepBudget;
  },
) {
  const queryBudget = options.queryBudget ?? new CloudflareQueryBudget();
  const library = cloudflareLibraryServices(bindings, {
    ...options,
    queryBudget,
    fetcher: options.budget.fetch,
  });
  const storage = new CloudflareStorage(bindings.DB, queryBudget);
  // Leave capacity for due feeds even when older rule jobs keep arriving.
  const processingQueries = queryBudget.share(20);
  const processingStorage = new CloudflareStorage(bindings.DB, processingQueries);
  const steps = options.processingBudget ?? { remaining: 16 };
  const scheduledQueries = queryBudget.share(24);
  const scheduledStorage = new CloudflareStorage(bindings.DB, scheduledQueries);
  const clock = options.clock ?? { now: () => new Date(), monotonic: () => performance.now() };
  const processor = new IngestProcessingService(
    new CloudflareIngestJobs(processingStorage),
    new CloudflareIngestStorage(processingStorage),
    new CloudflareRuleStorage(processingStorage),
    options.regex ?? {
      test: async () => {
        throw new Error('Regular expression execution needs setup on this instance.');
      },
    },
    { fetch: options.budget.fetch },
    {
      notify: (article) => new CloudflareEvents(processingStorage).publish('notification', article),
    },
    clock,
    () => crypto.randomUUID(),
    {
      get remaining() {
        return steps.remaining;
      },
      set remaining(value) {
        steps.remaining = value;
      },
      // Claim/release: two calls. A step: at most three (duplicate snapshot,
      // definitions and checkpoint; or start, notification and result). This also
      // covers a rejected tag transaction followed by its failure checkpoint.
      reserve: (kind) => processingQueries.reserve(kind === 'job' ? 2 : 3),
    },
    (type) => type === 'notify' || options.budget.remaining >= 2,
  );
  let previous = Promise.resolve(0);
  const pendingIngestion = {
    resume(feedId?: number) {
      const task = previous.catch(() => 0).then(() => processor.drain(feedId));
      previous = task;
      return task;
    },
    policy(ingestStorage: CloudflareIngestStorage, inline = true) {
      return {
        processInserted: async (feed: { id: number; retentionDays: number }, ids: number[]) => {
          if (inline) await pendingIngestion.resume(feed.id);
          if (!ids.length)
            await ingestStorage.prune(
              feed.id,
              clock.now().getTime() - feed.retentionDays * 86_400_000,
            );
        },
      };
    },
  };
  return {
    ...library,
    scheduledBrews: new ScheduledBrewProcessor(
      new CloudflareScheduledBrewJobs(
        scheduledStorage,
        options.brewStorage instanceof CloudflareBrewStorage
          ? options.brewStorage.withScheduledStorage(scheduledStorage)
          : new CloudflareBrewStorage(scheduledStorage),
      ),
      new CloudflareBrewStorage(scheduledStorage),
      clock,
      options.regex ?? {
        test: async () => ({ matched: false, timedOut: false, error: 'Regex is unavailable.' }),
      },
      { fetcher: options.budget.fetch, mail: options.outboundMail, baseUrl: options.outputBaseUrl },
      () => crypto.randomUUID(),
      {
        remaining: 16,
        candidatePageSize: 4,
        reserve: (kind) =>
          scheduledQueries.reserve(kind === 'job' ? 2 : kind === 'delivery' ? 12 : 3),
        canDeliver: (request) =>
          request.kind !== 'composition' ||
          options.budget.remaining >=
            (request.config.delivery.webhook ? 2 : 0) +
              (request.config.delivery.email && options.outboundMail ? 1 : 0),
      },
    ),
    pendingIngestion,
    poller: new CloudflarePoller(
      storage,
      options.budget,
      (feed, articles, admission) => {
        const ingestStorage = new CloudflareIngestStorage(storage, admission, true);
        return new IngestPipeline(
          ingestStorage,
          cloudflareHash,
          clock,
          library.rules,
          pendingIngestion.policy(ingestStorage, false),
        ).ingest(feed, articles);
      },
      () => clock.now(),
      () => pendingIngestion.resume(),
    ),
  } satisfies Pick<ApiServices, keyof typeof library | 'poller'> & {
    pendingIngestion: typeof pendingIngestion;
    scheduledBrews: ScheduledBrewProcessor;
  };
}
export function createCloudflarePollingApi(services: ReturnType<typeof cloudflarePollingServices>) {
  const app = createCloudflareLibraryApi(services);
  registerPollerRoutes(app, services);
  return app;
}
