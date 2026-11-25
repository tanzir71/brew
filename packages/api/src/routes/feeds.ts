import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { body, errorMessage, json, requiredText } from '../http.js';

export function registerFeedRoutes(app: Hono, { feeds: service, fetcher }: ApiServices): void {
  app.get('/api/feeds', async (c) => json(c, await service.listFeeds()));
  app.get('/api/folders', async (c) => json(c, await service.listFolders()));
  app.post('/api/feeds/discover', async (c) => {
    try {
      const input = await body(c);
      return json(c, { candidates: await service.discover(requiredText(input?.url, 'url')) });
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Discovery failed') }, 400);
    }
  });
  app.post('/api/feeds', async (c) => {
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
  });
  app.patch('/api/feeds/:id', async (c) => {
    try {
      const input = await body(c);
      const row = await service.renameFeed(
        Number(c.req.param('id')),
        requiredText(input?.title, 'title'),
        input.folderId === null || typeof input.folderId === 'number' ? input.folderId : undefined,
      );
      return row ? json(c, row) : json(c, { error: 'Feed not found' }, 404);
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Invalid feed') }, 400);
    }
  });
  app.delete('/api/feeds/:id', async (c) =>
    (await service.deleteFeed(Number(c.req.param('id'))))
      ? c.body(null, 204)
      : json(c, { error: 'Feed not found' }, 404),
  );
  app.patch('/api/feeds/:id/retention', async (c) => {
    try {
      const input = await body(c);
      const row = await service.setRetention(Number(c.req.param('id')), Number(input.days));
      return row ? json(c, row) : json(c, { error: 'Feed not found' }, 404);
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Invalid retention') }, 400);
    }
  });
  app.get('/api/feeds/:id/icon', async (c) => {
    const feed = (await service.listFeeds()).find((item) => item.id === Number(c.req.param('id')));
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
  });
  app.post('/api/folders', async (c) => {
    try {
      const input = await body(c);
      return json(c, await service.createFolder(requiredText(input?.title, 'title')), 201);
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Invalid folder') }, 400);
    }
  });
  app.patch('/api/folders/:id', async (c) => {
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
  });
  app.delete('/api/folders/:id', async (c) =>
    (await service.deleteFolder(Number(c.req.param('id'))))
      ? c.body(null, 204)
      : json(c, { error: 'Folder not found' }, 404),
  );
}
