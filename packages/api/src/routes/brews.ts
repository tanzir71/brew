import { documented, response, errors, jsonBody, pathId } from '../openapi.js';
import { str, bool, id, date, nullable, array, object, ref } from '../openapi-schemas.js';
import { renderBrewEmail } from '../../../core/src/brew-outputs.js';
import type { Hono } from 'hono';
import type { BrewConfigDraft } from '../../../core/src/types/legacy-brew.js';
import type { ApiServices } from '../ports.js';
import { body, errorMessage, json } from '../http.js';
import type { BrewConfigDraft as CompositionDraft } from '../../../core/src/types/brew.js';

export function registerBrewRoutes(
  app: Hono,
  { brews: service, outboundMail, capabilities, outputBaseUrl }: ApiServices,
): void {
  app.post(
    '/api/brew-configs/:id/schedule-preview',
    documented('Brews', 'Preview a draft schedule', {
      parameters: [pathId],
      requestBody: jsonBody(object({ schedule: ref('Schedule'), timezone: str, enabled: bool })),
      responses: {
        200: response(object({ now: date, nextAt: nullable(date), timezone: str })),
        ...errors(422),
      },
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      try {
        return json(c, await service.scheduleInfo(await body(c)));
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Could not check the schedule.') }, 422);
      }
    },
  );
  app.post(
    '/api/brew-configs/:id/test-email',
    documented('Brews', 'Send an unsaved preview email', {
      parameters: [pathId],
      description:
        'Sends email but never saves an issue. Requires configured emailDelivery capability.',
      requestBody: jsonBody(object({ draft: ref('CompositionDraft') })),
      responses: {
        200: response(object({ sent: bool, to: str, messageId: str }, ['sent', 'to'])),
        ...errors(422, 501),
      },
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      if (!outboundMail || !(await capabilities()).emailDelivery)
        return json(c, { error: 'Email delivery needs setup on this instance.' }, 501);
      try {
        const { draft } = await body<{ draft: CompositionDraft }>(c);
        const preview = await service.previewCompositionNow(draft, Number(c.req.param('id')));
        const to = draft.delivery.email?.to;
        if (!to)
          return json(c, { error: 'Enable Email and choose a recipient for the test.' }, 422);
        const rendered = renderBrewEmail(preview.snapshot, {
          baseUrl: outputBaseUrl ?? new URL(c.req.url).origin,
        });
        const result = await outboundMail.send({
          to,
          subject: `Test · ${draft.name}`,
          html: rendered.html,
          text: rendered.text,
        });
        return json(c, { sent: true, to, ...result });
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Could not send the test email.') }, 422);
      }
    },
  );
  app.get(
    '/api/brew-configs',
    documented('Brews', 'List legacy-compatible Brew configurations', {
      responses: { 200: response(array(ref('LegacyBrew'))) },
    }),
    async (c) => json(c, await service.listConfigs()),
  );
  app.post(
    '/api/brew-configs',
    documented('Brews', 'Create a legacy Brew configuration', {
      requestBody: jsonBody(ref('LegacyBrewDraft')),
      responses: { 201: response(ref('LegacyBrew'), 'Brew created'), ...errors(400) },
    }),
    async (c) => {
      try {
        return json(c, await service.create(await body<BrewConfigDraft>(c)), 201);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Invalid Brew') }, 400);
      }
    },
  );
  app.put(
    '/api/brew-configs/:id',
    documented('Brews', 'Replace a legacy Brew configuration', {
      parameters: [pathId],
      requestBody: jsonBody(ref('LegacyBrewDraft')),
      responses: { 200: response(ref('LegacyBrew')), ...errors(404) },
    }),
    async (c) => {
      const config = await service.update(
        Number(c.req.param('id')),
        await body<BrewConfigDraft>(c),
      );
      return config ? json(c, config) : json(c, { error: 'Brew not found' }, 404);
    },
  );
  app.delete(
    '/api/brew-configs/:id',
    documented('Brews', 'Delete a Brew configuration', {
      parameters: [pathId],
      responses: { 204: { description: 'Brew deleted; no response body' }, ...errors(404) },
    }),
    async (c) =>
      (await service.delete(Number(c.req.param('id'))))
        ? c.body(null, 204)
        : json(c, { error: 'Brew not found' }, 404),
  );
  app.post(
    '/api/brew-configs/:id/generate',
    documented('Brews', 'Generate and save an immutable issue', {
      parameters: [pathId],
      description:
        'Can run configured delivery channels. Uses the saved composition or legacy configuration.',
      responses: { 200: response(ref('BrewIssue')), ...errors(404) },
    }),
    async (c) => {
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
    },
  );
  app.get(
    '/api/brew-configs/:id/composition',
    documented('Brews', 'Read a saved v2 composition', {
      parameters: [pathId],
      responses: { 200: response(ref('Composition')), ...errors(404) },
    }),
    async (c) => {
      const value = await service.composition(Number(c.req.param('id')));
      return value ? json(c, value) : json(c, { error: 'Brew not found' }, 404);
    },
  );
  app.post(
    '/api/brew-configs/composition',
    documented('Brews', 'Create a v2 composition', {
      requestBody: jsonBody(ref('CompositionDraft')),
      responses: { 201: response(ref('Composition'), 'Composition created'), ...errors(400) },
    }),
    async (c) => {
      try {
        return json(c, await service.createComposition(await body<CompositionDraft>(c)), 201);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Invalid composition') }, 400);
      }
    },
  );
  app.put(
    '/api/brew-configs/:id/composition',
    documented('Brews', 'Replace a v2 composition', {
      parameters: [pathId],
      requestBody: jsonBody(ref('CompositionDraft')),
      responses: { 200: response(ref('Composition')), ...errors(400, 404) },
    }),
    async (c) => {
      try {
        const value = await service.updateComposition(
          Number(c.req.param('id')),
          await body<CompositionDraft>(c),
        );
        return value ? json(c, value) : json(c, { error: 'Brew not found' }, 404);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Invalid composition') }, 400);
      }
    },
  );
  app.post(
    '/api/brew-configs/:id/preview',
    documented('Brews', 'Preview a Brew at an arbitrary time without saving or delivery', {
      parameters: [pathId],
      requestBody: jsonBody(
        object(
          {
            draft: ref('CompositionDraft'),
            at: {
              type: 'string',
              format: 'date-time',
              description: 'ISO time with Z or an explicit offset.',
            },
          },
          [],
        ),
      ),
      responses: { 200: response(ref('BrewPreview')), ...errors(404, 422) },
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      try {
        const input = await body<{ draft?: CompositionDraft; at?: string }>(c);
        const preview = await service.previewBrew(Number(c.req.param('id')), input.at, input.draft);
        return preview ? json(c, preview) : json(c, { error: 'Brew not found' }, 404);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Could not preview the Brew') }, 422);
      }
    },
  );
  app.get(
    '/api/brew-configs/:id/history',
    documented('Brews', 'List retained frozen issues', {
      parameters: [pathId],
      responses: { 200: response(array(ref('BrewIssue'))) },
    }),
    async (c) => json(c, await service.history(Number(c.req.param('id')))),
  );
  app.get(
    '/api/brews/:id',
    documented('Brews', 'Get a frozen issue', {
      parameters: [pathId],
      responses: { 200: response(ref('BrewIssue')), ...errors(404) },
    }),
    async (c) => {
      const snapshot = await service.snapshot(Number(c.req.param('id')));
      return snapshot ? json(c, snapshot) : json(c, { error: 'Snapshot not found' }, 404);
    },
  );
  app.get(
    '/api/brews/:id/delivery',
    documented('Brews', 'Read redacted delivery results for an issue', {
      parameters: [pathId],
      responses: {
        200: response(object({ issueId: id, results: ref('DeliveryResults') })),
        ...errors(404),
      },
    }),
    async (c) => {
      c.header('Cache-Control', 'private, no-store');
      const id = Number(c.req.param('id'));
      if (!Number.isSafeInteger(id) || id < 1 || !(await service.snapshot(id)))
        return json(c, { error: 'Snapshot not found' }, 404);
      return json(c, { issueId: id, results: await service.deliveryResults(id) });
    },
  );
  app.get(
    '/api/brews/:id/state',
    documented('Brews', 'Read current article state within a frozen issue', {
      parameters: [pathId],
      responses: { 200: response(ref('BrewReadState')), ...errors(404) },
    }),
    async (c) => {
      const state = await service.readState(Number(c.req.param('id')));
      c.header('Cache-Control', 'no-store');
      return state ? json(c, state) : json(c, { error: 'Snapshot not found' }, 404);
    },
  );
  app.put(
    '/api/brews/:id/scroll',
    documented('Brews', 'Save issue scroll position', {
      parameters: [pathId],
      requestBody: jsonBody(object({ position: { type: 'number' } })),
      responses: { 200: response(ref('Ok')) },
    }),
    async (c) => {
      const input = await body<{ position: number }>(c);
      await service.saveScroll(Number(c.req.param('id')), input.position);
      return json(c, { ok: true });
    },
  );
}
