import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { eventStream } from '../events.js';
import { json } from '../http.js';
import { documented, response } from '../openapi.js';
import { ref, str } from '../openapi-schemas.js';

export function registerInstanceRoutes(
  app: Hono,
  services: Pick<ApiServices, 'capabilities' | 'events'>,
) {
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
    documented('Instance', 'Check instance health', { responses: { 200: response(ref('Ok')) } }),
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
}
