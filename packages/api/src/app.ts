import type { Hono, NotFoundHandler } from 'hono';
import type { ApiServices } from './ports.js';
import { createApiBase } from './api-base.js';
export { securityHeaders } from './api-base.js';
import { registerInstanceRoutes } from './routes/instance.js';

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
import { registerOpenApi } from './openapi.js';

import { registerMcpRoutes, type McpHttpPort } from './routes/mcp.js';
import { registerAgentAccessRoutes } from './routes/agent-access.js';
import { registerWebMcpRoutes } from './routes/webmcp.js';
import { registerInstanceGuide } from './routes/instance-guide.js';
import { registerReaderAccess } from './routes/reader-access.js';
import { registerGoogleReader } from './reader-sync/google-reader.js';
import { registerFever } from './reader-sync/fever.js';

export function createApi(
  services: ApiServices,
  options: { notFound?: NotFoundHandler; mcp?: McpHttpPort } = {},
): Hono {
  const app = createApiBase(options.notFound);
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
  registerInstanceRoutes(app, services);
  registerOpenApi(app);
  return app;
}
