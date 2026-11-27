const calls: Array<{ path: string; body: unknown }> = [];
let held = false;
export async function actionsUpstream(request: Request) {
  const path = new URL(request.url).pathname;
  if (path === '/reset') {
    calls.length = 0;
    held = false;
    return new Response(null, { status: 204 });
  }
  if (path === '/stats') return Response.json(calls);
  if (path === '/release') {
    held = false;
    return new Response(null, { status: 204 });
  }
  if (request.method === 'POST') {
    calls.push({ path, body: await request.json() });
    if (path === '/hold' && calls.filter((call) => call.path === path).length === 1) {
      held = true;
      const deadline = Date.now() + 4000;
      while (held && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return new Response(null, { status: path === '/fail' ? 503 : 204 });
  }
  return new Response(
    '<rss version="2.0"><channel><title>Added source</title><link>https://source.example.test</link><description>Test</description></channel></rss>',
    { headers: { 'content-type': 'application/rss+xml' } },
  );
}
export default { fetch: actionsUpstream };
