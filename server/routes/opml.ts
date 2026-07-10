import type { FastifyInstance } from 'fastify';
import type { BrewDatabase } from '../db/database.js';
import { OpmlService } from '../services/opml-service.js';

export function registerOpmlRoutes(app: FastifyInstance, database: BrewDatabase): void {
  const service = new OpmlService(database);
  app.post<{ Body: string }>('/api/opml/import', async (request, reply) => {
    try { if (typeof request.body !== 'string' || !request.body.trim()) throw new Error('OPML document is required'); return service.import(request.body); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Could not import OPML' }); }
  });
  app.get('/api/opml/export', async (_request, reply) => reply.header('Content-Type', 'text/x-opml; charset=utf-8').header('Content-Disposition', 'attachment; filename="brew-subscriptions.opml"').send(service.export()));
}
