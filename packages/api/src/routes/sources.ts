import { documented, response, errors, jsonBody } from '../openapi.js';
import { str, nullable, array, object, ref } from '../openapi-schemas.js';
import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { body, errorMessage, json, requiredText } from '../http.js';
export function registerSourceRoutes(app: Hono, { sources }: Pick<ApiServices, 'sources'>) {
  app.post(
    '/api/sources/discover',
    documented('Sources', 'Discover native feeds from a source URL', {
      requestBody: jsonBody(object({ url: str })),
      responses: { 200: response(ref('SourceDiscovery')), ...errors(400) },
    }),
    async (c) => {
      try {
        const value = await body(c);
        c.header('Cache-Control', 'no-store');
        return json(c, await sources.discover(requiredText(value?.url, 'url')));
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Could not discover feeds.') }, 400);
      }
    },
  );
  app.get(
    '/api/sources/searches',
    documented('Sources', 'List saved source searches', {
      responses: { 200: response(array(ref('SourceSearch'))) },
    }),
    async (c) => json(c, await sources.searches()),
  );
  app.post(
    '/api/sources/searches',
    documented('Sources', 'Save a source search', {
      requestBody: jsonBody(object({ clientId: str, name: str, query: str })),
      responses: { 200: response(ref('SourceSearch')), ...errors(400) },
    }),
    async (c) => {
      try {
        return json(c, await sources.saveSearch(await body(c)));
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Could not save search.') }, 400);
      }
    },
  );
  app.get(
    '/api/sources/mailbox',
    documented('Sources', 'Read the configured receiving address', {
      responses: { 200: response(object({ address: nullable(str) })) },
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      return json(c, await sources.mailbox());
    },
  );
}
