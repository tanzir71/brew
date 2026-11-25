import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import {
  contractFetcher,
  contractNow,
  opml,
  scenarios,
  seedContractDatabase,
  responseContract,
} from './contracts/scenarios.js';

const baseline = JSON.parse(
  fs.readFileSync(new URL('./contracts/v1-responses.json', import.meta.url), 'utf8'),
) as Array<{ name: string; status: number; headers: Record<string, string>; body: unknown }>;

describe('Hono preserves captured v1 REST contracts', () => {
  it.each(scenarios)('$name', async ({ name, request }) => {
    vi.setSystemTime(new Date(contractNow));
    const database = openDatabase(':memory:');
    seedContractDatabase(database);
    const app = await createApp({ database, fetcher: contractFetcher });
    try {
      const response = await app.inject(request);
      const expected = baseline.find((item) => item.name === name);
      expect(expected, `Missing captured v1 response: ${name}`).toBeDefined();
      expect({ name, ...responseContract(response) }).toEqual(expected);
      if (response.headers['content-type']?.includes('application/json') && response.body) {
        const value = response.json();
        if (value.undoToken)
          expect(value.undoToken).toMatch(/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i);
        if (value.durationMs !== undefined) expect(value.durationMs).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });
});

describe('Node to Hono request body adaptation', () => {
  it.each([null, 'plain JSON string', 42, []])(
    'preserves JSON primitives for validation: %j',
    async (payload) => {
      const app = await createApp({ database: openDatabase(':memory:'), fetcher: contractFetcher });
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/feeds',
          payload: JSON.stringify(payload),
          headers: { 'content-type': 'application/json' },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'url is required' });
      } finally {
        await app.close();
      }
    },
  );

  it('preserves OPML passed as a JSON string and rejects JSON objects with the v1 message', async () => {
    const app = await createApp({ database: openDatabase(':memory:'), fetcher: contractFetcher });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/opml/import',
        payload: JSON.stringify(opml),
        headers: { 'content-type': 'application/json' },
      });
      expect(response.json()).toEqual({ imported: 1, skipped: 0, foldersCreated: 1 });
      const invalid = await app.inject({ method: 'POST', url: '/api/opml/import', payload: {} });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({ error: 'OPML document is required' });
    } finally {
      await app.close();
    }
  });
});
