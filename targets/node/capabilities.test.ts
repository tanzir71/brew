import { expect, it } from 'vitest';
import { createApp } from './src/app.js';
import { openDatabase } from './src/db/database.js';

it('reports wired Node capabilities without accepting client mode overrides', async () => {
  const app = await createApp({ database: openDatabase(':memory:') });
  try {
    const response = await app.inject('/api/capabilities?mode=browser&ai=true&webmcp=true');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-security-policy']).toContain("object-src 'none'");
    expect(response.json()).toEqual({
      mode: 'node',
      fetch: 'direct',
      backgroundFetch: { kind: 'always', everyMinutes: 1 },
      inboundMail: null,
      emailDelivery: null,
      readerApi: false,
      mcp: 'stdio+http',
      agentAccess: true,
      webmcp: false,
      ai: { available: [], configured: false },
      readState: 'server',
      publicCopy: false,
      outputs: { twins: true, feed: true, webhook: true },
      actions: { undo: true },
    });
  } finally {
    await app.close();
  }
});
