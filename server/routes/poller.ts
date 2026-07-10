import type { FastifyInstance } from 'fastify';
import type { PollerService } from '../services/poller-service.js';

export function registerPollerRoutes(app: FastifyInstance, poller: PollerService): void {
  app.post<{ Params: { id: string } }>('/api/feeds/:id/fetch', async (request, reply) => {
    const result = await poller.pollFeedById(Number(request.params.id));
    return result ?? reply.code(404).send({ error: 'Feed not found' });
  });
}
