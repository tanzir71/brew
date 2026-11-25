import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { json } from '../http.js';

export function registerPollerRoutes(app: Hono, { poller }: ApiServices): void {
  app.post('/api/feeds/:id/fetch', async (c) => {
    const result = await poller.pollFeedById(Number(c.req.param('id')));
    return result ? json(c, result) : json(c, { error: 'Feed not found' }, 404);
  });
}
