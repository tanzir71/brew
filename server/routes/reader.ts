import type { FastifyInstance } from 'fastify';
import type { BrewDatabase } from '../db/database.js';
import { ReaderService, type ReaderView } from '../services/reader-service.js';

export function registerReaderRoutes(app: FastifyInstance, database: BrewDatabase): void {
  const service = new ReaderService(database);
  app.get('/api/reader/navigation', async () => service.navigation());
  app.get<{ Querystring: { view?: string; feedId?: string; folderId?: string; limit?: string; unread?: string; sort?: string; cursor?: string } }>('/api/articles', async (request, reply) => {
    const view = request.query.view ?? 'all';
    if (!['all', 'today', 'starred'].includes(view)) return reply.code(400).send({ error: 'Invalid article view' });
    if (request.query.sort && !['newest', 'oldest'].includes(request.query.sort)) return reply.code(400).send({ error: 'Invalid sort order' });
    try { return service.articles({ view: view as ReaderView, feedId: request.query.feedId ? Number(request.query.feedId) : undefined, folderId: request.query.folderId ? Number(request.query.folderId) : undefined, limit: request.query.limit ? Number(request.query.limit) : undefined, unread: request.query.unread === 'true', sort: request.query.sort as 'newest' | 'oldest' | undefined, cursor: request.query.cursor }); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid article query' }); }
  });
}
