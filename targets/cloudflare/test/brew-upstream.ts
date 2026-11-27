const requests: Array<{ path: string; key: string | null; body: unknown }> = [];
export default {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === '/stats') return Response.json(requests);
    const key = request.headers.get('idempotency-key');
    const prior = requests.filter((item) => item.path === path && item.key === key).length;
    requests.push({ path, key, body: await request.json() });
    if (path === '/mail') return Response.json({ messageId: 'test-mail-id' });
    if (path === '/redirect')
      return new Response(null, {
        status: 307,
        headers: { location: 'https://elsewhere.example.test/unexpected' },
      });
    return new Response(null, { status: path === '/retry' && prior === 0 ? 503 : 204 });
  },
};
