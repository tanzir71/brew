import { documented, response, errors, jsonBody, query, pathId } from './openapi.js';
import { str, id, ref, values, pageNumber } from './openapi-schemas.js';
import type { Hono } from 'hono';
import type { ApiServices } from './ports.js';
import type { NewsletterView } from '../../core/src/types/newsletters.js';
import {
  originalNewsletterDocument,
  originalNewsletterContentPolicy,
} from '../../core/src/newsletter-original.js';
import { body, json } from './http.js';

export const originalNewsletterPolicy = `sandbox; ${originalNewsletterContentPolicy}; frame-ancestors 'self'`;
export function registerNewsletterRoutes(app: Hono, services: Pick<ApiServices, 'newsletters'>) {
  app.use('/api/newsletters/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get(
    '/api/newsletters/overview',
    documented('Newsletters', 'Read senders and inbox totals', {
      responses: { 200: response(ref('NewsletterOverview')), ...errors(501) },
    }),
    async (c) =>
      services.newsletters
        ? json(c, await services.newsletters.overview())
        : json(c, { error: 'Newsletter library is unavailable here.' }, 501),
  );
  app.get(
    '/api/newsletters/letters',
    documented('Newsletters', 'Page newsletter letters', {
      parameters: [
        query('view', values('inbox', 'favorites', 'skipped', 'blocked')),
        query('page', pageNumber),
        query('sender', id),
      ],
      responses: { 200: response(ref('NewsletterPage')), ...errors(400, 501) },
    }),
    async (c) => {
      if (!services.newsletters)
        return json(c, { error: 'Newsletter library is unavailable here.' }, 501);
      const view = c.req.query('view') ?? 'inbox';
      const page = Number(c.req.query('page') ?? 1);
      const senderId =
        c.req.query('sender') === undefined ? undefined : Number(c.req.query('sender'));
      if (
        !['inbox', 'favorites', 'skipped', 'blocked'].includes(view) ||
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > 1_000_000 ||
        (senderId !== undefined && (!Number.isSafeInteger(senderId) || senderId < 1))
      )
        return json(c, { error: 'Invalid newsletter filter or page.' }, 400);
      return json(
        c,
        await services.newsletters.letters({ view: view as NewsletterView, page, senderId }),
      );
    },
  );
  app.get(
    '/api/newsletters/letters/:id',
    documented('Newsletters', 'Read a cleaned newsletter letter', {
      parameters: [pathId],
      responses: { 200: response(ref('NewsletterLetter')), ...errors(404) },
    }),
    async (c) => {
      const result = await services.newsletters?.letter(Number(c.req.param('id')));
      return result ? json(c, result) : json(c, { error: 'Letter not found.' }, 404);
    },
  );
  app.get(
    '/api/newsletters/letters/:id/original',
    documented('Newsletters', 'Read an inert retained newsletter original', {
      parameters: [pathId],
      description: 'Sandboxed original HTML; unavailable after retention expiry.',
      responses: { 200: response(str, 'Sandboxed HTML', 'text/html'), ...errors(404) },
    }),
    async (c) => {
      const raw = await services.newsletters?.original(Number(c.req.param('id')));
      if (raw === null || raw === undefined)
        return json(c, { error: 'Original unavailable or expired with sender retention.' }, 404);
      c.header('Content-Security-Policy', originalNewsletterPolicy);
      c.header('X-Robots-Tag', 'noindex, nofollow');
      return c.html(originalNewsletterDocument(raw));
    },
  );
  app.patch(
    '/api/newsletters/senders/:id',
    documented('Newsletters', 'Change sender settings directly', {
      parameters: [pathId],
      description:
        'For destructive settings, prefer preview then confirmed /api/actions kind update_sender for revision checking and Undo.',
      requestBody: jsonBody(ref('SenderPatch')),
      responses: { 200: response(ref('Sender')), ...errors(400, 404, 501) },
    }),
    async (c) => {
      if (!services.newsletters)
        return json(c, { error: 'Newsletter library is unavailable here.' }, 501);
      try {
        const sender = await services.newsletters.updateSender(
          Number(c.req.param('id')),
          await body(c),
        );
        return sender ? json(c, sender) : json(c, { error: 'Sender not found.' }, 404);
      } catch (error) {
        return json(
          c,
          { error: error instanceof Error ? error.message : 'Could not save sender settings.' },
          400,
        );
      }
    },
  );
  app.post(
    '/api/newsletters/senders/:id/preview',
    documented('Newsletters', 'Review sender settings without writes', {
      parameters: [pathId],
      requestBody: jsonBody(ref('SenderPatch')),
      responses: { 200: response(ref('SenderPreview')), ...errors(400, 404, 501) },
    }),
    async (c) => {
      c.header('Cache-Control', 'private, no-store');
      c.header('X-Robots-Tag', 'noindex, nofollow');
      if (!services.newsletters)
        return json(c, { error: 'Newsletter library is unavailable here.' }, 501);
      const id = Number(c.req.param('id'));
      if (!Number.isSafeInteger(id) || id < 1)
        return json(c, { error: 'Choose a valid sender.' }, 400);
      try {
        const preview = await services.newsletters.previewSenderSettings(id, await body(c));
        return preview ? json(c, preview) : json(c, { error: 'Sender not found.' }, 404);
      } catch (error) {
        return json(
          c,
          { error: error instanceof Error ? error.message : 'Could not review sender settings.' },
          400,
        );
      }
    },
  );
}
