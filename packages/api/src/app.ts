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
import { registerRulesRoutes } from './routes/rules.js';
import { registerBrewOutputRoutes } from './routes/brew-outputs.js';
import { registerBrewRoutes } from './routes/brews.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerOpmlRoutes } from './routes/opml.js';
import { registerPollerRoutes } from './routes/poller.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerInboundRoutes } from './inbound.js';
import { registerNewsletterRoutes } from './newsletters.js';

export const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; media-src 'self' https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function createApi(
  services: ApiServices,
  options: { notFound?: NotFoundHandler } = {},
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
  registerFeedRoutes(app, services);
  registerSourceRoutes(app, services);
  registerArticleRoutes(app, services);
  registerActionRoutes(app, services);
  registerArticleOutputRoutes(app, services);
  registerReaderRoutes(app, services);
  registerRulesRoutes(app, services);
  registerBrewRoutes(app, services);
  registerBrewOutputRoutes(app, services);
  registerSearchRoutes(app, services);
  registerOpmlRoutes(app, services);
  registerPollerRoutes(app, services);
  registerMediaRoutes(app, services);
  registerInboundRoutes(app, services);
  registerNewsletterRoutes(app, services);
  app.get('/api/capabilities', async (c) => {
    c.header('Cache-Control', 'no-store');
    return json(c, await services.capabilities());
  });
  app.get('/api/health', (c) => json(c, { ok: true }));
  app.get('/api/events', (c) => eventStream(c, services.events));
  return app;
}
