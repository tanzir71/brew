import type { ApiServices } from '../../../packages/api/src/ports.js';
import { createApiBase } from '../../../packages/api/src/api-base.js';
import { registerFeedRoutes } from '../../../packages/api/src/routes/feeds.js';
import { registerSourceRoutes } from '../../../packages/api/src/routes/sources.js';
import { registerArticleRoutes } from '../../../packages/api/src/routes/articles.js';
import { registerReaderRoutes } from '../../../packages/api/src/routes/reader.js';
import { registerSearchRoutes } from '../../../packages/api/src/routes/search.js';
import { registerRulesRoutes } from '../../../packages/api/src/routes/rules.js';
import { registerBrewRoutes } from '../../../packages/api/src/routes/brews.js';
import { registerBrewOutputRoutes } from '../../../packages/api/src/routes/brew-outputs.js';
import { registerArticleOutputRoutes } from '../../../packages/api/src/routes/article-outputs.js';
import { registerReaderOutputRoutes } from '../../../packages/api/src/routes/reader-outputs.js';
import { registerPageOutputRoutes } from '../../../packages/api/src/routes/page-outputs.js';
import { registerActionRoutes } from '../../../packages/api/src/routes/actions.js';
import { registerOpmlRoutes } from '../../../packages/api/src/routes/opml.js';
import { registerPollerRoutes } from '../../../packages/api/src/routes/poller.js';
import { registerNewsletterRoutes } from '../../../packages/api/src/newsletters.js';
import { registerWebMcpRoutes } from '../../../packages/api/src/routes/webmcp.js';
import { registerAgentAccessRoutes } from '../../../packages/api/src/routes/agent-access.js';
import { registerReaderAccess } from '../../../packages/api/src/routes/reader-access.js';
import { registerInstanceGuide } from '../../../packages/api/src/routes/instance-guide.js';
import { registerOpenApi } from '../../../packages/api/src/openapi.js';
import { registerMediaRoutes } from '../../../packages/api/src/routes/media.js';
import { AsyncBrewService } from '../../../packages/core/src/async-brew-service.js';
import { AsyncRulesService } from '../../../packages/core/src/async-rules-service.js';
import { AsyncActionsService } from '../../../packages/core/src/async-actions-service.js';
import type { Capabilities } from '../../../packages/core/src/types/capabilities.js';
import type { NotificationPort } from '../../../packages/core/src/ports.js';
import { SqlReader } from '../../../packages/db/src/sql-reader-service.js';
import { SqlSearch } from '../../../packages/db/src/sql-search-service.js';
import { SqlFeeds } from '../../../packages/db/src/sql-feed-service.js';
import { SqlArticles } from '../../../packages/db/src/sql-article-service.js';
import { SqlApiData } from '../../../packages/db/src/sql-api-data.js';
import { SqlSources } from '../../../packages/db/src/sql-source-service.js';
import { SqlRuleStorage } from '../../../packages/db/src/sql-rule-storage.js';
import { SqlBrewStorage } from '../../../packages/db/src/sql-brew-storage.js';
import { SqlActionStorage } from '../../../packages/db/src/sql-action-storage.js';
import { SqlNewsletterLibrary } from '../../../packages/db/src/sql-newsletter-library.js';
import { SqlOpml } from '../../../packages/db/src/sql-opml-service.js';
import Parser from 'rss-parser/dist/rss-parser.min.js';
import { BrowserSqlStorage } from './sql-storage.js';
import { BrowserFetching } from './fetching.js';
import { browserRegex } from './regex.js';
import { isSqliteConstraint } from './errors.js';
import { browserStartStatus, startBrowserLibrary, type BrowserStart } from './start.js';
import { inlinePreviewImages } from './preview-images.js';

export interface BrowserApiOptions {
  origin: string;
  assetBase: string;
  timezone: string;
  webmcp: boolean;
}
export interface BrowserHttpRequest {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body?: Uint8Array;
}
export interface BrowserHttpResponse {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: Uint8Array;
}

