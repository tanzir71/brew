import type { ReaderTestEnv } from './reader-worker.js';
import { cloudflareLibraryServices, createCloudflareLibraryApi } from '../src/library-api.js';

// Integration fixture only: production auth, action receipts and handlers remain open.
export default {
  fetch(request: Request, env: ReaderTestEnv) {
    const now = Number(request.headers.get('x-review-now') ?? Date.parse('2026-11-27T12:00:00Z'));
    const services = cloudflareLibraryServices(env, {
      clock: { now: () => new Date(now), monotonic: () => performance.now() },
      outputBaseUrl: 'https://brew.example.test',
      fetcher: (input, init) => env.UPSTREAM.fetch(input, init),
      capabilities: () => ({
        mode: 'cloudflare',
        fetch: 'direct',
        backgroundFetch: { kind: 'cron' },
        inboundMail: null,
        emailDelivery: null,
        readerApi: true,
        mcp: null,
        agentAccess: false,
        webmcp: false,
        ai: { available: [], configured: false },
        readState: 'server',
        publicCopy: false,
        outputs: { twins: true, feed: true, webhook: true },
        actions: { undo: false },
      }),
    });
    return createCloudflareLibraryApi(services).fetch(request);
  },
};
