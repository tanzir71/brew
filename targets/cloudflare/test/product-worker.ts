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
import { IngestProcessingService } from '../../../packages/core/src/ingest-processing.js';
import { CloudflareIngestJobs } from '../src/ingest-jobs.js';
import { countD1 } from './query-count.js';

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
async function processingSnapshot(env: ProductEnv) {
  const result = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare('SELECT count(*) AS n FROM ingest_jobs'),
    env.DB.prepare('SELECT count(*) AS n FROM articles'),
    env.DB.prepare('SELECT count(*) AS n FROM articles WHERE starred_at IS NOT NULL'),
    env.DB.prepare('SELECT count(*) AS n FROM rule_logs'),
    env.DB.prepare('SELECT count(*) AS n FROM ingest_job_items'),
    env.DB.prepare('SELECT runner,expires_at FROM ingest_jobs ORDER BY sequence LIMIT 1'),
    env.DB.prepare('SELECT starred_at FROM articles ORDER BY id'),
  ]);
  return {
    jobs: Number(result[0]!.results[0]!.n),
    articles: Number(result[1]!.results[0]!.n),
    starred: Number(result[2]!.results[0]!.n),
    logs: Number(result[3]!.results[0]!.n),
    members: Number(result[4]!.results[0]!.n),
    lease: result[5]!.results[0] ?? null,
    timestamps: result[6]!.results,
  };
}
const scheduledController = () => ({
  cron: '* * * * *',
  scheduledTime: clock.now().getTime(),
  noRetry() {},
});
const reviewWorker = {
  ...product,
  async scheduled(controller: Parameters<typeof product.scheduled>[0], env: ProductEnv) {
    const native = countD1(env.DB);
    const invocation =
      controller.cron === 'review:advance'
        ? createCloudflareWorker<ProductEnv>({
            clock: {
              now: () => new Date(controller.scheduledTime),
              monotonic: () => performance.now(),
            },
            fetcher: (env) => (input, init) => env.UPSTREAM.fetch(input, init),
          })
        : product;
    await invocation.scheduled(controller, { ...env, DB: native.database });
    await native.database
      .prepare(
        "INSERT INTO settings(key,value) VALUES('review:cron:queries',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .bind(String(native.calls + 1))
      .run();
  },
  async fetch(request: Request, env: ProductEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/__review/resume-mail') {
      const before = await processingSnapshot(env);
      await product.scheduled(scheduledController(), env);
      await product.scheduled(scheduledController(), env);
      return Response.json({ before, after: await processingSnapshot(env) });
    }
    if (path === '/__review/queued-undo') {
      const { count } = (await request.json()) as { count: number };
      if (count !== 1 && count !== 30) throw new Error('Unsupported native fixture count');
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO feeds(id,url,title) VALUES(1,'https://source.test/quiet','Queued Undo')",
        ),
        env.DB.prepare(
          "INSERT INTO rules(name,match_type,scope_json,conditions_json,actions_json) VALUES('Restored work','all','{}','[]','[{\"type\":\"star\"}]')",
        ),
      ]);
      const inserted = await reviewWorker.fetch(
        new Request(new URL('/__review/ingest-batch?defer=1', request.url), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            Array.from({ length: count }, (_, id) => ({
              guid: `undo-${id}`,
              url: `https://one.test/undo-${id}`,
              title: `Queued Undo ${id}`,
              author: null,
              summaryHtml: null,
              contentHtml: '<p>Queued.</p>',
              publishedAt: clock.now().toISOString(),
            })),
          ),
        }),
        env,
      );
      await env.DB.prepare("UPDATE ingest_jobs SET runner='prior-runner',expires_at=?")
        .bind(clock.now().getTime() + 60_000)
        .run();
      const headers = new Headers(request.headers);
      headers.set('host', new URL(request.url).host);
      headers.set('origin', new URL(request.url).origin);
      headers.set('content-type', 'application/json');
      headers.delete('x-review-host');
      const removed = await product.fetch(
        new Request(new URL('/api/actions', request.url), {
          method: 'POST',
          headers,
          body: JSON.stringify({ kind: 'delete_feed', id: 1, confirm: true }),
        }),
        env,
      );
      if (removed.status !== 200)
        return Response.json({ removed: removed.status, error: await removed.text() });
      const receipt = (await removed.json()) as { id: number },
        deleted = await processingSnapshot(env);
      const restored = await product.fetch(
        new Request(new URL(`/api/actions/${receipt.id}/undo`, request.url), {
          method: 'POST',
          headers,
          body: '{}',
        }),
        env,
      );
      if (restored.status !== 200)
        return Response.json({ restored: restored.status, error: await restored.text() });
      const recovered = await processingSnapshot(env);
      await product.scheduled(scheduledController(), env);
      return Response.json({
        inserted: inserted.status,
        removed: removed.status,
        restored: restored.status,
        deleted,
        recovered,
        after: await processingSnapshot(env),
      });
    }
    if (path === '/__review/ingest-batch') {
      const paused = new URL(request.url).searchParams.has('defer');
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
      const ingestStorage = new CloudflareIngestStorage(storage, undefined, paused);
      const pending = new IngestProcessingService(
        new CloudflareIngestJobs(storage),
        ingestStorage,
        new CloudflareRuleStorage(storage),
        cloudflareRegex,
        { fetch: network.fetch },
        { notify: (article) => events.publish('notification', article) },
        clock,
        () => crypto.randomUUID(),
        { remaining: 0 },
      );
      const inserted = await new IngestPipeline(
        ingestStorage,
        cloudflareHash,
        clock,
        rules,
        paused
          ? {
              processInserted: async () => {
                await pending.drain();
              },
            }
          : undefined,
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
export default reviewWorker;
