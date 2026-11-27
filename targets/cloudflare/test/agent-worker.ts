import type { ReaderTestEnv } from './reader-worker.js';
import { cloudflareLibraryServices, createCloudflareLibraryApi } from '../src/library-api.js';

// Integration fixture, not the product Worker or its pending owner access gate.
export default {
  async fetch(request: Request, env: ReaderTestEnv) {
    const at = Number(request.headers.get('x-review-now') ?? Date.parse('2026-11-27T12:00:00Z'));
    const services = cloudflareLibraryServices(env, {
      clock: { now: () => new Date(at), monotonic: () => performance.now() },
      outputBaseUrl: 'https://brew.example.test',
      fetcher: (input, init) => env.UPSTREAM.fetch(input, init),
      capabilities: () => ({
        mode: 'cloudflare',
        fetch: 'direct',
        backgroundFetch: { kind: 'cron' },
        inboundMail: null,
        emailDelivery: null,
        readerApi: true,
        mcp: 'http',
        agentAccess: true,
        webmcp: request.headers.get('x-review-webmcp') === '1',
        ai: { available: [], configured: false },
        readState: 'server',
        publicCopy: false,
        outputs: { twins: true, feed: true, webhook: true },
        actions: { undo: true },
      }),
    });
    return createCloudflareLibraryApi(services).fetch(request);
  },
};
