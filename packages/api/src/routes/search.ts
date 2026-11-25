import type { Hono } from 'hono';
import type { SearchScope } from '../../../core/src/ports.js';
import type { ApiServices } from '../ports.js';
import { errorMessage, json } from '../http.js';

export function registerSearchRoutes(app: Hono, { search: service }: ApiServices): void {
  app.get('/api/search', async (c) => {
    const query = c.req.query();
    const scope = query.scope ?? 'all';
    if (!['all', 'folder', 'starred'].includes(scope))
      return json(c, { error: 'Invalid search scope' }, 400);
    try {
      const result = await service.search(query.q ?? '', scope as SearchScope, {
        folderId: query.folderId ? Number(query.folderId) : undefined,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
      c.header('Server-Timing', `search;dur=${result.durationMs.toFixed(2)}`);
      return json(c, result);
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Invalid search') }, 400);
    }
  });
}
