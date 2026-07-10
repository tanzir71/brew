import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('server scaffold', () => {
  it('reports health', async () => {
    const app = await createApp();
    const response = await app.inject('/api/health');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});
