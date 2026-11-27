import type { ScheduledController } from '@cloudflare/workers-types';
import type { ReaderTestEnv } from './reader-worker.js';
import type { Capabilities } from '../../../packages/core/src/types/capabilities.js';
import { cloudflareRegex } from '../src/regex-worker.js';
import { cloudflarePollingServices, createCloudflarePollingApi } from '../src/polling-api.js';
import { CloudflareFetchBudget } from '../src/fetch-budget.js';
import { CloudflareQueryBudget } from '../src/query-budget.js';
import { countD1 } from './query-count.js';

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
function services(env: ReaderTestEnv, time: number, limit = 40, queryLimit = 50, spent = 0) {
  const budget = new CloudflareFetchBudget(limit, (input, init) => env.UPSTREAM.fetch(input, init));
  const queryBudget = new CloudflareQueryBudget(queryLimit);
  // Simulate preceding invocation work without faking any native polling calls.
  for (let i = 0; i < spent; i++) queryBudget.record();
  const native = countD1(env.DB);
  return {
    budget,
    queryBudget,
    native,
    library: cloudflarePollingServices(
      { ...env, DB: native.database },
      {
        budget,
        queryBudget,
        regex: cloudflareRegex,
        capabilities: () => capabilities,
        clock: { now: () => new Date(time), monotonic: () => performance.now() },
      },
    ),
  };
}
export default {
  async fetch(request: Request, env: ReaderTestEnv) {
    const { budget, library, queryBudget, native } = services(
      env,
      Number(request.headers.get('x-review-now') ?? at),
      Number(request.headers.get('x-review-limit') ?? 40),
      Number(request.headers.get('x-review-query-limit') ?? 50),
      Number(request.headers.get('x-review-query-spent') ?? 0),
    );
    if (new URL(request.url).pathname === '/__review/resume')
      return Response.json({
        steps: await library.pendingIngestion.resume(),
        used: budget.used,
        queries: native.calls,
        accounted: queryBudget.used,
      });
    if (new URL(request.url).pathname === '/__review/poll') {
      if (request.headers.has('x-review-prefetch'))
        await (await budget.fetch('https://source.test/prefetch')).body?.cancel();
      return Response.json({
        results: await library.poller.pollDue(),
        used: budget.used,
        queries: native.calls,
        accounted: queryBudget.used,
      });
    }
    return createCloudflarePollingApi(library).fetch(request);
  },
  async scheduled(controller: ScheduledController, env: ReaderTestEnv) {
    const { budget, library, queryBudget, native } = services(env, controller.scheduledTime);
    const results = await library.poller.pollDue();
    await env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)')
      .bind(
        `review-poll-${controller.scheduledTime}`,
        JSON.stringify({
          results,
          used: budget.used,
          queries: native.calls,
          accounted: queryBudget.used,
        }),
      )
      .run();
  },
};
