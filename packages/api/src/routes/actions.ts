import { documented, response, errors, jsonBody, pathId } from '../openapi.js';
import { array, ref } from '../openapi-schemas.js';
import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { ActionError } from '../../../core/src/actions.js';
import { body, json } from '../http.js';

export function registerActionRoutes(app: Hono, services: ApiServices) {
  app.use('/api/actions*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'private, no-store');
  });
  app.get(
    '/api/actions',
    documented('Owner actions', 'List recent redacted action receipts', {
      responses: { 200: response(array(ref('ActionReceipt'))), ...errors(501) },
    }),
    async (c) =>
      services.actions
        ? json(c, await services.actions.recent())
        : json(c, { error: 'Undo needs setup on this instance.' }, 501),
  );
  app.post(
    '/api/actions/mark-read/preview',
    documented('Owner actions', 'Review a read batch without changing articles', {
      requestBody: jsonBody(ref('ReadTarget')),
      responses: { 200: response(ref('ReadPreview')), ...errors(400, 501) },
    }),
    async (c) => {
      c.header('X-Robots-Tag', 'noindex, nofollow');
      if (!services.actions) return json(c, { error: 'Undo needs setup on this instance.' }, 501);
      try {
        return json(c, await services.actions.previewRead(await body(c)));
      } catch (error) {
        return error instanceof ActionError
          ? json(c, { error: error.message }, error.status)
          : json(c, { error: 'Could not review unread articles.' }, 500);
      }
    },
  );
  app.post(
    '/api/actions',
    documented('Owner actions', 'Run an explicitly confirmed owner action', {
      description:
        'Requires confirm=true. Preserve requestId when checking a lost acknowledgement; reusing it for different arguments conflicts. Receipt id is the identifier accepted by the Undo route. External notifications/webhooks from apply_rule cannot be recalled; inspect externalEffects and canUndo. Review revision-bearing actions before writing.',
      requestBody: jsonBody(ref('ActionRequest')),
      responses: { 200: response(ref('ActionReceipt')), ...errors(400, 404, 409, 410, 428, 501) },
    }),
    async (c) => {
      if (!services.actions) return json(c, { error: 'Undo needs setup on this instance.' }, 501);
      try {
        return json(c, await services.actions.run(await body(c)));
      } catch (error) {
        return error instanceof ActionError
          ? json(c, { error: error.message }, error.status)
          : json(c, { error: 'Could not finish this action.' }, 500);
      }
    },
  );
  app.post(
    '/api/actions/:id/undo',
    documented('Owner actions', 'Undo a durable owner action', {
      parameters: [pathId],
      description:
        'Uses the receipt id; expires after 30 seconds and protects conflicting later changes. Repeating an acknowledged Undo is safe.',
      responses: { 200: response(ref('ActionReceipt')), ...errors(400, 404, 409, 410, 501) },
    }),
    async (c) => {
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
    },
  );
}
