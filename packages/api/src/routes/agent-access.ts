import type { Hono, Context } from 'hono';
import type { ApiServices } from '../ports.js';
import { ActionError } from '../../../core/src/actions.js';
import { body, json } from '../http.js';
import { documented, response, errors, jsonBody, pathId, query } from '../openapi.js';
import { array, object, str, date, id, nullable, values, ref } from '../openapi-schemas.js';

const token = object({
  id,
  name: str,
  scopes: values('read', 'write'),
  expiresAt: date,
  lastUsedAt: nullable(date),
  createdAt: date,
});
const activity = object({
  items: array(
    object({
      id,
      agent: str,
      tool: str,
      summary: str,
      createdAt: date,
      receipt: nullable(ref('ActionReceipt')),
    }),
  ),
  next: nullable(id),
});
async function guarded(c: Context, run: () => Response | Promise<Response>) {
  try {
    return await run();
  } catch (error) {
    return error instanceof ActionError
      ? json(c, { error: error.message }, error.status)
      : error instanceof SyntaxError
        ? json(c, { error: 'Use a valid JSON request.' }, 400)
        : json(c, { error: 'Could not complete Agent access request.' }, 500);
  }
}
export function registerAgentAccessRoutes(app: Hono, services: ApiServices) {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const publicOrigin = services.outputBaseUrl ? new URL(services.outputBaseUrl).origin : undefined;
  if (services.outputBaseUrl) hosts.add(new URL(services.outputBaseUrl).hostname);
  app.use('/api/agent-access/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (!services.agentAccess)
      return json(c, { error: 'Agent access needs setup on this instance.' }, 501);
    // Browser writes carry Origin automatically. Reject cross-site forms and fetches before parsing.
    const origin = c.req.header('origin');
    if (
      !hosts.has(new URL(c.req.url).hostname) ||
      (origin && origin !== new URL(c.req.url).origin && origin !== publicOrigin) ||
      c.req.header('sec-fetch-site') === 'cross-site' ||
      (!['GET', 'HEAD'].includes(c.req.method) && !origin)
    )
      return json(c, { error: 'Use Agent access on this instance to manage tokens.' }, 403);
    await next();
  });
  app.get(
    '/api/agent-access/tokens',
    documented('Agent access', 'List token metadata (never secrets)', {
      responses: { 200: response(array(token)), ...errors(403, 501) },
    }),
    (c) => guarded(c, () => json(c, services.agentAccess!.list())),
  );
  app.post(
    '/api/agent-access/tokens',
    documented('Agent access', 'Create a token; reveal its secret once', {
      description:
        'Owner deployment access and same-origin Origin header required. Read-only by default; expiry defaults to 30 days. Only the SHA-256 hash is stored. Never put the returned secret in a URL.',
      requestBody: jsonBody(
        object(
          {
            name: { ...str, minLength: 1, maxLength: 100 },
            scopes: { ...values('read', 'write'), default: 'read' },
            expiresInDays: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
          },
          ['name'],
        ),
      ),
      responses: {
        201: response(object({ token: str, entry: token })),
        ...errors(400, 403, 409, 501),
      },
    }),
    (c) => guarded(c, async () => json(c, services.agentAccess!.create(await body(c)), 201)),
  );
  app.delete(
    '/api/agent-access/tokens/:id',
    documented('Agent access', 'Revoke a token immediately', {
      parameters: [pathId],
      responses: { 200: response(ref('Ok')), ...errors(400, 403, 501) },
    }),
    (c) =>
      guarded(c, () => {
        const value = Number(c.req.param('id'));
        if (!/^[1-9]\d*$/.test(c.req.param('id')) || !Number.isSafeInteger(value))
          throw new ActionError(400, 'Choose a valid token.');
        services.agentAccess!.revoke(value);
        return json(c, { ok: true });
      }),
  );
  app.get(
    '/api/agent-access/actions',
    documented('Agent access', 'Page through redacted agent activity', {
      parameters: [
        query('before', id, 'Exclusive activity id cursor; returns at most 20 records.'),
      ],
      responses: { 200: response(activity), ...errors(400, 403, 501) },
    }),
    (c) =>
      guarded(c, () => {
        const before = c.req.query('before');
        if (
          before !== undefined &&
          (!/^[1-9]\d*$/.test(before) || !Number.isSafeInteger(Number(before)))
        )
          throw new ActionError(400, 'Choose a valid activity cursor.');
        return json(
          c,
          services.agentAccess!.activity(before === undefined ? undefined : Number(before)),
        );
      }),
  );
}
