import { expect, test } from '@playwright/test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

test('the real Node MCP transport works through the same-origin development proxy', async ({
  request,
  baseURL,
}) => {
  const capabilities = await request.get('/api/capabilities');
  expect((await capabilities.json()).mcp).toBe('stdio+http');
  const created = await request.post('/api/agent-access/tokens', {
    headers: { Origin: baseURL! },
    data: { name: 'Proxy test' },
  });
  expect(created.status()).toBe(201);
  const { token, entry } = await created.json();
  const client = new Client({ name: 'brew-proxy-test', version: '1' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', baseURL), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('undo');
    expect(tools.tools).toHaveLength(12);
    const result = await client.callTool({ name: 'list_brews', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toHaveProperty('items');
  } finally {
    await client.close();
    await request.delete(`/api/agent-access/tokens/${entry.id}`, { headers: { Origin: baseURL! } });
  }
  const rejected = await request.post('/mcp', {
    headers: { Origin: 'https://untrusted.example.test' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(rejected.status()).toBe(403);
  expect(rejected.headers()['cache-control']).toBe('private, no-store');
});
