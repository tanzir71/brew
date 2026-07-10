import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HealthResponse } from '../shared/api.js';
import { openDatabase, type BrewDatabase } from './db/database.js';
import { registerFeedRoutes } from './routes/feeds.js';
import { registerPollerRoutes } from './routes/poller.js';
import { registerOpmlRoutes } from './routes/opml.js';
import { registerReaderRoutes } from './routes/reader.js';
import { registerArticleRoutes } from './routes/articles.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerRulesRoutes } from './routes/rules.js';
import { registerBrewRoutes } from './routes/brews.js';
import { PollerService } from './services/poller-service.js';
import { IngestPipeline } from './services/ingest-pipeline.js';
import { SseBroker } from './services/sse-broker.js';
import { RulesService } from './services/rules-service.js';
import { BrewService } from './services/brew-service.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function createApp(options: { serveWeb?: boolean; database?: BrewDatabase; fetcher?: typeof fetch; startPoller?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.addContentTypeParser(['text/xml', 'application/xml', 'text/x-opml'], { parseAs: 'string' }, (_request, body, done) => done(null, body));
  const database = options.database ?? openDatabase();
  const broker = new SseBroker();
  app.addHook('onClose', () => database.close());
  registerFeedRoutes(app, database, options.fetcher);
  registerOpmlRoutes(app, database);
  registerReaderRoutes(app, database);
  registerArticleRoutes(app, database, options.fetcher);
  registerSearchRoutes(app, database);
  registerRulesRoutes(app, database, options.fetcher);
  registerBrewRoutes(app, database);
  const brewService = new BrewService(database);
  const brewTimer = options.startPoller ? setInterval(() => brewService.runScheduled(), 60_000) : null;
  const rules = new RulesService(database, options.fetcher, (article) => broker.publish('notification', article));
  const ingest = new IngestPipeline(database, rules);
  const poller = new PollerService(database, options.fetcher, (feed, incoming) => ingest.ingest(feed, incoming), undefined, (results) => {
    const changed = results.filter((result) => result.newItems > 0);
    if (changed.length) broker.publish('article:new', { count: changed.reduce((sum, result) => sum + result.newItems, 0), feeds: changed.map(({ feedId, newItems }) => ({ feedId, count: newItems })) });
  });
  registerPollerRoutes(app, poller);
  if (options.startPoller) poller.start();
  app.addHook('onClose', () => { poller.stop(); if (brewTimer) clearInterval(brewTimer); });

  app.get('/api/health', async (): Promise<HealthResponse> => ({ ok: true }));

  app.get('/api/events', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    reply.raw.write('event: heartbeat\ndata: {}\n\n');
    const remove = broker.add(reply.raw);
    const heartbeat = setInterval(() => reply.raw.write('event: heartbeat\ndata: {}\n\n'), 15_000);
    request.raw.on('close', () => { clearInterval(heartbeat); remove(); });
  });

  if (options.serveWeb) {
    await app.register(fastifyStatic, { root: path.join(rootDirectory, 'web', 'dist'), wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
