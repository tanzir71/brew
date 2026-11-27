import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import type { AgentToolServices } from '../agent-tools.js';
import { documented, errors, response } from '../openapi.js';
import { str } from '../openapi-schemas.js';
import { json } from '../http.js';
import { instanceGuide } from '../instance-guide.js';

export function registerInstanceGuide(
  app: Hono,
  services: AgentToolServices & Pick<ApiServices, 'capabilities'>,
  hasMcpTransport: boolean,
) {
  app.use('/llms.txt', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (/^(?:Bearer|GoogleLogin)\b/i.test(c.req.header('authorization') ?? ''))
      return json(c, { error: 'Scoped tokens are accepted only at /mcp.' }, 403);
    await next();
  });
  // Hono handles HEAD through this same route and removes its body.
  app.get(
    '/llms.txt',
    documented('Instance', 'Read the per-instance agent guide', {
      description:
        'Private Markdown in text/plain. Generated from current capabilities and the shared tool catalog, never library records or credentials. Root-relative links cannot be changed by Host/forwarded headers. Uses the owner deployment boundary; scoped tokens authorize only /mcp.',
      responses: {
        200: response(str, 'Instance routes, authorization and tool guidance', 'text/plain'),
        ...errors(403, 503),
      },
    }),
    async (c) => {
      try {
        return c.text(await instanceGuide(services, hasMcpTransport));
      } catch {
        return json(c, { error: 'Instance guidance is temporarily unavailable.' }, 503);
      }
    },
  );
}
