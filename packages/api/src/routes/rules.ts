import { documented, response, errors, jsonBody, query, pathId } from '../openapi.js';
import {
  bool,
  int,
  count,
  array,
  object,
  ref,
  pageNumber as pageSchema,
} from '../openapi-schemas.js';
import type { Hono } from 'hono';
import type { RuleDraft } from '../../../core/src/types/rules.js';
import type { ApiServices } from '../ports.js';
import { body, errorMessage, json } from '../http.js';
import { pageId, pageNumber, PageInputError } from '../../../core/src/app-pages.js';

export function registerRulesRoutes(app: Hono, { rules: service, data }: ApiServices): void {
  app.get(
    '/api/rules/duplicate-filter',
    documented('Rules', 'Read duplicate filtering', {
      responses: { 200: response(object({ enabled: bool })) },
    }),
    async (c) => json(c, { enabled: await data.duplicateFilterEnabled() }),
  );
  app.put(
    '/api/rules/duplicate-filter',
    documented('Rules', 'Set duplicate filtering for future ingestion', {
      requestBody: jsonBody(object({ enabled: bool })),
      responses: { 200: response(object({ enabled: bool })) },
    }),
    async (c) => {
      const input = await body(c);
      const enabled = Boolean(input.enabled);
      await data.setDuplicateFilter(enabled);
      return json(c, { enabled });
    },
  );
  app.get(
    '/api/rules',
    documented('Rules', 'List saved rule definitions', {
      responses: { 200: response(array(ref('Rule'))) },
    }),
    async (c) => json(c, await service.list()),
  );
  app.post(
    '/api/rules',
    documented('Rules', 'Create a saved rule', {
      requestBody: jsonBody(ref('RuleDraft')),
      responses: { 201: response(ref('Rule'), 'Rule created'), ...errors(400) },
    }),
    async (c) => {
      try {
        return json(c, await service.create(await body<RuleDraft>(c)), 201);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Invalid rule') }, 400);
      }
    },
  );
  app.put(
    '/api/rules/:id',
    documented('Rules', 'Replace a saved rule definition', {
      parameters: [pathId],
      requestBody: jsonBody(ref('RuleDraft')),
      responses: { 200: response(ref('Rule')), ...errors(400, 404) },
    }),
    async (c) => {
      try {
        const rule = await service.update(Number(c.req.param('id')), await body<RuleDraft>(c));
        return rule ? json(c, rule) : json(c, { error: 'Rule not found' }, 404);
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Invalid rule') }, 400);
      }
    },
  );
  app.delete(
    '/api/rules/:id',
    documented('Rules', 'Delete a rule without a durable receipt', {
      parameters: [pathId],
      description:
        'Legacy deletion. Prefer confirmed POST /api/actions with kind delete_rule for recoverable Undo.',
      responses: { 204: { description: 'Rule deleted; no response body' }, ...errors(404) },
    }),
    async (c) =>
      (await service.delete(Number(c.req.param('id'))))
        ? c.body(null, 204)
        : json(c, { error: 'Rule not found' }, 404),
  );
  app.get(
    '/api/rules/:id/logs',
    documented('Rules', 'Read the latest 100 retained executions', {
      parameters: [pathId],
      description:
        'Legacy bounded array. Use /api/rules/{id}/executions for full totals and paging.',
      responses: { 200: response(array(ref('RuleLog'))) },
    }),
    async (c) => json(c, await service.logs(Number(c.req.param('id')))),
  );
  app.get(
    '/api/rules/:id/executions',
    documented('Rules', 'Page all retained execution history', {
      parameters: [pathId, query('page', pageSchema)],
      responses: { 200: response(ref('RuleLogPage')), ...errors(400, 404) },
    }),
    async (c) => {
      c.header('Cache-Control', 'private, no-store');
      c.header('X-Robots-Tag', 'noindex, nofollow');
      try {
        const result = await service.logPage(
          pageId(c.req.param('id')),
          pageNumber(c.req.query('page') ?? null),
        );
        return result ? json(c, result) : json(c, { error: 'Rule not found.' }, 404);
      } catch (error) {
        return json(
          c,
          { error: errorMessage(error, 'Could not read executions.') },
          error instanceof PageInputError ? error.status : 400,
        );
      }
    },
  );
  app.post(
    '/api/rules/:id/apply',
    documented('Rules', 'Apply a rule to retained articles without a durable receipt', {
      parameters: [pathId],
      description:
        'Runs actions, including configured external effects. Prefer confirmed POST /api/actions with kind apply_rule for supported Undo.',
      requestBody: jsonBody(object({ days: int }, [])),
      responses: { 200: response(object({ matched: count })), ...errors(404) },
    }),
    async (c) => {
      try {
        const input = await body<{ days?: number }>(c);
        return json(c, {
          matched: await service.applyToExisting(Number(c.req.param('id')), input.days ?? 30),
        });
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Rule not found') }, 404);
      }
    },
  );
  app.post(
    '/api/rules/preview',
    documented('Rules', 'Preview rule matches without running actions', {
      parameters: [
        query(
          'includeTotal',
          bool,
          'true adds the complete visible match total and sample limit; default returns only items.',
        ),
      ],
      requestBody: jsonBody(ref('RulePreviewInput')),
      responses: { 200: response(ref('RulePreview')), ...errors(400) },
    }),
    async (c) => {
      try {
        if (c.req.query('includeTotal') === 'true') {
          c.header('Cache-Control', 'private, no-store');
          c.header('X-Robots-Tag', 'noindex, nofollow');
          return json(
            c,
            await service.previewSummary(
              await body<Pick<RuleDraft, 'scope' | 'matchType' | 'conditions'>>(c),
            ),
          );
        }
        return json(c, {
          items: await service.preview(
            await body<Pick<RuleDraft, 'scope' | 'matchType' | 'conditions'>>(c),
          ),
        });
      } catch (error) {
        return json(c, { error: errorMessage(error, 'Invalid preview') }, 400);
      }
    },
  );
}
