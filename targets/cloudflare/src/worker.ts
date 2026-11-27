import type {
  D1Database,
  R2Bucket,
  ForwardableEmailMessage,
  ScheduledController,
} from '@cloudflare/workers-types';
import { createApi, securityHeaders } from '../../../packages/api/src/app.js';
import { createBrewMcpHandler } from '../../../packages/api/src/mcp.js';
import type { ClockPort, RegexPort } from '../../../packages/core/src/ports.js';
import type { Capabilities } from '../../../packages/core/src/types/capabilities.js';
import { isAppPageOutputPath } from '../../../packages/core/src/app-pages.js';
import { isReaderPageOutputPath } from '../../../packages/core/src/reader-pages.js';
import { isArticleOutputPath } from '../../../packages/core/src/article-outputs.js';
import { isBrewOutputPath } from '../../../packages/core/src/brew-output-paths.js';
import {
  CloudflareAccessVerifier,
  AccessDenied,
  AccessUnavailable,
  accessConfiguration,
} from './access.js';
import { publicOrigin } from './worker-config.js';
import { CloudflareFetchBudget } from './fetch-budget.js';
import { cloudflarePollingServices } from './polling-api.js';
import { cloudflareRegex } from './regex-worker.js';
import { CloudflareStorage } from './storage.js';
import { upgradeLegacyCompositions } from './legacy-composition.js';
import {
  initializeInboundAddress,
  activeInboundAddress,
  receiveCloudflareMail,
} from './inbound-mail.js';
import { cloudflareIngestion } from './ingestion.js';

