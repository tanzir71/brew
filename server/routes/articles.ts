import type { FastifyInstance } from 'fastify';
import type { BrewDatabase } from '../db/database.js';
import { ArticleService } from '../services/article-service.js';

export function registerArticleRoutes(app: FastifyInstance, database: BrewDatabase, fetcher?: typeof fetch): void {
  const service = new ArticleService(database, fetcher);
  app.get<{ Params: { id: string } }>('/api/articles/:id', async (request, reply) => service.get(Number(request.params.id)) ?? reply.code(404).send({ error: 'Article not found' }));
  app.post<{ Params: { id: string } }>('/api/articles/:id/full-text', async (request, reply) => {
    try { return await service.extractFullText(Number(request.params.id)) ?? reply.code(404).send({ error: 'Article not found' }); }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : 'Could not extract full text' }); }
  });
}
