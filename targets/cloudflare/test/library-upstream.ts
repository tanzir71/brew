const calls: Array<{ path: string; body: unknown }> = [];
export async function libraryUpstream(request: Request) {
  const path = new URL(request.url).pathname;
  if (path === '/stats') return Response.json(calls);
  if (request.method === 'POST') {
    calls.push({ path, body: await request.json() });
    return new Response(null, {
      status:
        path === '/retry' && calls.filter((call) => call.path === path).length === 1 ? 503 : 204,
    });
  }
  if (path === '/website')
    return new Response(
      '<html><head><link rel="alternate" type="application/rss+xml" href="/rss"></head></html>',
      { headers: { 'content-type': 'text/html' } },
    );
  return new Response(
    '<?xml version="1.0"?><rss version="2.0"><channel><title>Discovered design</title><link>https://source.example.test</link><description>Design journal</description><item><guid>sample</guid><title>Sample story</title><link>https://source.example.test/story</link></item></channel></rss>',
    { headers: { 'content-type': 'application/rss+xml' } },
  );
}
export default { fetch: libraryUpstream };
