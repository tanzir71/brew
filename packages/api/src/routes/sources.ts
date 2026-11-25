import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { body, errorMessage, json, requiredText } from '../http.js';
export function registerSourceRoutes(app: Hono, { sources }: ApiServices) {
  app.post('/api/sources/discover', async (c) => {
    try {
      const value = await body(c);
      c.header('Cache-Control', 'no-store');
      return json(c, await sources.discover(requiredText(value?.url, 'url')));
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Could not discover feeds.') }, 400);
    }
  });
  app.get('/api/sources/searches', async (c) => json(c, await sources.searches()));
  app.post('/api/sources/searches', async (c) => {
    try {
      return json(c, await sources.saveSearch(await body(c)));
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Could not save search.') }, 400);
    }
  });
  app.get('/api/sources/mailbox', async (c) => {
    c.header('Cache-Control', 'no-store');
    return json(c, await sources.mailbox());
  });
}
