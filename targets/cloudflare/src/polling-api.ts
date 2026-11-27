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

/** Real polling graph; the product entrypoint still needs owner/email admission. */
export function cloudflarePollingServices(
  bindings: Parameters<typeof cloudflareLibraryServices>[0],
  options: Parameters<typeof cloudflareLibraryServices>[1] & {
    budget: CloudflareFetchBudget;
    processingBudget?: IngestStepBudget;
  },
) {
  const library = cloudflareLibraryServices(bindings, {
    ...options,
    fetcher: options.budget.fetch,
  });
  const storage = new CloudflareStorage(bindings.DB);
  const clock = options.clock ?? { now: () => new Date(), monotonic: () => performance.now() };
  const processor = new IngestProcessingService(
    new CloudflareIngestJobs(storage),
    new CloudflareIngestStorage(storage),
    new CloudflareRuleStorage(storage),
    options.regex ?? {
      test: async () => {
        throw new Error('Regular expression execution needs setup on this instance.');
      },
    },
    { fetch: options.budget.fetch },
    { notify: (article) => library.events.publish('notification', article) },
    clock,
    () => crypto.randomUUID(),
    options.processingBudget ?? { remaining: 16 },
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
  };
}
export function createCloudflarePollingApi(services: ReturnType<typeof cloudflarePollingServices>) {
  const app = createCloudflareLibraryApi(services);
  registerPollerRoutes(app, services);
  return app;
}
