import type { Hono } from 'hono';
import type { BrewConfigDraft } from '../../../core/src/types/brew.js';
import type { ApiServices } from '../ports.js';
import { body, errorMessage, json } from '../http.js';

export function registerBrewRoutes(app: Hono, { brews: service }: ApiServices): void {
  app.get('/api/brew-configs', async (c) => json(c, await service.listConfigs()));
  app.post('/api/brew-configs', async (c) => {
    try {
      return json(c, await service.create(await body<BrewConfigDraft>(c)), 201);
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Invalid Brew') }, 400);
    }
  });
  app.put('/api/brew-configs/:id', async (c) => {
    const config = await service.update(Number(c.req.param('id')), await body<BrewConfigDraft>(c));
    return config ? json(c, config) : json(c, { error: 'Brew not found' }, 404);
  });
  app.delete('/api/brew-configs/:id', async (c) =>
    (await service.delete(Number(c.req.param('id'))))
      ? c.body(null, 204)
      : json(c, { error: 'Brew not found' }, 404),
  );
  app.post('/api/brew-configs/:id/generate', async (c) => {
    try {
      return json(c, await service.generate(Number(c.req.param('id'))));
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Brew not found') }, 404);
    }
  });
  app.get('/api/brew-configs/:id/history', async (c) =>
    json(c, await service.history(Number(c.req.param('id')))),
  );
  app.get('/api/brews/:id', async (c) => {
    const snapshot = await service.snapshot(Number(c.req.param('id')));
    return snapshot ? json(c, snapshot) : json(c, { error: 'Snapshot not found' }, 404);
  });
  app.get('/api/brews/:id/state', async (c) => {
    const state = await service.readState(Number(c.req.param('id')));
    c.header('Cache-Control', 'no-store');
    return state ? json(c, state) : json(c, { error: 'Snapshot not found' }, 404);
  });
  app.put('/api/brews/:id/scroll', async (c) => {
    const input = await body<{ position: number }>(c);
    await service.saveScroll(Number(c.req.param('id')), input.position);
    return json(c, { ok: true });
  });
}
