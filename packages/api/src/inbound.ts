import type { Hono } from 'hono';
import { documented, errors, response } from './openapi.js';
import { object, id, nullable, values } from './openapi-schemas.js';
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
    app.post(
      path,
      documented('Inbound', 'Receive an authenticated newsletter delivery', {
        description:
          'Requires configured inbound webhook capability (501 otherwise). Postmark authenticates with HTTP Basic; Mailgun JSON may use X-Mailgun-Timestamp and X-Mailgun-Signature (HMAC-SHA256 over timestamp plus raw body); otherwise Mailgun deliveries use signed timestamp/token/signature payload fields. Provider JSON or MIME form bodies are decoded; arbitrary raw message/rfc822 is not accepted. Replays are idempotent. Node limits inbound requests to 10 MiB.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description:
                  'Postmark or signed Mailgun JSON provider payload; fields depend on configured provider.',
              },
            },
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description:
                  'Signed Mailgun fields, including timestamp, token, signature and body-mime or body-html/body-plain.',
              },
            },
            'multipart/form-data': {
              schema: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'Signed Mailgun fields. Attachments are not retained.',
              },
            },
          },
        },
        parameters: [
          {
            in: 'header',
            name: 'X-Mailgun-Timestamp',
            schema: { type: 'string' },
            description: 'Required for raw-body signed Mailgun JSON.',
          },
          {
            in: 'header',
            name: 'X-Mailgun-Signature',
            schema: { type: 'string' },
            description: 'Required for raw-body signed Mailgun JSON.',
          },
        ],
        // Mailgun may authenticate in its signed body, which OpenAPI security schemes cannot express.
        security: [{ postmarkBasic: [] }, {}],
        responses: {
          200: response(
            object({
              feedId: id,
              articleId: nullable(id),
              outcome: values('inserted', 'duplicate', 'blocked'),
            }),
          ),
          ...errors(400, 401, 403, 406, 409, 413, 415, 501, 503),
        },
      }),
      async (c) => {
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
      },
    );
}
