import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HealthResponse } from '../shared/api.js';
import { openDatabase, type BrewDatabase } from './db/database.js';
import { registerFeedRoutes } from './routes/feeds.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function createApp(options: { serveWeb?: boolean; database?: BrewDatabase; fetcher?: typeof fetch } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  const database = options.database ?? openDatabase();
  app.addHook('onClose', () => database.close());
  registerFeedRoutes(app, database, options.fetcher);

  app.get('/api/health', async (): Promise<HealthResponse> => ({ ok: true }));

  app.get('/api/events', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    reply.raw.write('event: heartbeat\ndata: {}\n\n');
    const heartbeat = setInterval(() => reply.raw.write('event: heartbeat\ndata: {}\n\n'), 15_000);
    request.raw.on('close', () => clearInterval(heartbeat));
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
