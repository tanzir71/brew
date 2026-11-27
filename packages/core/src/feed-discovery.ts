import { DOMParser } from 'linkedom';
import type { FeedCandidate } from './types/api.js';
import type { XmlFeedParserPort } from './feed-parser.js';
type Fetch = typeof globalThis.fetch;
export function createFeedDiscovery(xml: XmlFeedParserPort, fetcher: Fetch = globalThis.fetch) {
  const feedMimeTypes = [
    'application/rss+xml',
    'application/atom+xml',
    'application/feed+json',
    'application/json',
    'text/xml',
    'application/xml',
  ];

  interface ParsedFeed {
    title: string;
    description: string | null;
    siteUrl: string | null;
    type: FeedCandidate['type'];
  }

  function normalizedUrl(value: string): string {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('Only HTTP and HTTPS URLs are supported');
    url.hash = '';
    return url.toString();
  }

  async function parseFeed(body: string, contentType = ''): Promise<ParsedFeed | null> {
    const trimmed = body.trimStart();
    if (contentType.includes('json') || trimmed.startsWith('{')) {
      try {
        const value = JSON.parse(body) as {
          version?: unknown;
          title?: unknown;
          home_page_url?: unknown;
          description?: unknown;
          items?: unknown;
        };
        if (
          typeof value.version === 'string' &&
          value.version.includes('jsonfeed.org') &&
          Array.isArray(value.items)
        ) {
          return {
            title: typeof value.title === 'string' ? value.title : 'Untitled feed',
            description: typeof value.description === 'string' ? value.description : null,
            siteUrl: typeof value.home_page_url === 'string' ? value.home_page_url : null,
            type: 'json',
          };
        }
      } catch {
        return null;
      }
    }
    if (!trimmed.startsWith('<')) return null;
    try {
      const parsed = await xml.parse(body);
      const atom = /<feed[\s>]/i.test(body);
      if (!parsed.items || (!parsed.title && parsed.items.length === 0)) return null;
      return {
        title: parsed.title?.trim() || 'Untitled feed',
        description: parsed.description?.trim() || null,
        siteUrl: parsed.link || null,
        type: atom ? 'atom' : 'rss',
      };
    } catch {
      return null;
    }
  }

  async function fetchCandidate(
    fetcher: Fetch,
    url: string,
  ): Promise<{ candidate: FeedCandidate; metadata: ParsedFeed } | null> {
    try {
      const response = await fetcher(url, {
        headers: { Accept: [...feedMimeTypes, 'text/html;q=0.8'].join(', ') },
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const body = await response.text();
      const metadata = await parseFeed(body, response.headers.get('content-type') ?? '');
      if (!metadata) return null;
      const finalUrl = normalizedUrl(response.url || url);
      return { candidate: { url: finalUrl, title: metadata.title, type: metadata.type }, metadata };
    } catch {
      return null;
    }
  }

  return {
    async discover(input: string): Promise<FeedCandidate[]> {
      const url = normalizedUrl(input);
      const direct = await fetcher(url, {
        headers: { Accept: [...feedMimeTypes, 'text/html;q=0.8'].join(', ') },
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
      if (!direct.ok) throw new Error(`URL returned HTTP ${direct.status}`);
      const body = await direct.text();
      const directMetadata = await parseFeed(body, direct.headers.get('content-type') ?? '');
      if (directMetadata)
        return [
          {
            url: normalizedUrl(direct.url || url),
            title: directMetadata.title,
            type: directMetadata.type,
          },
        ];

      const document = new DOMParser().parseFromString(body, 'text/html');
      const discovered = [...document.querySelectorAll('link[rel~="alternate"]')]
        .filter((element) =>
          feedMimeTypes.some((type) =>
            (element.getAttribute('type') ?? '').toLowerCase().includes(type),
          ),
        )
        .map((element) => element.getAttribute('href'))
        .filter((href): href is string => Boolean(href))
        .map((href) => new URL(href, direct.url || url).toString());
      const origin = new URL(direct.url || url).origin;
      discovered.push(
        ...['/feed', '/rss.xml', '/atom.xml', '/index.xml'].map((candidatePath) =>
          new URL(candidatePath, origin).toString(),
        ),
      );
      const unique = [...new Set(discovered.map(normalizedUrl))].slice(0, 12);
      const results = await Promise.all(
        unique.map((candidate) => fetchCandidate(fetcher, candidate)),
      );
      return results
        .filter((result): result is NonNullable<typeof result> => result !== null)
        .map(({ candidate }) => candidate);
    },
    async prepare(input: string) {
      const result = await fetchCandidate(fetcher, normalizedUrl(input));
      if (!result) throw new Error('The selected URL is not a valid RSS, Atom, or JSON feed');
      return result;
    },
  };
}
