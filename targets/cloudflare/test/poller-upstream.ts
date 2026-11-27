export interface PollerCall {
  path: string;
  etag: string | null;
  modified: string | null;
}
const calls: PollerCall[] = [];
let releaseVersion = 0;
let holdEnabled = true;
export async function pollerUpstream(request: Request) {
  const path = new URL(request.url).pathname;
  if (path === '/__review/release') {
    releaseVersion++;
    holdEnabled = false;
    return new Response(null, { status: 204 });
  }
  if (path === '/__review/stats') return Response.json(calls);
  if (path === '/__review/reset') {
    calls.length = 0;
    holdEnabled = true;
    return new Response(null, { status: 204 });
  }
  calls.push({
    path,
    etag: request.headers.get('if-none-match'),
    modified: request.headers.get('if-modified-since'),
  });
  if (holdEnabled && path.startsWith('/hold/')) {
    const version = releaseVersion;
    // Native timers keep this request alive. A promise resolved only by another
    // request is intentionally rejected as stalled I/O by workerd.
    while (version === releaseVersion) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (path.startsWith('/redirect/'))
    return new Response('redirect', {
      status: 302,
      headers: { location: path.replace('/redirect/', '/feed/') },
    });
  if (path.startsWith('/chain/')) {
    const parts = path.split('/'),
      hops = Number(parts[3]);
    if (hops)
      return new Response(null, {
        status: 302,
        headers: { location: `/chain/${parts[2]}/${hops - 1}` },
      });
  }
  if (path === '/gone') return new Response('gone', { status: 410 });
  if (path === '/invalid')
    return new Response('<rss><channel>', { headers: { 'content-type': 'application/rss+xml' } });
  if (path === '/cached' && request.headers.has('if-none-match'))
    return new Response(null, { status: 304 });
  if (path === '/webhook') return new Response(null, { status: 204 });
  if (path === '/webhook-fail') return new Response('controlled failure', { status: 503 });
  if (path.startsWith('/slow/')) await new Promise((resolve) => setTimeout(resolve, 100));
  if (path === '/atom')
    return new Response(
      '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom journal</title><entry><id>atom-1</id><title>Atom article</title><link href="https://source.test/atom-article"/><updated>2026-11-27T11:00:00Z</updated><content type="html">&lt;p&gt;Atom content&lt;/p&gt;</content></entry></feed>',
      { headers: { 'content-type': 'application/atom+xml' } },
    );
  const busy = path === '/busy';
  const items = path.endsWith('/quiet')
    ? []
    : Array.from({ length: path === '/bulk' ? 120 : busy ? 11 : 1 }, (_, index) => ({
        id: `${path}-${index}`,
        url: `https://source.test/articles${path}-${index}`,
        title: `Brew article ${path}-${index}`,
        content_html: '<p>Keep this.</p><script>unsafe()</script>',
        date_published: '2026-11-27T11:00:00Z',
      }));
  return Response.json(
    {
      version: 'https://jsonfeed.org/version/1.1',
      title: `Journal ${path}`,
      home_page_url: 'https://source.test',
      items,
    },
    { headers: { etag: '"v1"', 'last-modified': 'Fri, 27 Nov 2026 11:00:00 GMT' } },
  );
}
export default { fetch: pollerUpstream };
