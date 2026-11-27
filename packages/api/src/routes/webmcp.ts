import type { Context, Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import type { AgentToolServices } from '../agent-tools.js';
import { brewToolCatalog, toolDefinition } from '../agent-tools.js';
import { body, json } from '../http.js';
import { documented, errors, response, jsonBody } from '../openapi.js';
import { array, object, str, bool } from '../openapi-schemas.js';

const result = object(
  {
    content: array(object({ type: { type: 'string', const: 'text' }, text: str })),
    structuredContent: { type: 'object', additionalProperties: true },
    isError: bool,
  },
  ['content'],
);
export function registerWebMcpRoutes(
  app: Hono,
  services: AgentToolServices & Pick<ApiServices, 'capabilities'>,
) {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const publicOrigin = services.outputBaseUrl ? new URL(services.outputBaseUrl).origin : undefined;
  if (publicOrigin) hosts.add(new URL(publicOrigin).hostname);
  app.use('/api/webmcp/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (!(await services.capabilities()).webmcp)
      return json(c, { error: 'Enable BREW_WEBMCP=1 on this instance to use in-page tools.' }, 501);
    const url = new URL(c.req.url),
      origin = c.req.header('origin');
    if (
      !hosts.has(url.hostname) ||
      (origin && origin !== url.origin && origin !== publicOrigin) ||
      c.req.header('sec-fetch-site') === 'cross-site' ||
      (!['GET', 'HEAD'].includes(c.req.method) && !origin)
    )
      return json(c, { error: 'Use WebMCP on this instance.' }, 403);
    await next();
  });
  app.get(
    '/api/webmcp/tools',
    documented('WebMCP', 'Describe the shared tool catalog for mounted browser controls', {
      responses: {
        200: response(
          array(
            object({
              name: str,
              description: str,
              inputSchema: { type: 'object' },
              annotations: { type: 'object' },
            }),
          ),
        ),
        ...errors(403, 501),
      },
    }),
    (c) => json(c, brewToolCatalog(services).map(toolDefinition)),
  );
  app.post(
    '/api/webmcp/call',
    documented('WebMCP', 'Execute a tool with the owner browser session', {
      description:
        'Experimental; requires the instance flag and same-origin Origin. Browser code exposes only mounted UI tools and stages writes in a native confirmation dialog. Read calls and dry runs do not change library state. Write calls require confirm:true and a stable request_id; receipts support actual Undo. This route uses the owner deployment boundary and never accepts a scoped bearer token.',
      requestBody: jsonBody(
        object({ name: str, arguments: { type: 'object', additionalProperties: true } }),
      ),
      responses: { 200: response(result), ...errors(400, 403, 404, 501) },
    }),
    async (c) => invoke(c, services),
  );
}
async function invoke(c: Context, services: AgentToolServices & Pick<ApiServices, 'capabilities'>) {
  let input: unknown;
  try {
    input = await body(c);
  } catch {
    return json(c, { error: 'Use valid JSON tool arguments.' }, 400);
  }
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['name', 'arguments'].includes(key))
  )
    return json(c, { error: 'Choose a tool and arguments.' }, 400);
  const value = input as Record<string, unknown>;
  if (
    typeof value.name !== 'string' ||
    !value.arguments ||
    typeof value.arguments !== 'object' ||
    Array.isArray(value.arguments)
  )
    return json(c, { error: 'Choose a tool and arguments.' }, 400);
  const tool = brewToolCatalog(services, {
    write: true,
    agent: 'webmcp',
    name: 'WebMCP',
    signal: c.req.raw.signal,
  }).find((tool) => tool.name === value.name);
  if (!tool) return json(c, { error: 'Tool not found.' }, 404);
  return json(c, await tool.execute(value.arguments));
}