/** The same Hono routes and domain services operate on the private SQLite library. */
export class BrowserApi {
  readonly services: ApiServices;
  private app;
  private starting?: Promise<BrowserStart>;
  constructor(
    readonly storage: BrowserSqlStorage,
    readonly fetching: BrowserFetching,
    notifications: NotificationPort,
    readonly options: BrowserApiOptions,
  ) {
    const clock = { now: () => new Date(), monotonic: () => performance.now() };
    const parser = new Parser();
    const xml = { parse: (body: string) => parser.parseString(body) };
    const fetcher = fetching.fetch;
    const brews = new AsyncBrewService(
      new SqlBrewStorage(storage, options.timezone),
      clock,
      browserRegex,
      { baseUrl: options.origin, fetcher },
    );
    const articles = new SqlArticles(storage, fetcher, clock.now);
    const events: ApiServices['events'] = { subscribe: () => () => {} };
    this.services = {
      capabilities: (): Capabilities => ({
        mode: 'browser',
        fetch: 'relay',
        fetchConfigured: fetching.status().configured,
        backgroundFetch: { kind: 'while-open', everyMinutes: 1 },
        inboundMail: 'email-to-feed',
        emailDelivery: null,
        readerApi: false,
        mcp: null,
        agentAccess: false,
        webmcp: options.webmcp,
        ai: { available: [], configured: false },
        readState: 'local',
        publicCopy: false,
        outputs: { twins: true, feed: false, webhook: true },
        actions: { undo: true },
      }),
      outputBaseUrl: options.origin,
      fetcher,
      events,
      feeds: new SqlFeeds(storage, xml, fetcher, clock.now),
      articles,
      reader: new SqlReader(storage, clock.now),
      search: new SqlSearch(storage, clock),
      data: new SqlApiData(storage),
      sources: new SqlSources(storage, xml, fetcher),
      rules: new AsyncRulesService(
        new SqlRuleStorage(storage, isSqliteConstraint),
        browserRegex,
        { fetch: fetcher },
        notifications,
        clock,
      ),
      brews,
      opml: new SqlOpml(storage),
      newsletters: new SqlNewsletterLibrary(storage, articles, clock.now),
      actions: new AsyncActionsService(
        new SqlActionStorage(storage, {
          clock,
          fetcher,
          regex: browserRegex,
          notify: (article) => notifications.notify(article),
          parser: xml,
          isConstraint: isSqliteConstraint,
        }),
      ),
      poller: { pollFeedById: async (id) => (await fetching.refresh(id)).results[0] ?? null },
    };
    const app = (this.app = createApiBase());
    registerFeedRoutes(app, this.services);
    registerSourceRoutes(app, this.services);
    registerArticleRoutes(app, this.services);
    registerReaderRoutes(app, this.services);
    registerSearchRoutes(app, this.services);
    registerRulesRoutes(app, this.services);
    registerBrewRoutes(app, this.services);
    registerBrewOutputRoutes(app, this.services);
    registerArticleOutputRoutes(app, this.services);
    registerReaderOutputRoutes(app, this.services);
    registerPageOutputRoutes(app, this.services);
    registerActionRoutes(app, this.services);
    registerOpmlRoutes(app, this.services);
    registerPollerRoutes(app, this.services);
    registerNewsletterRoutes(app, this.services);
    registerWebMcpRoutes(app, this.services);
    registerAgentAccessRoutes(app, this.services);
    registerReaderAccess(app, this.services);
    registerInstanceGuide(app, this.services, false);
    registerOpenApi(app);
    registerMediaRoutes(app, this.services);
    app.get('/api/capabilities', async (c) => c.json(await this.services.capabilities()));
    app.get('/api/health', (c) => c.json({ ok: true }));
    app.get('/api/browser/start', async (c) => c.json(await browserStartStatus(this)));
    app.post('/api/browser/start', async (c) => {
      this.starting ??= startBrowserLibrary(this).finally(() => {
        this.starting = undefined;
      });
      return c.json(await this.starting);
    });
    app.get('/api/browser/relay', (c) => c.json(fetching.status()));
    app.put('/api/browser/relay', async (c) => {
      try {
        const value = await c.req.json();
        const current = fetching.status();
        if (
          !value.token &&
          current.configured &&
          typeof value.endpoint === 'string' &&
          new URL(value.endpoint).href === current.endpoint
        )
          return c.json(current);
        await fetching.configure(value);
        return c.json(fetching.status());
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : 'Could not save relay settings.' },
          error instanceof TypeError ? 400 : 500,
        );
      }
    });
    app.delete('/api/browser/relay', async (c) => {
      await fetching.configure(null);
      return c.json(fetching.status());
    });
    app.get('/api/events', (c) => c.json({ error: 'Browser libraries use in-page events.' }, 501));
  }
  async http(input: BrowserHttpRequest): Promise<BrowserHttpResponse> {
    const url = new URL(input.url, this.options.origin);
    if (url.origin !== this.options.origin) throw new Error('Use the local library API.');
    const response = await this.app.fetch(
      new Request(url, {
        method: input.method,
        headers: input.headers,
        body: input.body as BodyInit | undefined,
      }),
    );
    let body: Uint8Array;
    if (/^\/api\/brew-configs\/[1-9]\d*\/preview$/.test(url.pathname) && response.ok) {
      const preview = await response.json();
      if (typeof preview.outputs?.email === 'string')
        preview.outputs.email = await inlinePreviewImages(
          preview.outputs.email,
          this.options.origin,
          async (input) => this.app.fetch(new Request(input)),
        );
      body = new TextEncoder().encode(JSON.stringify(preview));
    } else body = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers],
      body,
    };
  }
  async scheduled() {
    const brews = this.services.brews;
    await brews.runScheduled();
    await brews.runCompositionScheduled();
  }
}
