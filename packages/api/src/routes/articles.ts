import type { Hono } from 'hono';
import type { ApiServices, MarkAllScope } from '../ports.js';
import { body, errorMessage, json } from '../http.js';
import { pageNumber, PageInputError } from '../../../core/src/app-pages.js';

export function registerArticleRoutes(app: Hono, { articles: service, data }: ApiServices): void {
  app.get('/api/articles-hidden', async (c) => {
    if (c.req.query('includeTotal') !== 'true') return json(c, await data.hiddenArticles());
    c.header('Cache-Control', 'private, no-store');
    try {
      return json(c, await data.hiddenArticlePage(pageNumber(c.req.query('page') ?? null)));
    } catch (error) {
      return error instanceof PageInputError
        ? json(c, { error: error.message }, 400)
        : json(c, { error: 'Could not load hidden articles.' }, 500);
    }
  });
  app.post('/api/articles/:id/unhide', async (c) =>
    (await data.unhideArticle(Number(c.req.param('id'))))
      ? json(c, { ok: true })
      : json(c, { error: 'Article not found' }, 404),
  );
  app.post('/api/articles/mark-all-read', async (c) => {
    const input = await body(c);
    const view = input?.view ?? 'all';
    if (!['all', 'today', 'starred'].includes(String(view)))
      return json(c, { error: 'Invalid article view' }, 400);
    const scope: MarkAllScope = { view: view as MarkAllScope['view'] };
    if (typeof input?.feedId === 'number') scope.feedId = input.feedId;
    if (typeof input?.folderId === 'number') scope.folderId = input.folderId;
    return json(c, await service.markAllRead(scope));
  });
  app.post('/api/articles/mark-all-read/undo', async (c) => {
    const input = await body(c);
    if (typeof input?.undoToken !== 'string')
      return json(c, { error: 'undoToken is required' }, 400);
    const restored = await service.undoMarkAll(input.undoToken);
    return restored === null
      ? json(c, { error: 'Undo window has expired' }, 410)
      : json(c, { restored });
  });
  app.get('/api/articles/:id', async (c) => {
    const article = await service.get(Number(c.req.param('id')));
    return article ? json(c, article) : json(c, { error: 'Article not found' }, 404);
  });
  app.post('/api/articles/:id/full-text', async (c) => {
    try {
      const article = await service.extractFullText(Number(c.req.param('id')));
      return article ? json(c, article) : json(c, { error: 'Article not found' }, 404);
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Could not extract full text') }, 422);
    }
  });
  app.patch('/api/articles/:id', async (c) => {
    const input = await body(c);
    const read = typeof input?.read === 'boolean' ? input.read : undefined;
    const starred = typeof input?.starred === 'boolean' ? input.starred : undefined;
    if (read === undefined && starred === undefined)
      return json(c, { error: 'A read or starred state is required' }, 400);
    const article = await service.updateState(Number(c.req.param('id')), { read, starred });
    return article ? json(c, article) : json(c, { error: 'Article not found' }, 404);
  });
  app.get('/api/tags', async (c) => json(c, await service.listTags()));
  app.post('/api/tags', async (c) => {
    try {
      const input = await body(c);
      if (typeof input?.name !== 'string') throw new Error('Tag name is required');
      return json(
        c,
        await service.createTag(
          input.name,
          typeof input.color === 'string' ? input.color : undefined,
        ),
        201,
      );
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Could not create tag') }, 400);
    }
  });
  app.put('/api/articles/:id/tags', async (c) => {
    try {
      const input = await body(c);
      if (!Array.isArray(input?.tagIds) || !input.tagIds.every((id) => Number.isInteger(id)))
        throw new Error('tagIds must be an array of integers');
      const article = await service.setTags(Number(c.req.param('id')), input.tagIds as number[]);
      return article ? json(c, article) : json(c, { error: 'Article not found' }, 404);
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Could not update tags') }, 400);
    }
  });
}
