import type { ScheduledController } from '@cloudflare/workers-types';
import type { ReaderTestEnv } from './reader-worker.js';
import type { Capabilities } from '../../../packages/core/src/types/capabilities.js';
import { cloudflareRegex } from '../src/regex-worker.js';
import { cloudflarePollingServices, createCloudflarePollingApi } from '../src/polling-api.js';
import { CloudflareFetchBudget } from '../src/fetch-budget.js';

// Explicit integration ingress. It is not the product owner-auth boundary.
const at = Date.parse('2026-11-27T12:00:00Z');
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
  outputs: { twins: true, feed: true, webhook: true },
  actions: { undo: false },
  limits: { maxFetchesPerRun: 40 },
};
function services(env: ReaderTestEnv, time: number, limit = 40) {
  const budget = new CloudflareFetchBudget(limit, (input, init) => env.UPSTREAM.fetch(input, init));
  return {
    budget,
    library: cloudflarePollingServices(env, {
      budget,
      regex: cloudflareRegex,
      capabilities: () => capabilities,
      clock: { now: () => new Date(time), monotonic: () => performance.now() },
    }),
  };
}
export default {
  async fetch(request: Request, env: ReaderTestEnv) {
    const { budget, library } = services(
      env,
      Number(request.headers.get('x-review-now') ?? at),
      Number(request.headers.get('x-review-limit') ?? 40),
    );
    if (new URL(request.url).pathname === '/__review/poll') {
      if (request.headers.has('x-review-prefetch'))
        await (await budget.fetch('https://source.test/prefetch')).body?.cancel();
      return Response.json({ results: await library.poller.pollDue(), used: budget.used });
    }
    return createCloudflarePollingApi(library).fetch(request);
  },
  async scheduled(controller: ScheduledController, env: ReaderTestEnv) {
    const { budget, library } = services(env, controller.scheduledTime);
    const results = await library.poller.pollDue();
    await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)')
      .bind(
        `review-poll-${controller.scheduledTime}`,
        JSON.stringify({ results, used: budget.used }),
      )
      .run();
  },
};
