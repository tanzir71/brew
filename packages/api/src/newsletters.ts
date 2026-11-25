import type { Hono } from 'hono';
import type { ApiServices } from './ports.js';
import type { NewsletterView } from '../../core/src/types/newsletters.js';
import {
  originalNewsletterDocument,
  originalNewsletterContentPolicy,
} from '../../core/src/newsletter-original.js';
import { body, json } from './http.js';

export const originalNewsletterPolicy = `sandbox; ${originalNewsletterContentPolicy}; frame-ancestors 'self'`;
export function registerNewsletterRoutes(app: Hono, services: ApiServices) {
  app.use('/api/newsletters/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.get('/api/newsletters/overview', async (c) =>
    services.newsletters
      ? json(c, await services.newsletters.overview())
      : json(c, { error: 'Newsletter library is unavailable here.' }, 501),
  );
  app.get('/api/newsletters/letters', async (c) => {
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
  });
  app.get('/api/newsletters/letters/:id', async (c) => {
    const result = await services.newsletters?.letter(Number(c.req.param('id')));
    return result ? json(c, result) : json(c, { error: 'Letter not found.' }, 404);
  });
  app.get('/api/newsletters/letters/:id/original', async (c) => {
    const raw = await services.newsletters?.original(Number(c.req.param('id')));
    if (raw === null || raw === undefined)
      return json(c, { error: 'Original unavailable or expired with sender retention.' }, 404);
    c.header('Content-Security-Policy', originalNewsletterPolicy);
    c.header('X-Robots-Tag', 'noindex, nofollow');
    return c.html(originalNewsletterDocument(raw));
  });
  app.patch('/api/newsletters/senders/:id', async (c) => {
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
  });
}
