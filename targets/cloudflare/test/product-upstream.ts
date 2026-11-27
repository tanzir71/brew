import { pollerUpstream } from './poller-upstream.js';
let keys: unknown;
let status = 200;
const calls: string[] = [];
const deliveries: { key: string | null; body: string }[] = [];
export default {
  async fetch(request: Request, env: { JWKS: string }) {
    const path = new URL(request.url).pathname;
    if (path === '/__review/reset') {
      calls.length = 0;
      deliveries.length = 0;
      keys = undefined;
      status = 200;
      return new Response(null, { status: 204 });
    }
    if (path === '/__review/stats') return Response.json(calls);
    if (path === '/__review/deliveries') return Response.json(deliveries);
    if (path === '/__review/keys') {
      const value = (await request.json()) as { keys: unknown; status?: number };
      keys = value.keys;
      status = value.status ?? 200;
      return new Response(null, { status: 204 });
    }
    calls.push(path);
    if (path === '/webhook')
      deliveries.push({ key: request.headers.get('idempotency-key'), body: await request.text() });
    if (path === '/cdn-cgi/access/certs')
      return Response.json(keys ?? JSON.parse(env.JWKS), { status });
    if (path === '/image.png')
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' },
      });
    return pollerUpstream(request);
  },
};
