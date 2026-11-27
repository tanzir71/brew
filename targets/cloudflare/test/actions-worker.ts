import { cloudflareRegex } from '../src/regex-worker.js';
import type { ReaderTestEnv } from './reader-worker.js';
import { cloudflareLibraryServices, createCloudflareLibraryApi } from '../src/library-api.js';
export default {
  async fetch(request: Request, env: ReaderTestEnv) {
    const at = Number(request.headers.get('x-review-now') ?? Date.parse('2026-11-27T12:00:00Z'));
    const services = cloudflareLibraryServices(env, {
      regex: cloudflareRegex,
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
        mcp: null,
        agentAccess: false,
        webmcp: false,
        ai: { available: [], configured: false },
        readState: 'server',
        publicCopy: false,
        outputs: { twins: true, feed: true, webhook: true },
        actions: { undo: true },
      }),
    });
    // Fixture-only context ingress exercises actual D1 token admission. It is not
    // a product MCP transport, token verifier or owner authentication boundary.
    if (new URL(request.url).pathname === '/__review/token') {
      try {
        return Response.json(
          await services.actions.run(await request.json(), {
            agent: 'mcp',
            tokenId: Number(request.headers.get('x-review-token')),
          }),
        );
      } catch (error) {
        return Response.json(
          { error: (error as Error).message },
          { status: (error as { status?: number }).status ?? 500 },
        );
      }
    }
    if (new URL(request.url).pathname === '/__review/undo') {
      try {
        return Response.json(
          await services.actions.undo(
            ((await request.json()) as { id: number }).id,
            Number(request.headers.get('x-review-token')),
          ),
        );
      } catch (error) {
        return Response.json(
          { error: (error as Error).message },
          { status: (error as { status?: number }).status ?? 500 },
        );
      }
    }
    return createCloudflareLibraryApi(services).fetch(request);
  },
};
