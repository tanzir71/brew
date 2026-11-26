import { SmtpMail } from './ports/smtp-mail.js';
import type { NodeSmtpConfig } from './outbound-config.js';
import type { ConnectionOptions } from 'node:tls';
import { outputBaseUrl } from '../../../packages/core/src/brew-output-content.js';
import type { ClockPort } from '../../../packages/core/src/ports.js';
import type { OutboundMailPort } from '../../../packages/core/src/types/delivery.js';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { createApi, securityHeaders } from '../../../packages/api/src/app.js';
import { json } from '../../../packages/api/src/http.js';
import { openDatabase, type BrewDatabase } from './db/database.js';
import { mountApi } from './hono-transport.js';
import { nodeApiServices } from './ports/api-services.js';
import { PollerService } from './services/poller-service.js';
import { IngestPipeline } from './services/ingest-pipeline.js';
import { SseBroker } from './services/sse-broker.js';
import { RulesService } from './services/rules-service.js';
import { BrewService } from './services/brew-service.js';
import { NewsletterService } from './services/newsletter-service.js';
import { InboundWebhook } from './services/inbound-webhook.js';
import { ImapPoller, type ImapClientFactory } from './services/imap-poller.js';
import type { NodeInboundConfig } from './inbound-config.js';
import type { NewsletterIngestResult } from '../../../packages/core/src/types/newsletters.js';
import { activateInboundAddress } from './ports/inbound-address.js';
import { createBrewMcpHandler } from '../../../packages/api/src/mcp.js';
import type { ApiServices } from '../../../packages/api/src/ports.js';

export function nodeServices(app: FastifyInstance): ApiServices {
  return app.getDecorator<ApiServices>('brewServices');
}

const webDirectory = fileURLToPath(new URL('../../../packages/web/dist/', import.meta.url));

export async function createApp(
  options: {
    serveWeb?: boolean;
    publicUrl?: string;
    database?: BrewDatabase;
    fetcher?: typeof fetch;
    startPoller?: boolean;
    clock?: ClockPort;
    outboundMail?: OutboundMailPort;
    smtp?: NodeSmtpConfig | null;
    smtpTls?: Pick<ConnectionOptions, 'ca'>;
    inbound?: NodeInboundConfig | null;
    imapClientFactory?: ImapClientFactory;
    logger?: false;
  } = {},
): Promise<FastifyInstance> {
  const publicUrl = outputBaseUrl(options.publicUrl);
  if (options.smtp && !publicUrl)
    throw new Error('BREW_PUBLIC_URL is required for SMTP links and images.');
  const smtp = options.smtp ? new SmtpMail(options.smtp, options.smtpTls) : undefined;
  const outboundMail = options.outboundMail ?? smtp;
  const app = Fastify({ logger: options.logger ?? process.env.NODE_ENV !== 'test' });
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.split('?')[0] === '/mcp') {
      reply.header('Cache-Control', 'private, no-store');
      reply.header('X-Robots-Tag', 'noindex, nofollow');
    }
    for (const [name, value] of Object.entries(securityHeaders)) {
      if (name === 'Content-Security-Policy' && reply.hasHeader(name)) continue;
      reply.header(name, value);
    }
    return payload;
  });
  app.addContentTypeParser(
    ['text/xml', 'application/xml', 'text/x-opml'],
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );
  const database = options.database ?? openDatabase();
  const broker = new SseBroker();
  const brewService = new BrewService(database, options.clock, {
    mail: outboundMail,
    fetcher: options.fetcher ?? globalThis.fetch,
    baseUrl: publicUrl,
  });
  const rules = new RulesService(database, options.fetcher, (article) =>
    broker.publish('notification', article),
  );
  const ingest = new IngestPipeline(database, rules);
  const newsletters = new NewsletterService(database, options.clock, rules);
  const notifyLetter = (result: NewsletterIngestResult) => {
    broker.publish('article:new', { count: 1, feeds: [{ feedId: result.feedId, count: 1 }] });
  };
  const inbound = options.inbound;
  activateInboundAddress(database, inbound);
  const inboundEmail =
    inbound && inbound.kind !== 'imap'
      ? new InboundWebhook(database, inbound, newsletters, notifyLetter, options.clock)
      : undefined;
  const imap =
    inbound?.kind === 'imap'
      ? new ImapPoller(
          database,
          inbound.imap,
          (raw) => newsletters.ingest(raw),
          notifyLetter,
          options.imapClientFactory,
          (result) => {
            if (result.error || result.rejected)
              app.log.warn({ inbound: 'imap', ...result }, 'Inbound mailbox poll needs attention.');
          },
        )
      : null;
  const poller = new PollerService(
    database,
    options.fetcher,
    (feed, incoming) => ingest.ingest(feed, incoming),
    undefined,
    (results) => {
      const changed = results.filter((result) => result.newItems > 0);
      if (changed.length)
        broker.publish('article:new', {
          count: changed.reduce((sum, result) => sum + result.newItems, 0),
          feeds: changed.map(({ feedId, newItems }) => ({ feedId, count: newItems })),
        });
    },
  );
  const services = nodeApiServices(database, poller, broker, options.fetcher, {
    ...options,
    publicUrl,
    outboundMail,
    inboundEmail,
    inboundMail: inbound ? (inbound.kind === 'imap' ? 'imap' : 'webhook') : null,
  });
  const actionTimer = setInterval(() => services.actions?.cleanup(), 5_000);
  app.decorate('brewServices', services);
  const mcp = createBrewMcpHandler(services, { write: true });
  actionTimer.unref();
  const api = createApi(services, {
    mcp,
    notFound: options.serveWeb
      ? undefined
      : (c) =>
          json(
            c,
            {
              message: `Route ${c.req.method}:${new URL(c.req.url).pathname}${new URL(c.req.url).search} not found`,
              error: 'Not Found',
              statusCode: 404,
            },
            404,
          ),
  });
  mountApi(app, api);
  const brewRuns = new Set<Promise<number>>();
  const brewTimer = options.startPoller
    ? setInterval(() => {
        newsletters.prune();
        brewService.runScheduled();
        const pending = brewService.runCompositionScheduled();
        brewRuns.add(pending);
        void pending.catch((error) => app.log.error(error)).finally(() => brewRuns.delete(pending));
      }, 60_000)
    : null;
  if (options.startPoller) {
    newsletters.prune();
    poller.start();
    imap?.start();
  }
  // Stop live streams before Fastify waits for sockets to drain.
  app.addHook('preClose', async () => {
    clearInterval(actionTimer);
    if (brewTimer) clearInterval(brewTimer);
    broker.close();
    await mcp.close();
  });
  app.addHook('onClose', async () => {
    poller.stop();
    await imap?.stop();
    if (brewTimer) clearInterval(brewTimer);
    await Promise.allSettled(brewRuns);
    await services.actions?.drain();
    services.actions?.cleanup();
    smtp?.close();
    database.close();
  });

  if (options.serveWeb) {
    await app.register(fastifyStatic, { root: webDirectory, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
