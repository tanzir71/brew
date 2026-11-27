import { cloudflareRegex } from '../src/regex-worker.js';
import type { ScheduledController } from '@cloudflare/workers-types';
import type { ReaderTestEnv } from './reader-worker.js';
import type { Capabilities } from '../../../packages/core/src/types/capabilities.js';
import { cloudflareBrewServices, createCloudflareBrewApi } from '../src/brew-api.js';

const at = Date.parse('2026-11-27T12:00:00Z');
// Test-only clock, capability subset and mail port. This is not the product
// Worker entrypoint, an auth boundary or a Cloudflare/Resend delivery adapter.
const capabilities: Capabilities = {
  mode: 'cloudflare',
  fetch: 'direct',
  backgroundFetch: { kind: 'cron', everyMinutes: 1 },
  inboundMail: null,
  emailDelivery: 'resend',
  readerApi: false,
  mcp: null,
  agentAccess: false,
  webmcp: false,
  ai: { available: [], configured: false },
  readState: 'server',
  publicCopy: false,
  outputs: { twins: true, feed: true, webhook: true },
  actions: { undo: false },
  limits: { maxFetchesPerRun: 40 },
};
function services(env: ReaderTestEnv, now: number) {
  return cloudflareBrewServices(env, {
    clock: { now: () => new Date(now), monotonic: () => performance.now() },
    regex: cloudflareRegex,
    capabilities: () => capabilities,
    fetcher: (input, init) => env.UPSTREAM.fetch(input, init),
    outputBaseUrl: 'https://brew.example.test',
    outboundMail: {
      kind: 'resend',
      async send(message) {
        const response = await env.UPSTREAM.fetch('https://delivery.example.test/mail', {
          method: 'POST',
          body: JSON.stringify(message),
        });
        return (await response.json()) as { messageId: string };
      },
    },
  });
}
export default {
  fetch(request: Request, env: ReaderTestEnv) {
    return createCloudflareBrewApi(
      services(env, Number(request.headers.get('x-review-now') ?? at)),
    ).fetch(request);
  },
  async scheduled(controller: ScheduledController, env: ReaderTestEnv) {
    await services(env, controller.scheduledTime).brews.runCompositionScheduled();
  },
};
