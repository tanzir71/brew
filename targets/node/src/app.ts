import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import type { HealthResponse } from '@brew/core/types/api.js';
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

const webDirectory = fileURLToPath(new URL('../../../packages/web/dist/', import.meta.url));

export async function createApp(options: { serveWeb?: boolean; database?: BrewDatabase; fetcher?: typeof fetch; startPoller?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; media-src 'self' https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });
  app.addContentTypeParser(['text/xml', 'application/xml', 'text/x-opml'], { parseAs: 'string' }, (_request, body, done) => done(null, body));
  const database = options.database ?? openDatabase();
  const broker = new SseBroker();
  app.addHook('onClose', () => database.close());
  registerFeedRoutes(app, database, options.fetcher);
  registerOpmlRoutes(app, database);
  registerReaderRoutes(app, database);
  registerArticleRoutes(app, database, options.fetcher);
  registerSearchRoutes(app, database);
  registerRulesRoutes(app, database, options.fetcher,(article)=>broker.publish('notification',article));
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

  app.get<{ Querystring: { src?: string } }>('/api/img', async (request, reply) => {
    try {
      if (!request.query.src) throw new Error('src is required');
      const source = new URL(request.query.src);
      if (!['http:', 'https:'].includes(source.protocol)) throw new Error('Unsupported image URL');
      const response = await (options.fetcher ?? fetch)(source, { signal: AbortSignal.timeout(8_000), redirect: 'follow' });
      const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
      if (!response.ok || !type.startsWith('image/')) throw new Error('Image could not be loaded');
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 10 * 1024 * 1024) throw new Error('Image is too large');
      return reply.header('Content-Type', type).header('Cache-Control', 'private, max-age=86400').send(data);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid image URL' });
    }
  });
  app.get<{Querystring:{src?:string}}>('/api/media',async(request,reply)=>{try{if(!request.query.src)throw new Error('src is required');const source=new URL(request.query.src);if(!['http:','https:'].includes(source.protocol))throw new Error('Unsupported media URL');const response=await(options.fetcher??fetch)(source,{signal:AbortSignal.timeout(10000)});const type=response.headers.get('content-type')?.split(';')[0]??'';if(!response.ok||!type.startsWith('audio/'))throw new Error('Audio could not be loaded');return reply.header('Content-Type',type).header('Cache-Control','private, max-age=86400').send(Buffer.from(await response.arrayBuffer()))}catch(error){return reply.code(400).send({error:error instanceof Error?error.message:'Invalid media URL'})}});

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
    await app.register(fastifyStatic, { root: webDirectory, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
