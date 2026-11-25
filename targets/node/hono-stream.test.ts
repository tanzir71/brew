import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi } from '../../packages/api/src/app.js';
import { createApp } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { nodeApiServices } from './src/ports/api-services.js';
import { PollerService } from './src/services/poller-service.js';
import { SseBroker } from './src/services/sse-broker.js';
import { contractFetcher, seedContractDatabase } from './contracts/scenarios.js';

const decode = (value?: Uint8Array) => new TextDecoder().decode(value);
afterEach(() => vi.useRealTimers());

function runtime() {
  const database = openDatabase(':memory:');
  const broker = new SseBroker();
  const poller = new PollerService(database, contractFetcher);
  return {
    database,
    broker,
    api: createApi(nodeApiServices(database, poller, broker, contractFetcher)),
  };
}

describe('Hono live events', () => {
  it('streams the v1 heartbeat and event format and cleans up on request abort', async () => {
    vi.useFakeTimers();
    const { database, broker, api } = runtime();
    const abort = new AbortController();
    try {
      const response = await api.request('/api/events', { signal: abort.signal });
      expect(response.headers.get('content-type')).toBe('text/event-stream');
      expect(response.headers.get('content-security-policy')).toContain("object-src 'none'");
      const reader = response.body!.getReader();
      expect(decode((await reader.read()).value)).toBe('event: heartbeat\ndata: {}\n\n');
      broker.publish('article:new', { count: 1 });
      expect(decode((await reader.read()).value)).toBe('event: article:new\ndata: {"count":1}\n\n');
      expect(vi.getTimerCount()).toBe(1);
      abort.abort();
      expect((await reader.read()).done).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      broker.close();
      database.close();
    }
  });

  it('cleans up on reader cancellation and does not subscribe for HEAD', async () => {
    vi.useFakeTimers();
    const { database, broker, api } = runtime();
    const subscribe = vi.spyOn(broker, 'subscribe');
    try {
      const head = await api.request('/api/events', { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(subscribe).not.toHaveBeenCalled();
      const response = await api.request('/api/events');
      await response.body!.cancel();
      expect(vi.getTimerCount()).toBe(0);
      expect(() => broker.publish('article:new', { count: 1 })).not.toThrow();
    } finally {
      broker.close();
      database.close();
    }
  });

  it('delivers ingest events over a real Node socket and closes active streams on shutdown', async () => {
    const database = openDatabase(':memory:');
    seedContractDatabase(database);
    const app = await createApp({ database, fetcher: contractFetcher });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const abort = new AbortController();
    try {
      const response = await fetch(`${address}/api/events`, { signal: abort.signal });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      expect(decode((await reader.read()).value)).toContain('event: heartbeat');
      const result = await fetch(`${address}/api/feeds/1/fetch`, { method: 'POST' });
      expect(await result.json()).toMatchObject({ outcome: 'success', newItems: 1 });
      expect(decode((await reader.read()).value)).toBe(
        'event: article:new\ndata: {"count":1,"feeds":[{"feedId":1,"count":1}]}\n\n',
      );
      await app.close();
      expect((await reader.read()).done).toBe(true);
    } finally {
      abort.abort();
      await app.close();
    }
  });
});
