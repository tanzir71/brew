import { documented, response, errors, jsonBody, pathId } from '../openapi.js';
import { str, int, id, nullable, array, object, ref } from '../openapi-schemas.js';
import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { body, errorMessage, json, requiredText } from '../http.js';

export function registerFeedRoutes(app: Hono, { feeds: service, fetcher }: ApiServices): void {
  app.get(
    '/api/feeds',
    documented('Feeds', 'List subscriptions', { responses: { 200: response(array(ref('Feed'))) } }),
    async (c) => json(c, await service.listFeeds()),
  );
  app.get(
    '/api/folders',
    documented('Feeds', 'List folders', { responses: { 200: response(array(ref('Folder'))) } }),
    async (c) => json(c, await service.listFolders()),
  );
  app.post(
    '/api/feeds/discover',
    documented('Feeds', 'Discover feeds at a URL', {
      requestBody: jsonBody(object({ url: str })),
      responses: {
        200: response(object({ candidates: array(ref('FeedCandidate')) })),
        ...errors(400),
      },
    }),
    async (c) => {
      try {
        const input = await body(c);
        return json(c, { candidates: await service.discover(requiredText(input?.url, 'url')) });
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Discovery failed') }, 400);
      }
    },
  );
  app.post(
    '/api/feeds',
    documented('Feeds', 'Subscribe to a feed', {
      requestBody: jsonBody(object({ url: str, folderId: nullable(id) }, ['url'])),
      responses: { 201: response(ref('Feed'), 'Subscription created'), ...errors(400, 409) },
    }),
    async (c) => {
      try {
        const input = await body(c);
        return json(
          c,
          await service.add(
            requiredText(input?.url, 'url'),
            typeof input?.folderId === 'number' ? input.folderId : null,
          ),
          201,
        );
      } catch (error) {
        const message = errorMessage(error, 'Could not add feed');
        return json(
          c,
          { error: message.includes('UNIQUE constraint') ? 'Feed already exists' : message },
          message.includes('UNIQUE constraint') ? 409 : 400,
        );
      }
    },
  );
  app.patch(
    '/api/feeds/:id',
    documented('Feeds', 'Rename or move a subscription', {
      parameters: [pathId],
      requestBody: jsonBody(object({ title: str, folderId: nullable(id) }, ['title'])),
      responses: { 200: response(ref('Feed')), ...errors(400, 404) },
    }),
    async (c) => {
      try {
        const input = await body(c);
        const row = await service.renameFeed(
          Number(c.req.param('id')),
          requiredText(input?.title, 'title'),
          input.folderId === null || typeof input.folderId === 'number'
            ? input.folderId
            : undefined,
        );
        return row ? json(c, row) : json(c, { error: 'Feed not found' }, 404);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Invalid feed') }, 400);
      }
    },
  );
  app.delete(
    '/api/feeds/:id',
    documented('Feeds', 'Delete a feed without a durable receipt', {
      parameters: [pathId],
      description:
        'Legacy deletion. Prefer confirmed POST /api/actions with kind delete_feed for recoverable Undo.',
      responses: { 204: { description: 'Feed deleted; no response body' }, ...errors(404) },
    }),
    async (c) =>
      (await service.deleteFeed(Number(c.req.param('id'))))
        ? c.body(null, 204)
        : json(c, { error: 'Feed not found' }, 404),
  );
  app.patch(
    '/api/feeds/:id/retention',
    documented('Feeds', 'Set feed retention', {
      parameters: [pathId],
      requestBody: jsonBody(object({ days: int })),
      responses: { 200: response(ref('Feed')), ...errors(400, 404) },
    }),
    async (c) => {
      try {
        const input = await body(c);
        const row = await service.setRetention(Number(c.req.param('id')), Number(input.days));
        return row ? json(c, row) : json(c, { error: 'Feed not found' }, 404);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Invalid retention') }, 400);
      }
    },
  );
  app.get(
    '/api/feeds/:id/icon',
    documented('Feeds', 'Fetch a feed favicon', {
      parameters: [pathId],
      responses: {
        200: response(str, 'Image bytes', 'image/*'),
        404: { description: 'Feed or favicon unavailable; no response body' },
      },
    }),
    async (c) => {
      const feed = (await service.listFeeds()).find(
        (item) => item.id === Number(c.req.param('id')),
      );
      if (!feed) return c.body(null, 404);
      try {
        const origin = new URL(feed.siteUrl ?? feed.url).origin;
        const response = await fetcher(`${origin}/favicon.ico`, {
          signal: AbortSignal.timeout(5_000),
        });
        const type = response.headers.get('content-type') ?? 'image/x-icon';
        if (!response.ok || !type.startsWith('image/')) throw new Error();
        return c.body(await response.arrayBuffer(), 200, {
          'Content-Type': type,
          'Cache-Control': 'private, max-age=86400',
        });
      } catch {
        return c.body(null, 404);
      }
    },
  );
  app.post(
    '/api/folders',
    documented('Feeds', 'Create a folder', {
      requestBody: jsonBody(object({ title: str })),
      responses: { 201: response(ref('Folder'), 'Folder created'), ...errors(400) },
    }),
    async (c) => {
      try {
        const input = await body(c);
        return json(c, await service.createFolder(requiredText(input?.title, 'title')), 201);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Invalid folder') }, 400);
      }
    },
  );
  app.patch(
    '/api/folders/:id',
    documented('Feeds', 'Rename a folder', {
      parameters: [pathId],
      requestBody: jsonBody(object({ title: str })),
      responses: { 200: response(ref('Folder')), ...errors(400, 404) },
    }),
    async (c) => {
      try {
        const input = await body(c);
        const row = await service.renameFolder(
          Number(c.req.param('id')),
          requiredText(input?.title, 'title'),
        );
        return row ? json(c, row) : json(c, { error: 'Folder not found' }, 404);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Invalid folder') }, 400);
      }
    },
  );
  app.delete(
    '/api/folders/:id',
    documented('Feeds', 'Delete a folder without a durable receipt', {
      parameters: [pathId],
      description:
        'Legacy deletion. Prefer confirmed POST /api/actions with kind delete_folder for recoverable Undo.',
      responses: { 204: { description: 'Folder deleted; no response body' }, ...errors(404) },
    }),
    async (c) =>
      (await service.deleteFolder(Number(c.req.param('id'))))
        ? c.body(null, 204)
        : json(c, { error: 'Folder not found' }, 404),
  );
}
