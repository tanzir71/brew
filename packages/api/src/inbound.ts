import type { Hono } from 'hono';
import type { NewsletterIngestResult } from '../../core/src/types/newsletters.js';
import type { ApiServices } from './ports.js';
import { json } from './http.js';

export interface InboundEmailPort {
  receive(request: Request): Promise<NewsletterIngestResult>;
}
export class InboundEmailError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 406 | 409 | 413 | 415 | 503,
  ) {
    super(message);
  }
}
export function registerInboundRoutes(app: Hono, services: ApiServices) {
  for (const path of ['/api/inbound/email', '/api/inbound/email/json', '/api/inbound/email/mime'])
    app.post(path, async (c) => {
      c.header('Cache-Control', 'no-store');
      if (!services.inboundEmail)
        return json(c, { error: 'Inbound webhook is not configured.' }, 501);
      try {
        return json(c, await services.inboundEmail.receive(c.req.raw));
      } catch (error) {
        if (error instanceof InboundEmailError)
          return json(c, { error: error.message }, error.status);
        // Never echo provider payloads, credentials or internal database errors to a caller.
        return json(c, { error: 'Email processing failed. Retry this delivery.' }, 503);
      }
    });
}
