import { documented, response, errors, pathId } from '../openapi.js';
import { str, int, id, count, object, values } from '../openapi-schemas.js';
import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { json } from '../http.js';

export function registerPollerRoutes(app: Hono, { poller }: ApiServices): void {
  app.post(
    '/api/feeds/:id/fetch',
    documented('Feeds', 'Fetch a subscription now', {
      parameters: [pathId],
      responses: {
        200: response(
          object(
            {
              feedId: id,
              status: int,
              newItems: count,
              outcome: values('success', 'not-modified', 'error'),
              error: str,
            },
            ['feedId', 'status', 'newItems', 'outcome'],
          ),
        ),
        ...errors(404),
      },
    }),
    async (c) => {
      const result = await poller.pollFeedById(Number(c.req.param('id')));
      return result ? json(c, result) : json(c, { error: 'Feed not found' }, 404);
    },
  );
}
