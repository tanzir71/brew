import type { Hono } from 'hono';
import type { RuleDraft } from '../../../core/src/types/rules.js';
import type { ApiServices } from '../ports.js';
import { body, errorMessage, json } from '../http.js';
import { pageId, pageNumber, PageInputError } from '../../../core/src/app-pages.js';

export function registerRulesRoutes(app: Hono, { rules: service, data }: ApiServices): void {
  app.get('/api/rules/duplicate-filter', async (c) =>
    json(c, { enabled: await data.duplicateFilterEnabled() }),
  );
  app.put('/api/rules/duplicate-filter', async (c) => {
    const input = await body(c);
    const enabled = Boolean(input.enabled);
    await data.setDuplicateFilter(enabled);
    return json(c, { enabled });
  });
  app.get('/api/rules', async (c) => json(c, await service.list()));
  app.post('/api/rules', async (c) => {
    try {
      return json(c, await service.create(await body<RuleDraft>(c)), 201);
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Invalid rule') }, 400);
    }
  });
  app.put('/api/rules/:id', async (c) => {
    try {
      const rule = await service.update(Number(c.req.param('id')), await body<RuleDraft>(c));
      return rule ? json(c, rule) : json(c, { error: 'Rule not found' }, 404);
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Invalid rule') }, 400);
    }
  });
  app.delete('/api/rules/:id', async (c) =>
    (await service.delete(Number(c.req.param('id'))))
      ? c.body(null, 204)
      : json(c, { error: 'Rule not found' }, 404),
  );
  app.get('/api/rules/:id/logs', async (c) =>
    json(c, await service.logs(Number(c.req.param('id')))),
  );
  app.get('/api/rules/:id/executions', async (c) => {
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
  });
  app.post('/api/rules/:id/apply', async (c) => {
    try {
      const input = await body<{ days?: number }>(c);
      return json(c, {
        matched: await service.applyToExisting(Number(c.req.param('id')), input.days ?? 30),
      });
    } catch (error) {
      return json(c, { error: errorMessage(error, 'Rule not found') }, 404);
    }
  });
  app.post('/api/rules/preview', async (c) => {
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
  });
}
