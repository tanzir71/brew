import type { FastifyInstance } from 'fastify';
import type { BrewDatabase } from '../db/database.js';
import { ReaderService, type ReaderView } from '../services/reader-service.js';

export function registerReaderRoutes(app: FastifyInstance, database: BrewDatabase): void {
  const service = new ReaderService(database);
  app.get('/api/reader/navigation', async () => service.navigation());
  app.get<{ Querystring: { view?: string; feedId?: string; folderId?: string; limit?: string } }>('/api/articles', async (request, reply) => {
    const view = request.query.view ?? 'all';
    if (!['all', 'today', 'starred'].includes(view)) return reply.code(400).send({ error: 'Invalid article view' });
    return service.articles({ view: view as ReaderView, feedId: request.query.feedId ? Number(request.query.feedId) : undefined, folderId: request.query.folderId ? Number(request.query.folderId) : undefined, limit: request.query.limit ? Number(request.query.limit) : undefined });
  });
}
