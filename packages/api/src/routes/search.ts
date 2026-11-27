import { documented, response, errors, query } from '../openapi.js';
import { str, bool, id, count, ref, values } from '../openapi-schemas.js';
import type { Hono } from 'hono';
import type { SearchScope } from '../../../core/src/ports.js';
import type { ApiServices } from '../ports.js';
import { errorMessage, json } from '../http.js';

export function registerSearchRoutes(
  app: Hono,
  { search: service }: Pick<ApiServices, 'search'>,
): void {
  app.get(
    '/api/search',
    documented('Reader', 'Search articles with FTS5', {
      parameters: [
        query('q', str),
        query('scope', values('all', 'folder', 'starred')),
        query('folderId', id, 'Required for folder scope.'),
        query('limit', { type: 'integer', minimum: 1, maximum: 100 }),
        query('offset', count),
        query('includeTotal', bool),
        query('unread', bool),
        query('sort', values('newest', 'oldest')),
      ],
      responses: { 200: response(ref('SearchPage')), ...errors(400) },
    }),
    async (c) => {
      const query = c.req.query();
      const scope = query.scope ?? 'all';
      if (!['all', 'folder', 'starred'].includes(scope))
        return json(c, { error: 'Invalid search scope' }, 400);
      if (query.sort && !['newest', 'oldest'].includes(query.sort))
        return json(c, { error: 'Invalid sort order' }, 400);
      try {
        const result = await service.search(query.q ?? '', scope as SearchScope, {
          folderId: query.folderId ? Number(query.folderId) : undefined,
          limit: query.limit ? Number(query.limit) : undefined,
          offset: query.offset ? Number(query.offset) : undefined,
          includeTotal: query.includeTotal === 'true',
          unread: query.unread === 'true',
          sort: query.sort as 'newest' | 'oldest' | undefined,
        });
        c.header('Server-Timing', `search;dur=${result.durationMs.toFixed(2)}`);
        return json(c, result);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Invalid search') }, 400);
      }
    },
  );
}
