import { Hono, type NotFoundHandler } from 'hono';
import type { ApiServices } from './ports.js';
import { eventStream } from './events.js';
import { json } from './http.js';
import { registerSourceRoutes } from './routes/sources.js';
import { registerFeedRoutes } from './routes/feeds.js';
import { registerArticleRoutes } from './routes/articles.js';
import { registerActionRoutes } from './routes/actions.js';
import { registerArticleOutputRoutes } from './routes/article-outputs.js';
import { registerReaderRoutes } from './routes/reader.js';
import { registerReaderOutputRoutes } from './routes/reader-outputs.js';
import { registerPageOutputRoutes } from './routes/page-outputs.js';
import { registerRulesRoutes } from './routes/rules.js';
import { registerBrewOutputRoutes } from './routes/brew-outputs.js';
import { registerBrewRoutes } from './routes/brews.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerOpmlRoutes } from './routes/opml.js';
import { registerPollerRoutes } from './routes/poller.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerInboundRoutes } from './inbound.js';
import { registerNewsletterRoutes } from './newsletters.js';
import { documented, response, registerOpenApi } from './openapi.js';
import { ref, str } from './openapi-schemas.js';
import { registerMcpRoutes, type McpHttpPort } from './routes/mcp.js';
import { registerAgentAccessRoutes } from './routes/agent-access.js';
import { registerWebMcpRoutes } from './routes/webmcp.js';
import { registerInstanceGuide } from './routes/instance-guide.js';
import { registerReaderAccess } from './routes/reader-access.js';
import { registerGoogleReader } from './reader-sync/google-reader.js';
import { registerFever } from './reader-sync/fever.js';

export const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; media-src 'self' https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function createApi(
  services: ApiServices,
  options: { notFound?: NotFoundHandler; mcp?: McpHttpPort } = {},
): Hono {
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
  app.notFound(options.notFound ?? ((c) => json(c, { error: 'Not found' }, 404)));
  app.use('/api/*', async (c, next) => {
    if (
      /^GoogleLogin\b/i.test(c.req.header('authorization') ?? '') &&
      !c.req.path.startsWith('/api/greader/')
    ) {
      c.header('Cache-Control', 'private, no-store');
      return json(c, { error: 'Reader sessions are accepted only at /api/greader.' }, 403);
    }
    // Scoped MCP credentials must never fall through to trusted-owner REST handlers.
    if (
      /^Bearer\b/i.test(c.req.header('authorization') ?? '') &&
      !c.req.path.startsWith('/api/greader/')
    ) {
      c.header('Cache-Control', 'private, no-store');
      return json(c, { error: 'Scoped tokens are accepted only at /mcp.' }, 403);
    }
    return next();
  });
  registerAgentAccessRoutes(app, services);
  registerWebMcpRoutes(app, services);
  registerInstanceGuide(app, services, Boolean(options.mcp));
  registerReaderAccess(app, services);
  registerGoogleReader(app, services);
  registerFever(app, services);
  registerFeedRoutes(app, services);
  registerSourceRoutes(app, services);
  registerArticleRoutes(app, services);
  registerActionRoutes(app, services);
  registerArticleOutputRoutes(app, services);
  registerReaderRoutes(app, services);
  registerReaderOutputRoutes(app, services);
  registerPageOutputRoutes(app, services);
  registerRulesRoutes(app, services);
  registerBrewRoutes(app, services);
  registerBrewOutputRoutes(app, services);
  registerSearchRoutes(app, services);
  registerOpmlRoutes(app, services);
  registerPollerRoutes(app, services);
  registerMediaRoutes(app, services);
  registerInboundRoutes(app, services);
  registerNewsletterRoutes(app, services);
  registerMcpRoutes(app, options.mcp, services.outputBaseUrl, services.agentAccess);
  app.get(
    '/api/capabilities',
    documented('Instance', 'Read effective instance capabilities', {
      responses: { 200: response(ref('Capabilities')) },
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      return json(c, await services.capabilities());
    },
  );
  app.get(
    '/api/health',
    documented('Instance', 'Check instance health', {
      responses: { 200: response(ref('Ok')) },
    }),
    (c) => json(c, { ok: true }),
  );
  app.get(
    '/api/events',
    documented('Instance', 'Subscribe to live instance events', {
      description:
        'Server-sent events: heartbeat every 15 seconds, article:new and notification. Disconnect to unsubscribe. HEAD checks headers without opening a stream.',
      responses: { 200: response(str, 'Live SSE stream', 'text/event-stream') },
    }),
    (c) => eventStream(c, services.events),
  );
  registerOpenApi(app);
  return app;
}
