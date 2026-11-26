import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { body, errorMessage, isJsonContentType, json } from '../http.js';
import { opmlDocument } from '../../../core/src/opml.js';

export function registerOpmlRoutes(app: Hono, { opml: service }: ApiServices): void {
  app.post('/api/opml/preview', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    try {
      const input = isJsonContentType(c.req.header('content-type'))
        ? await body<unknown>(c)
        : await c.req.text();
      return json(c, await service.preview(opmlDocument(input)));
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Could not read OPML.') }, 400);
    }
  });
  app.post('/api/opml/import', async (c) => {
    try {
      const input = isJsonContentType(c.req.header('content-type'))
        ? await body<unknown>(c)
        : await c.req.text();
      if (typeof input !== 'string' || !input.trim()) throw new Error('OPML document is required');
      return json(c, await service.import(input));
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Could not import OPML') }, 400);
    }
  });
  app.get('/api/opml/export', async (c) =>
    c.body(await service.export(), 200, {
      'Content-Type': 'text/x-opml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="brew-subscriptions.opml"',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    }),
  );
}
