import { pollerUpstream } from './poller-upstream.js';
let keys: unknown;
let status = 200;
const calls: string[] = [];
const deliveries: { key: string | null; body: string }[] = [];
const emails: {
  url: string;
  authorization: string | null;
  agent: string | null;
  key: string | null;
  assertion: string | null;
  body: unknown;
}[] = [];
let mailMode = 'ok';
export default {
  async fetch(request: Request, env: { JWKS: string }) {
    const path = new URL(request.url).pathname;
    if (path === '/__review/reset') {
      calls.length = 0;
      deliveries.length = 0;
      emails.length = 0;
      mailMode = 'ok';
      keys = undefined;
      status = 200;
      return new Response(null, { status: 204 });
    }
    if (path === '/__review/stats') return Response.json(calls);
    if (path === '/__review/deliveries') return Response.json(deliveries);
    if (path === '/__review/emails') return Response.json(emails);
    if (path === '/__review/mail-mode') {
      mailMode = ((await request.json()) as { mode: string }).mode;
      return new Response(null, { status: 204 });
    }
    if (path === '/__review/keys') {
      const value = (await request.json()) as { keys: unknown; status?: number };
      keys = value.keys;
      status = value.status ?? 200;
      return new Response(null, { status: 204 });
    }
    calls.push(path);
    if (path === '/emails') {
      emails.push({
        url: request.url,
        authorization: request.headers.get('authorization'),
        agent: request.headers.get('user-agent'),
        key: request.headers.get('idempotency-key'),
        assertion: request.headers.get('cf-access-jwt-assertion'),
        body: await request.json(),
      });
      if (mailMode === 'reject')
        return new Response('sensitive upstream mail rejection re_native_fixture', { status: 429 });
      if (mailMode === 'malformed') return Response.json({ accepted: true });
      if (mailMode === 'redirect')
        return new Response(null, {
          status: 307,
          headers: { location: 'https://source.test/stolen-mail' },
        });
      return Response.json({ id: `native-resend-${emails.length}` });
    }
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
