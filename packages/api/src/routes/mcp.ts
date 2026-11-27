import type { Hono } from 'hono';
import { documented, errors, response } from '../openapi.js';
import { json } from '../http.js';
import type { ApiServices } from '../ports.js';

export interface McpHttpPort {
  fetch(request: Request): Promise<Response>;
}
export function registerMcpRoutes(
  app: Hono,
  port?: McpHttpPort,
  publicUrl?: string,
  access?: ApiServices['agentAccess'],
) {
  const publicOrigin = publicUrl ? new URL(publicUrl).origin : undefined;
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (publicUrl) hosts.add(new URL(publicUrl).hostname);
  for (const method of ['get', 'post', 'delete'] as const)
    app[method](
      '/mcp',
      documented('MCP', 'Use the Brew MCP streamable HTTP transport', {
        description:
          'JSON-RPC MCP endpoint. Validate Host, Origin and expiring Brew bearer token before dispatch. The transport negotiates protocol versions; unsupported stream/session methods return 405. Read-only by default. Write tokens can mark, star, tag, add feeds and Undo their own changes; they cannot delete content or save rules. Tool writes require explicit confirmation and return undo_id.',
        security: [{ brewToken: [] }],
        ...(method === 'post'
          ? {
              requestBody: {
                required: true,
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            }
          : {}),
        responses: {
          200: {
            description: 'MCP response or stream',
            content: {
              'application/json': { schema: { type: 'object' } },
              'text/event-stream': { schema: { type: 'string' } },
            },
          },
          202: { description: 'Accepted notification; no body' },
          400: response({ type: 'object' }, 'Invalid MCP request'),
          401: response({ type: 'object' }, 'Missing, expired or revoked bearer token'),
          403: response({ type: 'object' }, 'Untrusted Host or Origin'),
          405: { description: 'Unsupported transport method' },
          ...errors(501),
        },
      }),
      async (c) => {
        c.header('Cache-Control', 'private, no-store');
        c.header('X-Robots-Tag', 'noindex, nofollow');
        if (!port) return json(c, { error: 'MCP needs setup on this instance.' }, 501);
        const url = new URL(c.req.url);
        const origin = c.req.header('origin');
        if (
          !hosts.has(url.hostname) ||
          (origin !== undefined && origin !== url.origin && origin !== publicOrigin)
        )
          return json(c, { error: 'Untrusted MCP Host or Origin.' }, 403);
        if (access && !(await access.authenticate(c.req.header('authorization') ?? null))) {
          c.header('WWW-Authenticate', 'Bearer realm="Brew MCP"');
          return json(c, { error: 'Use a valid Brew token from Settings → Agent access.' }, 401);
        }
        return port.fetch(c.req.raw);
      },
    );
}
