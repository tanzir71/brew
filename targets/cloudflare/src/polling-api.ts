import { IngestPipeline } from '../../../packages/core/src/ingest-pipeline.js';
import type { ApiServices } from '../../../packages/api/src/ports.js';
import { registerPollerRoutes } from '../../../packages/api/src/routes/poller.js';
import { cloudflareLibraryServices, createCloudflareLibraryApi } from './library-api.js';
import { CloudflarePoller } from './poller.js';
import { CloudflareFetchBudget } from './fetch-budget.js';
import { CloudflareStorage } from './storage.js';
import { CloudflareIngestStorage } from './ingest-storage.js';
import { cloudflareHash } from './ingestion.js';

/** Real polling graph; the product entrypoint still needs owner/email admission. */
export function cloudflarePollingServices(
  bindings: Parameters<typeof cloudflareLibraryServices>[0],
  options: Parameters<typeof cloudflareLibraryServices>[1] & { budget: CloudflareFetchBudget },
) {
  const library = cloudflareLibraryServices(bindings, {
    ...options,
    fetcher: options.budget.fetch,
  });
  const storage = new CloudflareStorage(bindings.DB);
  const clock = options.clock ?? { now: () => new Date(), monotonic: () => performance.now() };
  return {
    ...library,
    poller: new CloudflarePoller(
      storage,
      options.budget,
      (feed, articles, admission) =>
        new IngestPipeline(
          new CloudflareIngestStorage(storage, admission),
          cloudflareHash,
          clock,
          library.rules,
        ).ingest(feed, articles),
      () => clock.now(),
    ),
  } satisfies Pick<ApiServices, keyof typeof library | 'poller'>;
}
export function createCloudflarePollingApi(services: ReturnType<typeof cloudflarePollingServices>) {
  const app = createCloudflareLibraryApi(services);
  registerPollerRoutes(app, services);
  return app;
}
