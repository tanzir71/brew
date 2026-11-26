import type { Hono } from 'hono';
import { describeRoute, openAPIRouteHandler, type DescribeRouteOptions } from 'hono-openapi';
import { schemas, ref, id, str, bool, values, pageNumber, type Schema } from './openapi-schemas.js';

type Parameter = NonNullable<DescribeRouteOptions['parameters']>[number];
type ParameterSchema = Exclude<Parameter, { $ref: string }>['schema'];
export const query = (
  name: string,
  schema: ParameterSchema,
  description?: string,
  required = false,
): Parameter => ({ in: 'query', name, schema, required, ...(description ? { description } : {}) });
export const pathId: Parameter = { in: 'path', name: 'id', required: true, schema: id };
export const jsonBody = (schema: Schema, required = true) => ({
  required,
  content: { 'application/json': { schema } },
});
export const response = (
  schema: Schema,
  description = 'Successful response',
  media = 'application/json',
) => ({ description, content: { [media]: { schema } } });

/** Metadata stays beside the real Hono handler; it never changes validation or executes services. */
export function documented(tag: string, summary: string, options: DescribeRouteOptions = {}) {
  return describeRoute({
    tags: [tag],
    summary,
    operationId: ({ method, path }) =>
      `${method.toLowerCase()}_${path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
    ...options,
    responses: { 500: response(ref('Error'), 'Unexpected server error'), ...options.responses },
  });
}

export const errors = (...codes: number[]) =>
  Object.fromEntries(
    codes.map((code) => [
      code,
      response(
        ref('Error'),
        (
          {
            400: 'Invalid request',
            401: 'Invalid webhook credentials or signature',
            403: 'Webhook recipient rejected',
            404: 'Resource not found',
            406: 'Message rejected',
            409: 'Conflict with current state',
            410: 'Undo window expired',
            413: 'Request too large',
            415: 'Unsupported content type',
            422: 'Could not process request',
            428: 'Explicit confirmation required',
            501: 'Capability needs setup',
            503: 'Temporarily unavailable; retry delivery',
          } as Record<number, string>
        )[code] ?? 'Request failed',
      ),
    ]),
  );

export function registerOpenApi(app: Hono) {
  // Hono's built-in HEAD handling uses this same document, with no body.
  app.get(
    '/api/openapi.json',
    documented('Instance', 'Describe the registered API', {
      description:
        'OpenAPI 3.1 generated from this Hono application. Contains schemas, never instance records or credentials.',
      responses: { 200: response({ type: 'object', description: 'OpenAPI 3.1 document' }) },
    }),
    async (c, next) => {
      c.header('Cache-Control', 'private, no-store');
      c.header('X-Robots-Tag', 'noindex, nofollow');
      await next();
    },
    openAPIRouteHandler(app, {
      excludeStaticFile: false,
      includeEmptyPaths: false,
      documentation: {
        openapi: '3.1.0',
        info: {
          title: 'Brew instance API',
          version: '0.1.0',
          description:
            'Single-owner instance API. Protect owner REST and HTML access at the deployment boundary. Scoped bearer tokens authorize only /mcp and are explicitly refused by owner REST routes. Manage them in Settings → Agent access. Check /api/capabilities before using optional features (501 means setup is required). GET also supports HEAD. Legacy REST writes do not all offer Undo; use confirmed /api/actions for supported durable owner actions. Private text exports are included; HTML application routes and static files are not API operations.',
        },
        // Stable and same-origin; do not trust Host/forwarded headers or publish configuration.
        servers: [{ url: '/', description: 'This Brew instance' }],
        components: {
          schemas,
          securitySchemes: {
            brewToken: {
              type: 'http',
              scheme: 'bearer',
              description:
                'Hashed, expiring Brew tokens. Accepted only at /mcp; read-only by default. Write scope never permits arbitrary deletion or saving rules.',
            },
            postmarkBasic: {
              type: 'http',
              scheme: 'basic',
              description:
                'Configured Postmark webhook credentials only. Mailgun instead verifies its signed body/headers.',
            },
          },
        },
      },
    }),
  );
}

/** A route's suffix determines its response media, including dynamic ID.format segments. */
export function textOutput(path: string, summary: string, parameters: Parameter[] = []) {
  const media = path.endsWith('.md')
    ? ['text/markdown']
    : path.endsWith('.json')
      ? ['application/json']
      : ['text/markdown', 'application/json'];
  const identities = [...path.matchAll(/:([a-zA-Z]+)/g)].map<Parameter>(([, name]) => ({
    in: 'path',
    name: name!,
    required: true,
    schema:
      name === 'output'
        ? { type: 'string', pattern: '^[1-9][0-9]*\\.(md|json)$', example: '1.json' }
        : id,
    description:
      name === 'output' ? 'Saved item ID including the .md or .json suffix.' : 'Saved item ID.',
  }));
  return documented('Outputs', summary, {
    description:
      'Private, no-store saved-state export. Does not save drafts or mutate reading state. Dynamic output segments include the ID and .md/.json suffix.',
    parameters: [
      ...identities,
      query('agent', values('1'), 'Preserve agent mode in document links.'),
      ...parameters,
    ],
    responses: {
      200: {
        description: 'Selected saved data in the requested format',
        content: Object.fromEntries(
          media.map((type) => [
            type,
            { schema: type === 'text/markdown' ? str : { type: 'object' } },
          ]),
        ),
      },
      ...errors(400, 404, 501),
    },
  });
}

export const readerOutputParameters: Parameter[] = [
  query('page', pageNumber),
  query('unread', bool),
  query('sort', values('newest', 'oldest')),
  query('density', values('title', 'magazine', 'cards')),
  query('q', str),
  query('scope', values('all', 'folder', 'starred')),
  query('folderId', id),
  query('feedId', id),
];
export const pageOutputParameters: Parameter[] = [
  query('page', pageNumber),
  query('tab', values('preview', 'log')),
  query('view', str, 'Current feed-library or newsletter filter.'),
  query('folder', str),
  query('q', str),
  query('section', str),
  query('sheet', str),
  query('setup', str),
];
