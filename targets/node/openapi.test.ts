import { afterEach, describe, expect, it, vi } from 'vitest';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import type { OpenAPIDocument, OpenAPIOperation } from 'hono-openapi';
import { createApi } from '../../packages/api/src/app.js';
import type { ApiServices } from '../../packages/api/src/ports.js';
import { documented, response } from '../../packages/api/src/openapi.js';
import { str } from '../../packages/api/src/openapi-schemas.js';
import { createApp } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { articles, feeds } from './src/db/schema.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
const operation = (
  doc: OpenAPIDocument,
  path: string,
  method: 'get' | 'post' | 'put' | 'delete' | 'patch',
) => {
  const value = doc.paths[path]?.[method];
  expect(value, `${method.toUpperCase()} ${path}`).toBeDefined();
  return value!;
};
const ajv = new Ajv2020({ strict: false, validateFormats: false });
function matches(doc: OpenAPIDocument, schema: unknown, value: unknown) {
  const validate = ajv.compile({ ...(schema as object), components: doc.components });
  expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
}
function matchesResponse(
  doc: OpenAPIDocument,
  op: OpenAPIOperation,
  status: number,
  value: unknown,
) {
  const result = op.responses[String(status)];
  expect(result).toBeDefined();
  if (!result || '$ref' in result) throw new Error('Expected documented response content');
  matches(doc, result.content?.['application/json']?.schema, value);
}

