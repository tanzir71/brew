import type { FastifyInstance } from 'fastify';
import type { RuleDraft } from '@brew/core/types/rules.js';
import type { BrewDatabase } from '../db/database.js';
import { RulesService } from '../services/rules-service.js';

export function registerRulesRoutes(
  app: FastifyInstance,
  database: BrewDatabase,
  fetcher?: typeof fetch,
  notify?: (article:{id:number;title:string;url:string})=>void,
): void {
  const service = new RulesService(database, fetcher, notify);
  app.get('/api/rules/duplicate-filter', async () => ({
    enabled: (database.sqlite.prepare("SELECT value FROM settings WHERE key = 'duplicate_filter_enabled'").get() as {value:string} | undefined)?.value === 'true',
  }));
  app.put<{ Body: { enabled: boolean } }>('/api/rules/duplicate-filter', async (request) => {
    database.sqlite.prepare("INSERT INTO settings(key, value) VALUES('duplicate_filter_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(Boolean(request.body.enabled)));
    return { enabled: Boolean(request.body.enabled) };
  });
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
  app.get<{ Params: { id: string } }>('/api/rules/:id/logs', async (request) =>
    service.logs(Number(request.params.id)),
  );
  app.post<{ Params: { id: string }; Body: { days?: number } }>('/api/rules/:id/apply', async (request, reply) => {
    try {
      return { matched: await service.applyToExisting(Number(request.params.id), request.body.days ?? 30) };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : 'Rule not found' });
    }
  });
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
