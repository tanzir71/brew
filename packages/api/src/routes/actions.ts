import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { ActionError } from '../../../core/src/actions.js';
import { body, json } from '../http.js';

export function registerActionRoutes(app: Hono, services: ApiServices) {
  app.use('/api/actions*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'private, no-store');
  });
  app.get('/api/actions', async (c) =>
    services.actions
      ? json(c, await services.actions.recent())
      : json(c, { error: 'Undo needs setup on this instance.' }, 501),
  );
  app.post('/api/actions', async (c) => {
    if (!services.actions) return json(c, { error: 'Undo needs setup on this instance.' }, 501);
    try {
      return json(c, await services.actions.run(await body(c)));
    } catch (error) {
      return error instanceof ActionError
        ? json(c, { error: error.message }, error.status)
        : json(c, { error: 'Could not finish this action.' }, 500);
    }
  });
  app.post('/api/actions/:id/undo', async (c) => {
    if (!services.actions) return json(c, { error: 'Undo needs setup on this instance.' }, 501);
    try {
      if (!/^[1-9]\d*$/.test(c.req.param('id')))
        throw new ActionError(400, 'Choose a valid action.');
      return json(c, await services.actions.undo(Number(c.req.param('id'))));
    } catch (error) {
      return error instanceof ActionError
        ? json(c, { error: error.message }, error.status)
        : json(c, { error: 'Could not undo this action.' }, 500);
    }
  });
}
