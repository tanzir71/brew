import { AsyncRulesService } from '../../../packages/core/src/async-rules-service.js';
import type { ApiServices } from '../../../packages/api/src/ports.js';
import { registerRulesRoutes } from '../../../packages/api/src/routes/rules.js';
import { registerSourceRoutes } from '../../../packages/api/src/routes/sources.js';
import { cloudflareBrewServices, createCloudflareBrewApi } from './brew-api.js';
import { CloudflareStorage } from './storage.js';
import { CloudflareRuleStorage } from './rule-storage.js';
import { CloudflareSources } from './source-service.js';
import { CloudflareNewsletterLibrary } from './newsletter-library.js';
import { registerNewsletterRoutes } from '../../../packages/api/src/newsletters.js';
import { registerPageOutputRoutes } from '../../../packages/api/src/routes/page-outputs.js';

/** Real library adapters; the product Worker still requires the other API ports. */
export function cloudflareLibraryServices(
  bindings: Parameters<typeof cloudflareBrewServices>[0],
  options: Parameters<typeof cloudflareBrewServices>[1],
) {
  const services = cloudflareBrewServices(bindings, options);
  const storage = new CloudflareStorage(bindings.DB);
  const clock = options.clock ?? { now: () => new Date(), monotonic: () => performance.now() };
  const regex = options.regex ?? {
    test: async () => {
      throw new Error('Regular expression execution needs setup on this instance.');
    },
  };
  return {
    ...services,
    rules: new AsyncRulesService(
      new CloudflareRuleStorage(storage),
      regex,
      { fetch: services.fetcher },
      { notify: (article) => services.events.publish('notification', article) },
      clock,
    ),
    sources: new CloudflareSources(storage, services.fetcher),
    newsletters: new CloudflareNewsletterLibrary(storage, services.articles, () => clock.now()),
  } satisfies Pick<ApiServices, keyof typeof services | 'rules' | 'sources' | 'newsletters'>;
}
export function createCloudflareLibraryApi(services: ReturnType<typeof cloudflareLibraryServices>) {
  const app = createCloudflareBrewApi(services);
  registerRulesRoutes(app, services);
  registerSourceRoutes(app, services);
  registerNewsletterRoutes(app, services);
  registerPageOutputRoutes(app, services);
  return app;
}
