import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Capabilities } from '../../../packages/core/src/types/capabilities.js';
import { cloudflareReaderServices, createCloudflareReaderApi } from '../src/reader-api.js';

export interface ReaderTestEnv {
  DB: D1Database;
  IMAGES: R2Bucket;
  UPSTREAM: { fetch: typeof fetch };
}
const at = Date.parse('2026-11-27T12:00:00Z');
// Only the integration fixture supplies this clock and capability subset. It is
// not a deployable Worker or the completed Cloudflare capability declaration.
const capabilities: Capabilities = {
  mode: 'cloudflare',
  fetch: 'direct',
  backgroundFetch: { kind: 'cron', everyMinutes: 1 },
  inboundMail: null,
  emailDelivery: null,
  readerApi: false,
  mcp: null,
  agentAccess: false,
  webmcp: false,
  ai: { available: [], configured: false },
  readState: 'server',
  publicCopy: false,
  outputs: { twins: true, feed: false, webhook: false },
  actions: { undo: false },
  limits: { maxFetchesPerRun: 40 },
};
export default {
  fetch(request: Request, env: ReaderTestEnv) {
    const now = request.headers.get('x-review-now')
      ? Number(request.headers.get('x-review-now'))
      : at;
    const services = cloudflareReaderServices(env, {
      clock: { now: () => new Date(now), monotonic: () => performance.now() },
      capabilities: () => capabilities,
      fetcher: (input, init) => env.UPSTREAM.fetch(input, init),
      eventPollMs: 25,
      eventLifetimeMs: 1500,
    });
    return createCloudflareReaderApi(services).fetch(request);
  },
};