export interface CloudflareWorkerEnv {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: { fetch: typeof fetch };
  /** Optional independent binding containing only published static artifacts. */
  PUBLIC_ASSETS?: { fetch: typeof fetch };
  BREW_PUBLIC_URL?: string;
  BREW_ACCESS_TEAM_DOMAIN?: string;
  BREW_ACCESS_AUD?: string;
  BREW_INBOUND_ADDRESS?: string;
  BREW_MAX_FETCHES_PER_RUN?: string;
  BREW_WEBMCP?: string;
}
function result(value: unknown, status = 200) {
  return Response.json(value, { status });
}
async function secured(response: Response, head = false, published = false) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders))
    if (name !== 'Content-Security-Policy' || !headers.has(name)) headers.set(name, value);
  headers.set('Cache-Control', published ? 'public, max-age=60' : 'private, no-store');
  if (published) headers.delete('set-cookie');
  if (head) await response.body?.cancel();
  return new Response(head ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
const machinePath = (path: string) =>
  path === '/mcp' ||
  path.startsWith('/api/greader/') ||
  path === '/api/fever' ||
  path === '/api/fever/';
const apiPath = (path: string) =>
  path === '/api' ||
  path.startsWith('/api/') ||
  path === '/mcp' ||
  path === '/llms.txt' ||
  isAppPageOutputPath(path) ||
  isReaderPageOutputPath(path) ||
  isArticleOutputPath(path) ||
  isBrewOutputPath(path);

/** Ports can be supplied by a real native harness without replacing services. */
export function createCloudflareWorker<E extends CloudflareWorkerEnv = CloudflareWorkerEnv>(
  options: {
    clock?: ClockPort;
    fetcher?: (env: E) => typeof fetch;
    regex?: RegexPort;
  } = {},
) {
  const access = new CloudflareAccessVerifier();
  const clock = options.clock ?? { now: () => new Date(), monotonic: () => performance.now() };
  const budget = (env: E) =>
    new CloudflareFetchBudget(
      env.BREW_MAX_FETCHES_PER_RUN === undefined ? 40 : Number(env.BREW_MAX_FETCHES_PER_RUN),
      options.fetcher?.(env) ?? globalThis.fetch,
    );
  async function services(env: E, network: CloudflareFetchBudget, initialize: boolean) {
    const base = publicOrigin(env.BREW_PUBLIC_URL);
    const storage = new CloudflareStorage(env.DB);
    if (initialize) {
      await upgradeLegacyCompositions(storage);
      await initializeInboundAddress(storage, env.BREW_INBOUND_ADDRESS);
    }
    const library = cloudflarePollingServices(env, {
      budget: network,
      clock,
      regex: options.regex ?? cloudflareRegex,
      outputBaseUrl: base,
      capabilities: async (): Promise<Capabilities> => ({
        mode: 'cloudflare',
        fetch: 'direct',
        backgroundFetch: { kind: 'cron', everyMinutes: 1 },
        inboundMail: (await activeInboundAddress(storage)) ? 'cloudflare-email' : null,
        emailDelivery: null,
        readerApi: (await library.readerSync.access.status()).enabled,
        mcp: 'http',
        agentAccess: true,
        webmcp: env.BREW_WEBMCP === '1',
        ai: { available: [], configured: false },
        readState: 'server',
        publicCopy: false,
        outputs: { twins: true, feed: true, webhook: true },
        actions: { undo: true },
        limits: { maxFetchesPerRun: network.limit },
      }),
    });
    return { library, storage };
  }
  return {
    async fetch(request: Request, env: E): Promise<Response> {
      const url = new URL(request.url),
        head = request.method === 'HEAD';
      try {
        if (url.pathname === '/api/health')
          return secured(
            ['GET', 'HEAD'].includes(request.method)
              ? result({ ok: true })
              : result({ error: 'Method not allowed.' }, 405),
            head,
          );
        let base: string;
        try {
          base = publicOrigin(env.BREW_PUBLIC_URL);
        } catch {
          return secured(
            result(
              { error: 'Configure BREW_PUBLIC_URL as the HTTPS origin of this instance.' },
              503,
            ),
            head,
          );
        }
        if (
          url.origin !== base ||
          (request.headers.has('host') &&
            request.headers.get('host')!.toLowerCase() !== new URL(base).host)
        )
          return secured(result({ error: 'Use the configured instance origin.' }, 421), head);
        if (url.pathname.startsWith('/share/')) {
          if (!['GET', 'HEAD'].includes(request.method))
            return secured(result({ error: 'Published copies are read-only.' }, 405), head);
          if (!env.PUBLIC_ASSETS)
            return secured(result({ error: 'Published copy not found.' }, 404), head);
          // Static artifacts have no owner API or database access. Never forward
          // owner cookies, Access assertions, credentials or private queries.
          const published = new URL(url);
          published.search = '';
          published.hash = '';
          return secured(
            await env.PUBLIC_ASSETS.fetch(
              new Request(published, {
                method: request.method,
                headers: { accept: request.headers.get('accept') ?? '*/*' },
              }),
            ),
            head,
            true,
          );
        }
        const network = budget(env),
          machine = machinePath(url.pathname);
        if (!machine) {
          const config = accessConfiguration(env.BREW_ACCESS_TEAM_DOMAIN, env.BREW_ACCESS_AUD);
          await access.verify(
            request.headers.get('cf-access-jwt-assertion'),
            config,
            network.fetch,
            clock.now(),
          );
          if (
            !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
            (request.headers.get('origin') !== base ||
              request.headers.get('sec-fetch-site') === 'cross-site')
          )
            return secured(
              result({ error: 'Use a same-origin request for owner changes.' }, 403),
              head,
            );
        }
        if (!apiPath(url.pathname)) return secured(await env.ASSETS.fetch(request), head);
        // Bootstrap belongs to deployment/background work, never an HTTP read,
        // preview, rejected mutation, or machine-credential admission attempt.
        const { library } = await services(env, network, false);
        const app = createApi(library, { mcp: createBrewMcpHandler(library) });
        app.onError(() => result({ error: 'The request could not be completed.' }, 500));
        return secured(await app.fetch(request), head);
      } catch (error) {
        if (error instanceof AccessDenied)
          return secured(result({ error: error.message }, 401), head);
        if (error instanceof AccessUnavailable)
          return secured(result({ error: error.message }, 503), head);
        return secured(
          result(
            {
              error:
                'The instance is temporarily unavailable. Check its bindings and configuration.',
            },
            503,
          ),
          head,
        );
      }
    },
    async scheduled(_controller: ScheduledController, env: E) {
      const network = budget(env);
      const { library } = await services(env, network, true);
      // Freeze/deliver scheduled issues before polling can spend the allowance.
      await library.actions.cleanup();
      await cloudflareIngestion(env.DB, clock, library.rules).newsletters.prune();
      await library.brews.runScheduled();
      await library.brews.runCompositionScheduled();
      await library.poller.pollDue();
    },
    async email(message: ForwardableEmailMessage, env: E) {
      try {
        const { library, storage } = await services(env, budget(env), true);
        await receiveCloudflareMail(message, storage, clock, library.rules);
      } catch {
        await message.raw.cancel().catch(() => undefined);
        throw new Error('Newsletter storage is temporarily unavailable.');
      }
    },
  };
}
export default createCloudflareWorker();
