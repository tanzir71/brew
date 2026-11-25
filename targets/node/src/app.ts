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

const webDirectory = fileURLToPath(new URL('../../../packages/web/dist/', import.meta.url));

export async function createApp(
  options: {
    serveWeb?: boolean;
    database?: BrewDatabase;
    fetcher?: typeof fetch;
    startPoller?: boolean;
  } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(securityHeaders)) reply.header(name, value);
    return payload;
  });
  app.addContentTypeParser(
    ['text/xml', 'application/xml', 'text/x-opml'],
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );
  const database = options.database ?? openDatabase();
  const broker = new SseBroker();
  const brewService = new BrewService(database);
  const rules = new RulesService(database, options.fetcher, (article) =>
    broker.publish('notification', article),
  );
  const ingest = new IngestPipeline(database, rules);
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
  const api = createApi(nodeApiServices(database, poller, broker, options.fetcher), {
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
  const brewTimer = options.startPoller
    ? setInterval(() => brewService.runScheduled(), 60_000)
    : null;
  if (options.startPoller) poller.start();
  // Stop live streams before Fastify waits for sockets to drain.
  app.addHook('preClose', async () => {
    broker.close();
  });
  app.addHook('onClose', () => {
    poller.stop();
    if (brewTimer) clearInterval(brewTimer);
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
