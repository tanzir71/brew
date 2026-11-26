import { expect, test } from '@playwright/test';

test('same-origin API discovery serves route-derived OpenAPI with private headers and HEAD support', async ({
  request,
}) => {
  const result = await request.get('/api/openapi.json');
  expect(result.status()).toBe(200);
  expect(result.headers()['content-type']).toMatch(/^application\/json/);
  expect(result.headers()['cache-control']).toBe('private, no-store');
  expect(result.headers()['x-robots-tag']).toBe('noindex, nofollow');
  const doc = await result.json();
  expect(doc.openapi).toBe('3.1.0');
  expect(doc.servers).toEqual([{ url: '/', description: 'This Brew instance' }]);
  expect(
    doc.paths['/api/articles'].get.parameters.find(
      (p: { name: string }) => p.name === 'includeTotal',
    ).schema.type,
  ).toBe('boolean');
  expect(doc.paths['/api/actions'].post.requestBody.content['application/json'].schema).toEqual({
    $ref: '#/components/schemas/ActionRequest',
  });
  expect(
    doc.paths['/api/rules/{id}/executions'].get.responses['200'].content['application/json'].schema,
  ).toEqual({ $ref: '#/components/schemas/RuleLogPage' });
  expect(doc.paths['/api/inbound/email/mime'].post.responses['501']).toBeDefined();
  expect(doc.paths['/rules/{output}'].get.responses['200'].content).toHaveProperty('text/markdown');
  expect(doc.paths['/mcp']).toBeUndefined();
  const head = await request.head('/api/openapi.json');
  expect(head.status()).toBe(200);
  expect(await head.body()).toHaveLength(0);
  expect(head.headers()['cache-control']).toBe('private, no-store');
});
