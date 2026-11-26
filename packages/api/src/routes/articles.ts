import { documented, response, errors, jsonBody, query, pathId } from '../openapi.js';
import {
  str,
  bool,
  int,
  id,
  count,
  date,
  array,
  object,
  ref,
  values,
  pageNumber as pageSchema,
} from '../openapi-schemas.js';
import type { Hono } from 'hono';
import type { ApiServices, MarkAllScope } from '../ports.js';
import { body, errorMessage, json } from '../http.js';
import { pageNumber, PageInputError } from '../../../core/src/app-pages.js';
import { parseTagChanges } from '../../../core/src/tag-changes.js';

export function registerArticleRoutes(app: Hono, { articles: service, data }: ApiServices): void {
  app.get(
    '/api/articles-hidden',
    documented('Articles', 'List hidden articles', {
      description:
        'Legacy array is capped at 500. includeTotal=true returns complete totals with 50-row pages.',
      parameters: [query('includeTotal', bool), query('page', pageSchema)],
      responses: {
        200: response({ anyOf: [array(ref('HiddenArticle')), ref('HiddenArticlePage')] }),
        ...errors(400),
      },
    }),
    async (c) => {
      if (c.req.query('includeTotal') !== 'true') return json(c, await data.hiddenArticles());
      c.header('Cache-Control', 'private, no-store');
      try {
        return json(c, await data.hiddenArticlePage(pageNumber(c.req.query('page') ?? null)));
      } catch (error) {
        return error instanceof PageInputError
          ? json(c, { error: error.message }, 400)
          : json(c, { error: 'Could not load hidden articles.' }, 500);
      }
    },
  );
  app.post(
    '/api/articles/:id/unhide',
    documented('Articles', 'Restore a hidden article', {
      parameters: [pathId],
      responses: { 200: response(ref('Ok')), ...errors(404) },
    }),
    async (c) =>
      (await data.unhideArticle(Number(c.req.param('id'))))
        ? json(c, { ok: true })
        : json(c, { error: 'Article not found' }, 404),
  );
  app.post(
    '/api/articles/mark-all-read',
    documented('Articles', 'Mark a Reader scope read using legacy short-lived Undo', {
      description:
        'Prefer /api/actions/mark-read/preview followed by a confirmed /api/actions request for durable, revision-checked Undo.',
      requestBody: jsonBody(
        object({ view: values('all', 'today', 'starred'), feedId: id, folderId: id }, []),
      ),
      responses: {
        200: response(object({ updated: count, undoToken: str, expiresAt: date })),
        ...errors(400),
      },
    }),
    async (c) => {
      const input = await body(c);
      const view = input?.view ?? 'all';
      if (!['all', 'today', 'starred'].includes(String(view)))
        return json(c, { error: 'Invalid article view' }, 400);
      const scope: MarkAllScope = { view: view as MarkAllScope['view'] };
      if (typeof input?.feedId === 'number') scope.feedId = input.feedId;
      if (typeof input?.folderId === 'number') scope.folderId = input.folderId;
      return json(c, await service.markAllRead(scope));
    },
  );
  app.post(
    '/api/articles/mark-all-read/undo',
    documented('Articles', 'Undo a legacy read batch', {
      requestBody: jsonBody(object({ undoToken: str })),
      responses: { 200: response(object({ restored: count })), ...errors(400, 410) },
    }),
    async (c) => {
      const input = await body(c);
      if (typeof input?.undoToken !== 'string')
        return json(c, { error: 'undoToken is required' }, 400);
      const restored = await service.undoMarkAll(input.undoToken);
      return restored === null
        ? json(c, { error: 'Undo window has expired' }, 410)
        : json(c, { restored });
    },
  );
  app.get(
    '/api/articles/:id',
    documented('Articles', 'Get an article with tags and content', {
      parameters: [pathId],
      responses: { 200: response(ref('Article')), ...errors(404) },
    }),
    async (c) => {
      const article = await service.get(Number(c.req.param('id')));
      return article ? json(c, article) : json(c, { error: 'Article not found' }, 404);
    },
  );
  app.post(
    '/api/articles/:id/full-text',
    documented('Articles', 'Extract and save article full text', {
      parameters: [pathId],
      responses: { 200: response(ref('Article')), ...errors(404, 422) },
    }),
    async (c) => {
      try {
        const article = await service.extractFullText(Number(c.req.param('id')));
        return article ? json(c, article) : json(c, { error: 'Article not found' }, 404);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Could not extract full text') }, 422);
      }
    },
  );
  app.patch(
    '/api/articles/:id',
    documented('Articles', 'Set read or starred state', {
      parameters: [pathId],
      requestBody: jsonBody({
        ...object({ read: bool, starred: bool }, []),
        anyOf: [{ required: ['read'] }, { required: ['starred'] }],
      }),
      responses: { 200: response(ref('Article')), ...errors(400, 404) },
    }),
    async (c) => {
      const input = await body(c);
      const read = typeof input?.read === 'boolean' ? input.read : undefined;
      const starred = typeof input?.starred === 'boolean' ? input.starred : undefined;
      if (read === undefined && starred === undefined)
        return json(c, { error: 'A read or starred state is required' }, 400);
      const article = await service.updateState(Number(c.req.param('id')), { read, starred });
      return article ? json(c, article) : json(c, { error: 'Article not found' }, 404);
    },
  );
  app.get(
    '/api/tags',
    documented('Articles', 'List tags', { responses: { 200: response(array(ref('Tag'))) } }),
    async (c) => json(c, await service.listTags()),
  );
  app.post(
    '/api/tags',
    documented('Articles', 'Create a tag', {
      requestBody: jsonBody(object({ name: str, color: str }, ['name'])),
      responses: { 201: response(ref('Tag'), 'Tag created'), ...errors(400) },
    }),
    async (c) => {
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
    },
  );
  app.put(
    '/api/articles/:id/tags',
    documented('Articles', 'Replace all article tags', {
      parameters: [pathId],
      requestBody: jsonBody(object({ tagIds: array(int) })),
      responses: { 200: response(ref('Article')), ...errors(400, 404) },
    }),
    async (c) => {
      try {
        const input = await body(c);
        if (!Array.isArray(input?.tagIds) || !input.tagIds.every((id) => Number.isInteger(id)))
          throw new Error('tagIds must be an array of integers');
        const article = await service.setTags(Number(c.req.param('id')), input.tagIds as number[]);
        return article ? json(c, article) : json(c, { error: 'Article not found' }, 404);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Could not update tags') }, 400);
      }
    },
  );
  app.patch(
    '/api/articles/:id/tags',
    documented('Articles', 'Add or remove article tags', {
      parameters: [pathId],
      requestBody: jsonBody({
        ...object(
          {
            add: { type: 'array', items: id, maxItems: 500 },
            remove: { type: 'array', items: id, maxItems: 500 },
          },
          [],
        ),
        additionalProperties: false,
        minProperties: 1,
      }),
      responses: { 200: response(ref('Article')), ...errors(400, 404) },
    }),
    async (c) => {
      c.header('Cache-Control', 'private, no-store');
      c.header('X-Robots-Tag', 'noindex');
      c.header('X-Content-Type-Options', 'nosniff');
      try {
        const changes = parseTagChanges(await body(c));
        const id = Number(c.req.param('id'));
        if (!Number.isSafeInteger(id) || id < 1) throw new Error('Choose a valid article.');
        const article = await service.changeTags(id, changes);
        return article ? json(c, article) : json(c, { error: 'Article not found' }, 404);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Could not update tags') }, 400);
      }
    },
  );
}
