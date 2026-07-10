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
  app.patch<{ Params: { id: string }; Body: { read?: unknown; starred?: unknown } }>('/api/articles/:id', async (request, reply) => {
    const read = typeof request.body?.read === 'boolean' ? request.body.read : undefined;
    const starred = typeof request.body?.starred === 'boolean' ? request.body.starred : undefined;
    if (read === undefined && starred === undefined) return reply.code(400).send({ error: 'A read or starred state is required' });
    return service.updateState(Number(request.params.id), { read, starred }) ?? reply.code(404).send({ error: 'Article not found' });
  });
  app.get('/api/tags', async () => service.listTags());
  app.post<{ Body: { name?: unknown; color?: unknown } }>('/api/tags', async (request, reply) => {
    try { if (typeof request.body?.name !== 'string') throw new Error('Tag name is required'); return reply.code(201).send(service.createTag(request.body.name, typeof request.body.color === 'string' ? request.body.color : undefined)); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not create tag' }); }
  });
  app.put<{ Params: { id: string }; Body: { tagIds?: unknown } }>('/api/articles/:id/tags', async (request, reply) => {
    try { if (!Array.isArray(request.body?.tagIds) || !request.body.tagIds.every((id) => Number.isInteger(id))) throw new Error('tagIds must be an array of integers'); return service.setTags(Number(request.params.id), request.body.tagIds as number[]) ?? reply.code(404).send({ error: 'Article not found' }); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not update tags' }); }
  });
}
