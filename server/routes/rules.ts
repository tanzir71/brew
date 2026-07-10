import type { FastifyInstance } from 'fastify';
import type { RuleDraft } from '../../shared/rules.js';
import type { BrewDatabase } from '../db/database.js';
import { RulesService } from '../services/rules-service.js';

export function registerRulesRoutes(
  app: FastifyInstance,
  database: BrewDatabase,
  fetcher?: typeof fetch,
): void {
  const service = new RulesService(database, fetcher);
  app.get('/api/rules', async () => service.list());
  app.post<{ Body: RuleDraft }>('/api/rules', async (request, reply) => {
    try {
      return reply.code(201).send(service.create(request.body));
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'Invalid rule' });
    }
  });
  app.put<{ Params: { id: string }; Body: RuleDraft }>('/api/rules/:id', async (request, reply) => {
    try {
      return (
        service.update(Number(request.params.id), request.body) ??
        reply.code(404).send({ error: 'Rule not found' })
      );
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'Invalid rule' });
    }
  });
  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (request, reply) =>
    service.delete(Number(request.params.id))
      ? reply.code(204).send()
      : reply.code(404).send({ error: 'Rule not found' }),
  );
  app.post<{ Body: Pick<RuleDraft, 'scope' | 'matchType' | 'conditions'> }>(
    '/api/rules/preview',
    async (request, reply) => {
      try {
        return { items: await service.preview(request.body) };
      } catch (error) {
        return reply
          .code(400)
          .send({ error: error instanceof Error ? error.message : 'Invalid preview' });
      }
    },
  );
}
