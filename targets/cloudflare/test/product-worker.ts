import { createCloudflareWorker, type CloudflareWorkerEnv } from '../src/worker.js';
import { CloudflareStorage } from '../src/storage.js';
import { receiveCloudflareMail, activeInboundAddress } from '../src/inbound-mail.js';
import { NewsletterPipeline } from '../../../packages/core/src/newsletter-pipeline.js';
import { NewsletterInputError } from '../../../packages/core/src/newsletter-mime.js';
import { CloudflareNewsletterStorage } from '../src/newsletter-storage.js';
import { cloudflareHash } from '../src/ingestion.js';
import { cloudflarePollingServices } from '../src/polling-api.js';
import { CloudflareFetchBudget } from '../src/fetch-budget.js';
import { cloudflareRegex } from '../src/regex-worker.js';
import type { ForwardableEmailMessage, D1PreparedStatement } from '@cloudflare/workers-types';
import { IngestPipeline } from '../../../packages/core/src/ingest-pipeline.js';
import { AsyncRulesService } from '../../../packages/core/src/async-rules-service.js';
import type { ParsedArticle } from '../../../packages/core/src/feed-parser.js';
import { CloudflareRuleStorage } from '../src/rule-storage.js';
import { CloudflareIngestStorage } from '../src/ingest-storage.js';
import { CloudflareEvents } from '../src/events.js';

export interface ProductEnv extends CloudflareWorkerEnv {
  UPSTREAM: { fetch: typeof fetch };
}
const clock = { now: () => new Date('2026-11-27T12:00:00Z'), monotonic: () => performance.now() };
// Native bindings/clock only: every product handler and API service remains real.
const product = createCloudflareWorker<ProductEnv>({
  clock,
  fetcher: (env) => (input, init) => env.UPSTREAM.fetch(input, init),
});
class CountedStorage extends CloudflareStorage {
  readonly calls = { first: 0, all: 0, run: 0, batch: 0 };
  override first<T>(sql: string, values: unknown[] = []) {
    this.calls.first++;
    return super.first<T>(sql, values);
  }
  override all<T>(sql: string, values: unknown[] = []) {
    this.calls.all++;
    return super.all<T>(sql, values);
  }
  override run(sql: string, values: unknown[] = []) {
    this.calls.run++;
    return super.run(sql, values);
  }
  override batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
    this.calls.batch++;
    return super.batch<T>(statements);
  }
}
export default {
  ...product,
  async fetch(request: Request, env: ProductEnv) {
    const path = new URL(request.url).pathname;
    if (path === '/__review/ingest-batch') {
      const storage = new CountedStorage(env.DB),
        events = new CloudflareEvents(storage);
      const network = new CloudflareFetchBudget(40, (input, init) =>
        env.UPSTREAM.fetch(input, init),
      );
      const rules = new AsyncRulesService(
        new CloudflareRuleStorage(storage),
        cloudflareRegex,
        { fetch: network.fetch },
        { notify: (article) => events.publish('notification', article) },
        clock,
      );
      const inserted = await new IngestPipeline(
        new CloudflareIngestStorage(storage),
        cloudflareHash,
        clock,
        rules,
      ).ingest({ id: 1, retentionDays: 90 }, (await request.json()) as ParsedArticle[]);
      return Response.json({ inserted, calls: storage.calls });
    }
    if (path === '/__review/revoke-during-read' || path === '/__review/revoke-during-hash') {
      const storage = new CloudflareStorage(env.DB),
        address = (await activeInboundAddress(storage))!;
      const raw = new Uint8Array(await request.arrayBuffer());
      const revoke = () =>
        storage.run('UPDATE inbound_addresses SET active=0 WHERE id=?', [address.id]);
      const library = cloudflarePollingServices(env, {
        clock,
        regex: cloudflareRegex,
        budget: new CloudflareFetchBudget(40, (input, init) => env.UPSTREAM.fetch(input, init)),
        capabilities: () => ({
          mode: 'cloudflare',
          fetch: 'direct',
          backgroundFetch: { kind: 'cron' },
          inboundMail: null,
          emailDelivery: null,
          readerApi: false,
          mcp: null,
          webmcp: false,
          ai: { available: [], configured: false },
          readState: 'server',
          publicCopy: false,
        }),
      });
      let rejected: string | null = null;
      if (path.endsWith('read')) {
        const stream = new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              await revoke();
              controller.enqueue(raw);
              controller.close();
            },
          },
          { highWaterMark: 0 },
        );
        await receiveCloudflareMail(
          {
            from: 'bounce@example.test',
            to: address.address,
            raw: stream as unknown as ForwardableEmailMessage['raw'],
            rawSize: raw.byteLength,
            setReject: (reason) => {
              rejected = reason;
            },
          },
          storage,
          clock,
          library.rules,
        );
      } else {
        const pipeline = new NewsletterPipeline(
          new CloudflareNewsletterStorage(storage, () => ({
            predicate: 'EXISTS(SELECT 1 FROM inbound_addresses WHERE id=? AND active=1)',
            values: [address.id],
            error: () => new NewsletterInputError('This receiving address is not active.'),
          })),
          {
            sha1: async (value) => {
              await revoke();
              return cloudflareHash.sha1(value);
            },
          },
          clock,
          library.rules,
        );
        try {
          await pipeline.ingest(raw);
        } catch (error) {
          if (error instanceof NewsletterInputError) rejected = error.message;
          else throw error;
        }
      }
      return Response.json({ rejected });
    }
    // Wrangler's local assets proxy overwrites Host with its loopback listener
    // while retaining the original URL. Model the edge's canonical Host here;
    // the explicit override exercises mismatches without weakening production.
    const headers = new Headers(request.headers);
    headers.set('host', headers.get('x-review-host') ?? new URL(request.url).host);
    headers.delete('x-review-host');
    return product.fetch(new Request(request, { headers }), env);
  },
};
