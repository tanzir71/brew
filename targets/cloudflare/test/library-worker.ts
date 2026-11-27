import { cloudflareRegex } from '../src/regex-worker.js';
import type { ForwardableEmailMessage } from '@cloudflare/workers-types';
import type { ReaderTestEnv } from './reader-worker.js';
import type { Capabilities } from '../../../packages/core/src/types/capabilities.js';
import type { ParsedArticle } from '../../../packages/core/src/feed-parser.js';
import { NewsletterInputError } from '../../../packages/core/src/newsletter-mime.js';
import { cloudflareLibraryServices, createCloudflareLibraryApi } from '../src/library-api.js';
import { cloudflareIngestion, readNewsletterStream, cloudflareHash } from '../src/ingestion.js';
import { NewsletterPipeline } from '../../../packages/core/src/newsletter-pipeline.js';
import { CloudflareNewsletterStorage } from '../src/newsletter-storage.js';
import { CloudflareStorage } from '../src/storage.js';

const clock = { now: () => new Date('2026-11-27T12:00:00Z'), monotonic: () => performance.now() };
const capabilities: Capabilities = {
  mode: 'cloudflare',
  fetch: 'direct',
  backgroundFetch: { kind: 'cron' },
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
};
function services(env: ReaderTestEnv) {
  return cloudflareLibraryServices(env, {
    regex: cloudflareRegex,
    capabilities: () => capabilities,
    clock,
    fetcher: (input, init) => env.UPSTREAM.fetch(input, init),
    eventPollMs: 25,
    eventLifetimeMs: 4000,
  });
}
// Test-only ingress and email wrapper. Product envelope/address checks, the
// complete API graph, owner auth and scheduled polling are still separate work.
export default {
  async fetch(request: Request, env: ReaderTestEnv) {
    const library = services(env);
    if (new URL(request.url).pathname === '/__review/newsletter-block-race') {
      const pipeline = new NewsletterPipeline(
        new CloudflareNewsletterStorage(new CloudflareStorage(env.DB)),
        {
          sha1: async (value) => {
            await library.newsletters.updateSender(Number(request.headers.get('x-review-sender')), {
              blocked: true,
            });
            return cloudflareHash.sha1(value);
          },
        },
        clock,
        library.rules,
      );
      return Response.json(await pipeline.ingest(await readNewsletterStream(request.body!)));
    }
    if (new URL(request.url).pathname === '/__review/newsletter') {
      return Response.json(
        await cloudflareIngestion(env.DB, clock, library.rules).newsletters.ingest(
          await readNewsletterStream(request.body!),
        ),
      );
    }
    if (new URL(request.url).pathname === '/__review/ingest') {
      const input = (await request.json()) as {
        feed: { id: number; retentionDays: number };
        items: Array<Omit<ParsedArticle, 'publishedAt'> & { publishedAt: string }>;
      };
      const inserted = await cloudflareIngestion(env.DB, clock, library.rules).articles.ingest(
        input.feed,
        input.items.map((item) => ({ ...item, publishedAt: new Date(item.publishedAt) })),
      );
      return Response.json({ inserted });
    }
    return createCloudflareLibraryApi(library).fetch(request);
  },
  async email(message: ForwardableEmailMessage, env: ReaderTestEnv) {
    try {
      await cloudflareIngestion(env.DB, clock, services(env).rules).newsletters.ingest(
        await readNewsletterStream(
          message.raw as unknown as ReadableStream<Uint8Array>,
          message.rawSize,
        ),
      );
    } catch (error) {
      if (error instanceof NewsletterInputError) message.setReject(error.message);
      else throw error;
    }
  },
};
