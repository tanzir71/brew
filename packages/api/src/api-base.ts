import { Hono, type NotFoundHandler } from 'hono';
import { json } from './http.js';

export const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; media-src 'self' https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
/** All target routers share response security and scoped-credential isolation. */
export function createApiBase(notFound?: NotFoundHandler) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(securityHeaders)) {
      if (name === 'Content-Security-Policy' && c.res.headers.has(name)) continue;
      c.header(name, value);
    }
  });
  app.onError((error, c) =>
    json(c, { statusCode: 500, error: 'Internal Server Error', message: error.message }, 500),
  );
  app.notFound(notFound ?? ((c) => json(c, { error: 'Not found' }, 404)));
  app.use('/api/*', async (c, next) => {
    if (
      /^GoogleLogin\b/i.test(c.req.header('authorization') ?? '') &&
      !c.req.path.startsWith('/api/greader/')
    ) {
      c.header('Cache-Control', 'private, no-store');
      return json(c, { error: 'Reader sessions are accepted only at /api/greader.' }, 403);
    }
    if (
      /^Bearer\b/i.test(c.req.header('authorization') ?? '') &&
      !c.req.path.startsWith('/api/greader/')
    ) {
      c.header('Cache-Control', 'private, no-store');
      return json(c, { error: 'Scoped tokens are accepted only at /mcp.' }, 403);
    }
    return next();
  });
  return app;
}