describe('route-derived OpenAPI 3.1', () => {
  it('validates the entire document and covers every registered handler, including suffix routes', async () => {
    // Any accidental service call fails: serving documentation needs no configured ports.
    const api = createApi({} as ApiServices);
    const result = await api.request('/api/openapi.json');
    expect(result.status).toBe(200);
    const doc: OpenAPIDocument = await result.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: '/', description: 'This Brew instance' }]);
    await SwaggerParser.validate(structuredClone(doc), { resolve: { file: false, http: false } });
    for (const name of Object.keys(doc.components?.schemas ?? {})) {
      // The document validator checks OAS structure; Ajv also compiles every 2020-12 data schema.
      expect(() =>
        ajv.compile({ $ref: `#/components/schemas/${name}`, components: doc.components }),
      ).not.toThrow();
    }
    const registered = [
      ...new Set(
        api.routes
          .filter((route) => route.method !== 'ALL')
          .map(
            (route) =>
              `${route.method.toLowerCase()} ${route.path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}')}`,
          ),
      ),
    ].sort();
    const generated = Object.entries(doc.paths)
      .flatMap(([path, methods]) => Object.keys(methods ?? {}).map((method) => `${method} ${path}`))
      .sort();
    expect(generated).toEqual(registered);
    const ids = Object.values(doc.paths).flatMap((methods) =>
      Object.values(methods ?? {}).map((op) => (op as OpenAPIOperation).operationId),
    );
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(doc.paths['/api/openapi.json']).toBeDefined();
    expect(doc.paths['/b/{id}/compose.md']).toBeDefined();
    expect(doc.paths['/settings/runs.json']).toBeDefined();
    expect(doc.paths['/api/*']).toBeUndefined();
    expect(doc.paths['/mcp']?.post).toBeDefined();
    expect(doc.components?.securitySchemes).not.toHaveProperty('bearerAuth');
    // Fail for missing required path parameters, including embedded :id suffixes.
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const op of Object.values(methods ?? {}) as OpenAPIOperation[]) {
        const names = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
        const params = op.parameters?.filter((p) => !('$ref' in p) && p.in === 'path') ?? [];
        expect(params.map((p) => !('$ref' in p) && p.name).sort()).toEqual(names.sort());
        expect(params.every((p) => !('$ref' in p) && p.required)).toBe(true);
      }
    }
  });

  it('derives added routes and keeps cached documents isolated between application instances', async () => {
    const api = createApi({} as ApiServices);
    api.get(
      '/api/extension/:id',
      documented('Test', 'An actual additional Hono route', {
        responses: { 200: response(str) },
      }),
      (c) => c.text(c.req.param('id')),
    );
    const docs = await Promise.all(
      Array.from({ length: 3 }, async () => (await api.request('/api/openapi.json')).json()),
    );
    for (const doc of docs) expect(doc.paths['/api/extension/{id}']).toBeDefined();
    const independent = await (
      await createApi({} as ApiServices).request('/api/openapi.json')
    ).json();
    expect(independent.paths['/api/extension/{id}']).toBeUndefined();
    expect((await api.request('/api/extension/7')).status).toBe(200);
  });

  it('serves private GET and HEAD in Node without reading records, leaking configuration, fetching or writing', async () => {
    const database = openDatabase(':memory:');
    const fetcher = vi.fn(async () => {
      throw new Error('Unexpected request');
    });
    const app = await createApp({
      database,
      fetcher,
      publicUrl: 'https://private-config.example.test',
    });
    closes.push(() => app.close());
    database.db
      .insert(feeds)
      .values({
        title: 'private-title-marker',
        url: 'https://private-feed.example.test/?token=secret-token-marker',
      })
      .run();
    const before = database.sqlite.prepare('SELECT total_changes() AS n').get();
    for (const method of ['GET', 'HEAD'] as const) {
      const result = await app.inject({
        method,
        url: '/api/openapi.json',
        headers: { host: 'poison.example.test', 'x-forwarded-host': 'poison.example.test' },
      });
      expect(result.statusCode).toBe(200);
      expect(result.headers['content-type']).toMatch(/^application\/json/);
      expect(result.headers['cache-control']).toBe('private, no-store');
      expect(result.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(result.headers['x-content-type-options']).toBe('nosniff');
      expect(result.body).not.toMatch(
        /private-title-marker|private-feed|secret-token-marker|private-config|poison\.example/,
      );
      if (method === 'HEAD') expect(result.body).toBe('');
      else expect(result.json().openapi).toBe('3.1.0');
    }
    expect(database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await app.inject('/api/missing-openapi-route')).statusCode).toBe(404);
  });

  it('documents schemas that drive actual reads, drafts, confirmed writes, conflicts and Undo', async () => {
    const database = openDatabase(':memory:');
    const app = await createApp({ database });
    closes.push(() => app.close());
    const feed = database.db
      .insert(feeds)
      .values({ title: 'Contract source', url: 'https://source.example.test/rss' })
      .returning()
      .get();
    const article = database.db
      .insert(articles)
      .values({
        feedId: feed.id,
        guid: 'contract',
        hash: 'contract',
        title: 'Contract article',
        url: 'https://source.example.test/story',
        publishedAt: new Date(),
        contentHtml: '<p>Retained content.</p>',
      })
      .returning()
      .get();
    const doc: OpenAPIDocument = (await app.inject('/api/openapi.json')).json();
    for (const [path, url] of [
      ['/api/health', '/api/health'],
      ['/api/capabilities', '/api/capabilities'],
      ['/api/feeds', '/api/feeds'],
      ['/api/reader/navigation', '/api/reader/navigation'],
      ['/api/articles', '/api/articles?includeTotal=true'],
      ['/api/articles/{id}', `/api/articles/${article.id}`],
      ['/api/search', '/api/search?q=Contract&includeTotal=true'],
      ['/api/newsletters/overview', '/api/newsletters/overview'],
      ['/api/newsletters/letters', '/api/newsletters/letters'],
    ]) {
      const result = await app.inject(url!);
      expect(result.statusCode).toBe(200);
      matchesResponse(doc, operation(doc, path!, 'get'), result.statusCode, result.json());
    }
    const rule = {
      name: 'Contract rule',
      enabled: false,
      matchType: 'all',
      scope: {},
      conditions: [{ field: 'title', operator: 'contains', value: 'Contract' }],
      actions: [{ type: 'star' }],
      stopProcessing: false,
    };
    const create = operation(doc, '/api/rules', 'post');
    if (!create.requestBody || '$ref' in create.requestBody)
      throw new Error('Missing request body');
    matches(doc, create.requestBody.content['application/json']?.schema, rule);
    const saved = await app.inject({ method: 'POST', url: '/api/rules', payload: rule });
    expect(saved.statusCode).toBe(201);
    matchesResponse(doc, create, 201, saved.json());
    const preview = await app.inject({
      method: 'POST',
      url: '/api/rules/preview?includeTotal=true',
      payload: rule,
    });
    expect(preview.statusCode).toBe(200);
    matchesResponse(doc, operation(doc, '/api/rules/preview', 'post'), 200, preview.json());
    expect(preview.json()).toMatchObject({ total: 1, limit: 50 });
    const history = await app.inject(`/api/rules/${saved.json().id}/executions`);
    matchesResponse(doc, operation(doc, '/api/rules/{id}/executions', 'get'), 200, history.json());

    const draft = {
      name: 'Contract Brew',
      enabled: true,
      timezone: 'Asia/Dhaka',
      schedule: { kind: 'daily', time: '07:00' },
      delivery: defaultDelivery(),
      sections: [newBrewSection('Stories')],
    };
    const composed = await app.inject({
      method: 'POST',
      url: '/api/brew-configs/composition',
      payload: draft,
    });
    expect(composed.statusCode).toBe(201);
    matchesResponse(
      doc,
      operation(doc, '/api/brew-configs/composition', 'post'),
      201,
      composed.json(),
    );
    const configId = composed.json().id;
    const schedule = await app.inject({
      method: 'POST',
      url: `/api/brew-configs/${configId}/schedule-preview`,
      payload: draft,
    });
    matchesResponse(
      doc,
      operation(doc, '/api/brew-configs/{id}/schedule-preview', 'post'),
      200,
      schedule.json(),
    );
    const previewBrew = await app.inject({
      method: 'POST',
      url: `/api/brew-configs/${configId}/preview`,
      payload: { draft, at: '2026-11-26T07:00:00+06:00' },
    });
    expect(previewBrew.statusCode).toBe(200);
    matchesResponse(
      doc,
      operation(doc, '/api/brew-configs/{id}/preview', 'post'),
      200,
      previewBrew.json(),
    );
    const generated = await app.inject({
      method: 'POST',
      url: `/api/brew-configs/${configId}/generate`,
    });
    expect(generated.statusCode).toBe(200);
    matchesResponse(
      doc,
      operation(doc, '/api/brew-configs/{id}/generate', 'post'),
      200,
      generated.json(),
    );
    const delivery = await app.inject(`/api/brews/${generated.json().id}/delivery`);
    matchesResponse(doc, operation(doc, '/api/brews/{id}/delivery', 'get'), 200, delivery.json());

    const run = operation(doc, '/api/actions', 'post');
    const intent = {
      kind: 'delete_rule',
      id: saved.json().id,
      confirm: true,
      requestId: 'openapi-contract-001',
    };
    if (!run.requestBody || '$ref' in run.requestBody) throw new Error('Missing action body');
    matches(doc, run.requestBody.content['application/json']?.schema, intent);
    const refused = await app.inject({
      method: 'POST',
      url: '/api/actions',
      payload: { ...intent, confirm: false },
    });
    expect(refused.statusCode).toBe(428);
    matchesResponse(doc, run, 428, refused.json());
    const written = await app.inject({ method: 'POST', url: '/api/actions', payload: intent });
    expect(written.statusCode).toBe(200);
    matchesResponse(doc, run, 200, written.json());
    const conflict = await app.inject({
      method: 'POST',
      url: '/api/actions',
      payload: { ...intent, id: 999 },
    });
    expect(conflict.statusCode).toBe(409);
    matchesResponse(doc, run, 409, conflict.json());
    const undone = await app.inject({
      method: 'POST',
      url: `/api/actions/${written.json().id}/undo`,
    });
    expect(undone.statusCode).toBe(200);
    matchesResponse(doc, operation(doc, '/api/actions/{id}/undo', 'post'), 200, undone.json());
    expect((await app.inject('/api/rules')).json()).toHaveLength(1);
  });
});
