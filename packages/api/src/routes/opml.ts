import { documented, response, errors } from '../openapi.js';
import { str, ref } from '../openapi-schemas.js';
import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { body, errorMessage, isJsonContentType, json } from '../http.js';
import { opmlDocument } from '../../../core/src/opml.js';

export function registerOpmlRoutes(app: Hono, { opml: service }: ApiServices): void {
  app.post(
    '/api/opml/preview',
    documented('Subscriptions', 'Review OPML without importing', {
      description:
        'Accepts raw XML or a JSON string, up to 1 MB of XML. Does not fetch subscriptions or write.',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: str },
          'text/xml': { schema: str },
          'application/xml': { schema: str },
          'text/x-opml': { schema: str },
        },
      },
      responses: { 200: response(ref('OpmlPreview')), ...errors(400) },
    }),
    async (c) => {
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
    },
  );
  app.post(
    '/api/opml/import',
    documented('Subscriptions', 'Import OPML without a durable receipt', {
      description:
        'Legacy import. Prefer preview followed by confirmed /api/actions kind import_opml for durable Undo.',
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: str },
          'text/xml': { schema: str },
          'application/xml': { schema: str },
          'text/x-opml': { schema: str },
        },
      },
      responses: { 200: response(ref('OpmlResult')), ...errors(400) },
    }),
    async (c) => {
      try {
        const input = isJsonContentType(c.req.header('content-type'))
          ? await body<unknown>(c)
          : await c.req.text();
        if (typeof input !== 'string' || !input.trim())
          throw new Error('OPML document is required');
        return json(c, await service.import(input));
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Could not import OPML') }, 400);
      }
    },
  );
  app.get(
    '/api/opml/export',
    documented('Subscriptions', 'Download private subscriptions as OPML', {
      responses: { 200: response(str, 'OPML attachment', 'text/x-opml') },
    }),
    async (c) =>
      c.body(await service.export(), 200, {
        'Content-Type': 'text/x-opml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="brew-subscriptions.opml"',
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      }),
  );
}
