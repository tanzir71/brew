export function sourceNetwork() {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url === 'https://lowtide.news/')
      return new Response(
        '<html><head><title>Low Tide</title><meta property="og:site_name" content="Low Tide"><link rel="alternate" type="application/atom+xml" href="/essays.xml"><link rel="alternate" type="application/rss+xml" href="/links.xml"></head><body><a href="/subscribe">Subscribe by email</a></body></html>',
      );
    if (url === 'https://lowtide.news/essays.xml')
      return new Response(
        '<feed xmlns="http://www.w3.org/2005/Atom"><title>Low Tide · Essays</title><id>urn:lowtide:essays</id><updated>2026-11-25T00:00:00Z</updated><entry><id>urn:a</id><title>Figma without the noise</title><link href="https://lowtide.news/a"/><updated>2026-11-25T00:00:00Z</updated></entry><entry><id>urn:b</id><title>Quiet work</title><link href="https://lowtide.news/b"/><updated>2026-11-18T00:00:00Z</updated></entry></feed>',
        { headers: { 'content-type': 'application/atom+xml' } },
      );
    if (url === 'https://lowtide.news/links.xml')
      return new Response(
        '<rss version="2.0"><channel><title>Low Tide · Links</title><link>https://lowtide.news</link><item><guid>c</guid><title>One link</title><link>https://lowtide.news/c</link><pubDate>Wed, 25 Nov 2026 00:00:00 GMT</pubDate></item><item><guid>d</guid><title>Another link</title><link>https://lowtide.news/d</link><pubDate>Tue, 24 Nov 2026 20:00:00 GMT</pubDate></item></channel></rss>',
        { headers: { 'content-type': 'application/rss+xml' } },
      );
    return new Response('', { status: 404 });
  };
  return { fetcher, urls };
}
