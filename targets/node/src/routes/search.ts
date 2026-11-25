import type { FastifyInstance } from 'fastify';
import type { BrewDatabase } from '../db/database.js';
import { SearchService, type SearchScope } from '../services/search-service.js';

export function registerSearchRoutes(app: FastifyInstance, database: BrewDatabase): void {
  const service = new SearchService(database);
  app.get<{
    Querystring: { q?: string; scope?: string; folderId?: string; limit?: string; offset?: string };
  }>('/api/search', async (request, reply) => {
    const scope = request.query.scope ?? 'all';
    if (!['all', 'folder', 'starred'].includes(scope))
      return reply.code(400).send({ error: 'Invalid search scope' });
    try {
      const result = service.search(request.query.q ?? '', scope as SearchScope, {
        folderId: request.query.folderId ? Number(request.query.folderId) : undefined,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
        offset: request.query.offset ? Number(request.query.offset) : undefined,
      });
      reply.header('Server-Timing', `search;dur=${result.durationMs.toFixed(2)}`);
      return result;
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'Invalid search' });
    }
  });
}
