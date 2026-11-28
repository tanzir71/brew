import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Miniflare, Response as BindingResponse, type Request as BindingRequest } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { relayConfig } from '../src/relay.js';
import { wireError, fromWire, isSqliteConstraint } from '../src/errors.js';

const origin = 'https://brew.example.test';
const token = 'native-relay-test-only-32-characters';
const requests: Array<{ url: string; headers: Record<string, string> }> = [];
const runtime = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL('../relay/worker.js', import.meta.url)),
  compatibilityDate: '2026-07-01',
  bindings: {
    APP_ORIGIN: origin,
    ALLOWED_HOSTS: 'feeds.example.test,cdn.example.test',
    RELAY_TOKEN: token,
  },
  outboundService: async (request: BindingRequest) => {
    requests.push({ url: request.url, headers: Object.fromEntries(request.headers) });
    const url = new URL(request.url);
    if (url.pathname === '/redirect')
      return new BindingResponse(null, {
        status: 302,
        headers: { Location: 'https://cdn.example.test/final' },
      });
    if (url.pathname === '/denied')
      return new BindingResponse(null, {
        status: 302,
        headers: { Location: 'https://not-allowed.example.test/final' },
      });
    if (url.pathname === '/loop')
      return new BindingResponse(null, { status: 302, headers: { Location: '/loop' } });
    if (url.pathname === '/large') return new BindingResponse(new Uint8Array(10 * 1024 * 1024 + 1));
    if (url.pathname === '/304')
      return new BindingResponse(null, { status: 304, headers: { ETag: '"one"' } });
    if (url.pathname === '/error') return new BindingResponse('Upstream details', { status: 503 });
    return new BindingResponse('feed body', {
      headers: {
        ETag: '"one"',
        'Last-Modified': 'Wed, 25 Nov 2026 07:00:00 GMT',
        'Content-Type': 'application/rss+xml',
        'Set-Cookie': 'private=upstream',
        Authorization: 'private-upstream',
      },
    });
  },
});
beforeAll(async () => {
  await runtime.ready;
}, 30_000);
beforeEach(() => {
  requests.length = 0;
});
afterAll(() => runtime.dispose());
function send(
  url = 'https://feeds.example.test/feed',
  headers: Record<string, string> = {},
  bodyHeaders = {},
) {
  return runtime.dispatchFetch('https://relay.example.test/', {
    method: 'POST',
    headers: {
      Origin: origin,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ url, headers: bodyHeaders }),
  });
}
it('fails closed for missing/wrong origin or token before fetching any source', async () => {
  const attempts: Record<string, string>[] = [
    { Origin: '' },
    { Origin: 'https://other.example.test' },
    { Authorization: '' },
    { Authorization: 'Bearer wrong' },
  ];
  for (const headers of attempts) {
    const response = await send(undefined, headers);
    expect(response.status).toBe(headers.Origin !== undefined ? 403 : 401);
  }
  expect(requests).toEqual([]);
});
it('allows an exact-origin preflight without opening access to other sites', async () => {
  const response = await runtime.dispatchFetch('https://relay.example.test/', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  expect(response.status).toBe(204);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  expect(requests).toHaveLength(0);
});
it('forwards only conditional feed headers and returns only public response metadata', async () => {
  const response = await send(
    undefined,
    { Cookie: 'owner=session' },
    {
      'if-none-match': '"one"',
      'if-modified-since': 'yesterday',
      accept: 'application/rss+xml',
      authorization: 'private',
      cookie: 'private',
    },
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('feed body');
  expect(requests[0]!.headers).toMatchObject({
    'if-none-match': '"one"',
    'if-modified-since': 'yesterday',
    accept: 'application/rss+xml',
  });
  expect(requests[0]!.headers.authorization).toBeUndefined();
  expect(requests[0]!.headers.cookie).toBeUndefined();
  expect(response.headers.get('Set-Cookie')).toBeNull();
  expect(response.headers.get('Authorization')).toBeNull();
  expect(response.headers.get('X-Brew-Relay')).toBe('upstream');
  expect(response.headers.get('ETag')).toBe('"one"');
});
it('checks the exact allowed host and credentials on every redirect', async () => {
  const accepted = await send('https://feeds.example.test/redirect');
  expect(accepted.status).toBe(200);
  expect(accepted.headers.get('X-Brew-Feed-URL')).toBe('https://cdn.example.test/final');
  expect(requests).toHaveLength(2);
  requests.length = 0;
  const denied = await send('https://feeds.example.test/denied');
  expect(denied.status).toBe(403);
  expect(requests).toHaveLength(1);
  for (const url of [
    'https://feeds.example.test.evil.test/feed',
    'https://feeds.example.test:1234/feed',
    'https://user:password@feeds.example.test/feed',
    'file:///feed',
    'https://feeds.example.test/feed#fragment',
  ])
    expect((await send(url)).status).toBe(403);
  expect(requests).toHaveLength(1);
});
it('bounds redirects and response bytes and distinguishes upstream failures from setup errors', async () => {
  for (const url of ['loop', 'large']) {
    const response = await send('https://feeds.example.test/' + url);
    expect(response.status).toBe(502);
    expect(response.headers.get('X-Brew-Relay')).toBe('upstream');
  }
  expect(requests.filter((request) => request.url.endsWith('/loop'))).toHaveLength(6);
  const response = await send('https://feeds.example.test/error');
  expect(response.status).toBe(503);
  expect(response.headers.get('X-Brew-Relay')).toBe('upstream');
});
it('preserves a body-free conditional 304 response', async () => {
  const response = await send('https://feeds.example.test/304');
  expect(response.status).toBe(304);
  expect(await response.text()).toBe('');
  expect(response.headers.get('ETag')).toBe('"one"');
});
it('rejects insecure/credential-bearing relay configuration while allowing local development', () => {
  for (const endpoint of [
    'http://relay.example.test/',
    'https://user:secret@relay.example.test/',
    'https://relay.example.test/?secret=x',
    'https://relay.example.test/#x',
  ])
    expect(() => relayConfig({ endpoint, token })).toThrow();
  expect(relayConfig({ endpoint: 'http://127.0.0.1:9999/', token }).endpoint).toBe(
    'http://127.0.0.1:9999/',
  );
  expect(() => relayConfig({ endpoint: 'https://relay.example.test', token: 'short' })).toThrow();
});
it('preserves confirmed SQLite result codes across workers without treating quota errors as rolled-back SQL constraints', () => {
  const constraint = Object.assign(new Error('custom trigger failure'), {
    name: 'SQLite3Error',
    resultCode: 1811,
  });
  expect(isSqliteConstraint(fromWire(wireError(constraint)))).toBe(true);
  expect(
    isSqliteConstraint(fromWire(wireError(new DOMException('Full', 'QuotaExceededError')))),
  ).toBe(false);
  expect(isSqliteConstraint(new Error('SQLITE_CONSTRAINT text alone is insufficient'))).toBe(false);
});
