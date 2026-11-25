import type { Hono } from 'hono';
import type { ApiServices, ReaderView } from '../ports.js';
import { errorMessage, json } from '../http.js';

export function registerReaderRoutes(app: Hono, { reader: service }: ApiServices): void {
  app.get('/api/reader/navigation', async (c) => json(c, await service.navigation()));
  app.get('/api/articles', async (c) => {
    const query = c.req.query();
    const view = query.view ?? 'all';
    if (!['all', 'today', 'starred'].includes(view))
      return json(c, { error: 'Invalid article view' }, 400);
    if (query.sort && !['newest', 'oldest'].includes(query.sort))
      return json(c, { error: 'Invalid sort order' }, 400);
    try {
      return json(
        c,
        await service.articles({
          view: view as ReaderView,
          feedId: query.feedId ? Number(query.feedId) : undefined,
          folderId: query.folderId ? Number(query.folderId) : undefined,
          limit: query.limit ? Number(query.limit) : undefined,
          unread: query.unread === 'true',
          sort: query.sort as 'newest' | 'oldest' | undefined,
          cursor: query.cursor,
        }),
      );
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Invalid article query') }, 400);
    }
  });
}
