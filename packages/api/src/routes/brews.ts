import type { Hono } from 'hono';
import type { BrewConfigDraft } from '../../../core/src/types/legacy-brew.js';
import type { ApiServices } from '../ports.js';
import { body, errorMessage, json } from '../http.js';
import type { BrewConfigDraft as CompositionDraft } from '../../../core/src/types/brew.js';

export function registerBrewRoutes(
  app: Hono,
  { brews: service, outboundMail, capabilities }: ApiServices,
): void {
  app.post('/api/brew-configs/:id/schedule-preview', async (c) => {
    c.header('Cache-Control', 'no-store');
    try {
      return json(c, await service.scheduleInfo(await body(c)));
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Could not check the schedule.') }, 422);
    }
  });
  app.post('/api/brew-configs/:id/test-email', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!outboundMail || !(await capabilities()).emailDelivery)
      return json(c, { error: 'Email delivery needs setup on this instance.' }, 501);
    try {
      const { draft } = await body<{ draft: CompositionDraft }>(c);
      const preview = await service.previewCompositionNow(draft, Number(c.req.param('id')));
      const to = draft.delivery.email?.to;
      if (!to) return json(c, { error: 'Enable Email and choose a recipient for the test.' }, 422);
      const result = await outboundMail.send({
        to,
        subject: `Test · ${draft.name}`,
        html: preview.outputs.email,
      });
      return json(c, { sent: true, to, ...result });
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Could not send the test email.') }, 422);
    }
  });
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
      const id = Number(c.req.param('id'));
      return json(
        c,
        (await service.usesComposition(id))
          ? await service.generateComposition(id)
          : await service.generate(id),
      );
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Brew not found') }, 404);
    }
  });
  app.get('/api/brew-configs/:id/composition', async (c) => {
    const value = await service.composition(Number(c.req.param('id')));
    return value ? json(c, value) : json(c, { error: 'Brew not found' }, 404);
  });
  app.post('/api/brew-configs/composition', async (c) => {
    try {
      return json(c, await service.createComposition(await body<CompositionDraft>(c)), 201);
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Invalid composition') }, 400);
    }
  });
  app.put('/api/brew-configs/:id/composition', async (c) => {
    try {
      const value = await service.updateComposition(
        Number(c.req.param('id')),
        await body<CompositionDraft>(c),
      );
      return value ? json(c, value) : json(c, { error: 'Brew not found' }, 404);
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Invalid composition') }, 400);
    }
  });
  app.post('/api/brew-configs/:id/preview', async (c) => {
    try {
      const input = await body<{ draft: CompositionDraft; at?: string }>(c);
      c.header('Cache-Control', 'no-store');
      return json(
        c,
        await service.previewComposition(input.draft, Number(c.req.param('id')), input.at),
      );
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Could not preview the Brew') }, 422);
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
