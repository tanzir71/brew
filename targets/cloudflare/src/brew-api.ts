import { AsyncBrewService } from '../../../packages/core/src/async-brew-service.js';
import type { RegexPort, AsyncBrewStoragePort } from '../../../packages/core/src/ports.js';
import type { ApiServices } from '../../../packages/api/src/ports.js';
import { registerBrewRoutes } from '../../../packages/api/src/routes/brews.js';
import { registerBrewOutputRoutes } from '../../../packages/api/src/routes/brew-outputs.js';
import { CloudflareBrewStorage } from './brew-storage.js';
import { CloudflareStorage } from './storage.js';
import { cloudflareReaderServices, createCloudflareReaderApi } from './reader-api.js';

/** Expanded library graph; authentication and the remaining Worker adapters are still required. */
export function cloudflareBrewServices(
  bindings: Parameters<typeof cloudflareReaderServices>[0],
  options: Parameters<typeof cloudflareReaderServices>[1] & {
    regex?: RegexPort;
    outboundMail?: ApiServices['outboundMail'];
    brewStorage?: AsyncBrewStoragePort;
  },
) {
  const services = cloudflareReaderServices(bindings, options);
  const clock = options.clock ?? { now: () => new Date(), monotonic: () => performance.now() };
  return {
    ...services,
    outboundMail: options.outboundMail,
    brews: new AsyncBrewService(
      options.brewStorage ?? new CloudflareBrewStorage(new CloudflareStorage(bindings.DB)),
      clock,
      options.regex,
      {
        fetcher: services.fetcher,
        mail: options.outboundMail,
        baseUrl: options.outputBaseUrl,
      },
    ),
  } satisfies Pick<ApiServices, keyof typeof services | 'brews' | 'outboundMail'>;
}
export function createCloudflareBrewApi(services: ReturnType<typeof cloudflareBrewServices>) {
  const app = createCloudflareReaderApi(services);
  registerBrewRoutes(app, services);
  registerBrewOutputRoutes(app, services);
  return app;
}
