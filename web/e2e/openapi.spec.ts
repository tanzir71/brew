import { expect, test } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

test('the instance guide works through the real proxy, describes auth and leads to matching MCP tools', async ({
  request,
  baseURL,
}) => {
  const result = await request.get('/llms.txt');
  expect(result.status()).toBe(200);
  expect(result.headers()['content-type']).toMatch(/^text\/plain; charset=utf-8$/i);
  expect(result.headers()['cache-control']).toBe('private, no-store');
  expect(result.headers()['x-robots-tag']).toBe('noindex, nofollow');
  const guide = await result.text();
  expect(guide).toMatch(/^# Brew instance guide\n/);
  expect(guide).toContain('read-only by default');
  const path = (title: string) => {
    const line = guide.split('\n').find((line) => line.startsWith(`- [${title}](`));
    expect(line).toBeTruthy();
    return line!.match(/\]\(([^)]+)\)/)![1]!;
  };
  const capabilities = await request.get(path('Capabilities'));
  expect((await capabilities.json()).mcp).toBe('stdio+http');
  const schema = await request.get(path('OpenAPI 3.1'));
  expect((await schema.json()).paths['/llms.txt'].get.responses['200'].content).toHaveProperty(
    'text/plain',
  );
  expect((await request.get(path('Brew index'))).status()).toBe(200);
  expect(await (await request.get('/')).text()).toContain(
    '<link rel="describedby" href="/llms.txt"',
  );
  expect(await (await request.head('/llms.txt')).body()).toHaveLength(0);
  expect(
    (
      await request.get('/llms.txt', { headers: { Authorization: 'Bearer not-owner-access' } })
    ).status(),
  ).toBe(403);
  const created = await request.post('/api/agent-access/tokens', {
    headers: { Origin: baseURL! },
    data: { name: 'Guide discovery test' },
  });
  expect(created.status()).toBe(201);
  const { token, entry } = await created.json();
  const client = new Client({ name: 'guide-discovery-test', version: '1' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(path('MCP HTTP'), baseURL), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const advertised = [...guide.matchAll(/^- \[([a-z_]+)\]\(/gm)].map((match) => match[1]).sort();
    expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(advertised);
    const brews = await client.callTool({ name: 'list_brews', arguments: {} });
    expect(brews.isError).not.toBe(true);
    expect(brews.structuredContent).toHaveProperty('items');
  } finally {
    await client.close();
    expect(
      (
        await request.delete(`/api/agent-access/tokens/${entry.id}`, {
          headers: { Origin: baseURL! },
        })
      ).status(),
    ).toBe(200);
  }
});

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
  expect(doc.paths['/mcp'].post).toBeDefined();
  const head = await request.head('/api/openapi.json');
  expect(head.status()).toBe(200);
  expect(await head.body()).toHaveLength(0);
  expect(head.headers()['cache-control']).toBe('private, no-store');
});
