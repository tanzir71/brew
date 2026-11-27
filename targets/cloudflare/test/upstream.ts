let images = 0;
export function upstreamResponse(request: Request) {
  const path = new URL(request.url).pathname;
  if (path === '/stats') return Response.json({ images });
  if (path === '/image.png' || path === '/favicon.ico') {
    images++;
    const data = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',
      ),
      (value) => value.charCodeAt(0),
    );
    return new Response(data, { headers: { 'content-type': 'image/png' } });
  }
  if (path.endsWith('/rss'))
    return new Response(
      '<?xml version="1.0"?><rss version="2.0"><channel><title>Discovered journal</title><link>https://source.example.test</link><description>New feed</description><item><guid>new-story</guid><title>New story</title><link>https://source.example.test/story</link></item></channel></rss>',
      { headers: { 'content-type': 'application/rss+xml' } },
    );
  const paragraph =
    'Thoughtful design gives people room to read, reflect and decide. A quiet interface supports a careful reading habit with useful context and accessible controls. ';
  return new Response(
    `<!doctype html><html><head><title>A readable story</title></head><body><article><h1>A readable story</h1>${Array.from({ length: 12 }, () => `<p>${paragraph}</p>`).join('')}<a href="/relative">More</a><img src="/image.png"><script>unsafe()</script></article></body></html>`,
    { headers: { 'content-type': 'text/html' } },
  );
}
export default { fetch: upstreamResponse };
