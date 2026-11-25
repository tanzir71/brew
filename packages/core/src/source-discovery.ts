import { DOMParser } from 'linkedom';
import { parseFeedDocument, type XmlFeedParserPort } from './feed-parser.js';
import type { SourceCandidate, SourceDiscovery } from './types/sources.js';

export function sourceUrl(input: string): URL {
  const value = input.trim().replace(/^(feed|pcast):\/\//i, 'https://');
  const url = new URL(
    /^[a-z][a-z\d+.-]*:/i.test(value) && !/^[-\w.]+:\d+(?:\/|$)/.test(value)
      ? value
      : `https://${value}`,
  );
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Use an HTTP or HTTPS feed or website URL.');
  url.hash = '';
  return url;
}
export function nativeSource(input: string): {
  url: URL;
  kind: SourceDiscovery['kind'];
  needsYoutubeId?: boolean;
  podcastId?: string;
} {
  const url = sourceUrl(input);
  const host = url.hostname.replace(/^www\./, '');
  if (['youtube.com', 'm.youtube.com'].includes(host)) {
    const channel = url.pathname.match(/^\/channel\/(UC[\w-]+)/)?.[1];
    if (channel)
      return {
        url: new URL(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`),
        kind: 'youtube',
      };
    const playlist = url.searchParams.get('list');
    if (playlist && url.pathname === '/playlist')
      return {
        url: new URL(
          `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlist)}`,
        ),
        kind: 'youtube',
      };
    if (url.pathname === '/feeds/videos.xml') return { url, kind: 'youtube' };
    return { url, kind: 'youtube', needsYoutubeId: true };
  }
  if (['reddit.com', 'old.reddit.com'].includes(host) && /^\/r\/[\w+]+/.test(url.pathname))
    return {
      url: new URL(
        `https://www.reddit.com${url.pathname.replace(/\/?(?:\.rss)?\/?$/, '')}/.rss${url.search}`,
      ),
      kind: 'subreddit',
    };
  if (host === 'bsky.app' && /^\/profile\/[^/]+/.test(url.pathname))
    return {
      url: new URL(`https://bsky.app${url.pathname.match(/^\/profile\/[^/]+/)![0]}/rss`),
      kind: 'bluesky',
    };
  if (/^\/@[^/]+(?:\.rss)?\/?$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/$/, '').replace(/\.rss$/, '') + '.rss';
    return { url, kind: 'mastodon' };
  }
  if (['podcasts.apple.com', 'itunes.apple.com'].includes(host))
    return { url, kind: 'podcast', podcastId: url.pathname.match(/\/id(\d+)/)?.[1] };
  return {
    url,
    kind: /^(feed|pcast):/i.test(input) || /podcast/i.test(url.pathname) ? 'podcast' : 'web',
  };
}
const types = [
  'application/rss+xml',
  'application/atom+xml',
  'application/feed+json',
  'application/json',
  'text/xml',
  'application/xml',
];
export class SourceDiscoveryService {
  constructor(
    private fetcher: typeof fetch,
    private xml: XmlFeedParserPort,
  ) {}
  private async get(url: string) {
    const response = await this.fetcher(url, {
      headers: { Accept: [...types, 'text/html;q=0.8'].join(', ') },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`URL returned HTTP ${response.status}`);
    return {
      body: await response.text(),
      url: sourceUrl(response.url || url).toString(),
      type: response.headers.get('content-type') ?? '',
    };
  }
  private async candidate(page: {
    body: string;
    url: string;
    type: string;
  }): Promise<SourceCandidate | null> {
    try {
      // Unknown publication dates must not become an invented posting cadence.
      const parsed = await parseFeedDocument(page.body, page.type, this.xml, () => new Date(0));
      const times = parsed.articles
        .map((item) => item.publishedAt.getTime())
        .filter((time) => time !== 0)
        .sort((a, b) => b - a);
      const span = times.length > 1 ? (times[0]! - times.at(-1)!) / (times.length - 1) : 0;
      const cadence =
        span > 0
          ? span < 86_400_000
            ? `about ${Math.max(1, Math.round(86_400_000 / span))} a day`
            : span < 604_800_000 * 1.5
              ? `about ${Math.max(1, Math.round(604_800_000 / span))} a week`
              : undefined
          : undefined;
      return {
        url: page.url,
        title: parsed.title,
        type: page.body.trimStart().startsWith('{')
          ? 'json'
          : /<feed[\s>]/i.test(page.body)
            ? 'atom'
            : 'rss',
        ...(cadence ? { cadence } : {}),
      };
    } catch {
      return null;
    }
  }
  async discover(input: string): Promise<SourceDiscovery> {
    const original = sourceUrl(input);
    const resolved = nativeSource(input);
    const result: SourceDiscovery = {
      inputUrl: original.toString(),
      kind: resolved.kind,
      candidates: [],
    };
    let url = resolved.url;
    if (resolved.podcastId) {
      const lookup = await this.get(
        `https://itunes.apple.com/lookup?id=${resolved.podcastId}&entity=podcast`,
      );
      const data = JSON.parse(lookup.body) as { results?: Array<{ feedUrl?: string }> };
      const feed = data.results?.find((item) => item.feedUrl)?.feedUrl;
      if (!feed)
        throw new Error('This podcast did not publish a feed URL. Paste its publisher’s RSS URL.');
      url = sourceUrl(feed);
    }
    let page;
    try {
      page = await this.get(url.toString());
    } catch (error) {
      if (result.kind === 'subreddit')
        return {
          ...result,
          notice:
            'Reddit no longer supports native RSS. Paste a feed URL from a relay you control.',
        };
      throw error;
    }
    if (resolved.needsYoutubeId) {
      const document = new DOMParser().parseFromString(page.body, 'text/html');
      const channel =
        document.querySelector('meta[itemprop="channelId"]')?.getAttribute('content') ??
        page.body.match(/"(?:channelId|externalId)"\s*:\s*"(UC[\w-]+)"/)?.[1];
      const alternate = [...document.querySelectorAll('link[rel~="alternate"]')]
        .map((node) => node.getAttribute('href'))
        .find((href) => href?.includes('/feeds/videos.xml'));
      if (!channel && !alternate)
        throw new Error(
          'Could not resolve this YouTube channel. Paste its channel or native feed URL.',
        );
      page = await this.get(
        alternate
          ? new URL(alternate, page.url).toString()
          : `https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`,
      );
    }
    const direct = await this.candidate(page);
    if (direct) {
      result.candidates = [direct];
      return result;
    }
    if (result.kind !== 'web' && result.kind !== 'podcast') {
      result.notice = 'No native feed was available. Paste a working RSS, Atom, or JSON Feed URL.';
      return result;
    }
    const document = new DOMParser().parseFromString(page.body, 'text/html');
    const name =
      document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ??
      document.querySelector('title')?.textContent?.split(/[|–—]/)[0]?.trim() ??
      original.hostname;
    const subscription = [...document.querySelectorAll('a[href]')].some(
      (node) =>
        /newsletter/i.test((node.textContent ?? '') + ' ' + node.getAttribute('href')) ||
        (/subscribe/i.test((node.textContent ?? '') + ' ' + node.getAttribute('href')) &&
          /email/i.test(node.textContent ?? '')),
    );
    if (
      subscription ||
      (document.querySelector('input[type="email"]') && /newsletter|subscribe/i.test(page.body))
    )
      result.newsletter = { title: name };
    const links = [...document.querySelectorAll('link[rel~="alternate"]')]
      .filter((node) =>
        types.some((type) => (node.getAttribute('type') ?? '').toLowerCase().includes(type)),
      )
      .map((node) => node.getAttribute('href'))
      .filter((href): href is string => !!href);
    const base = document.querySelector('base[href]')?.getAttribute('href');
    const baseUrl = base ? new URL(base, page.url).toString() : page.url;
    const urls = [
      ...new Set([
        ...links.map((href) => new URL(href, baseUrl).toString()),
        ...['/feed', '/rss.xml', '/atom.xml', '/index.xml'].map((path) =>
          new URL(path, page.url).toString(),
        ),
      ]),
    ]
      .filter((value) => {
        try {
          sourceUrl(value);
          return true;
        } catch {
          return false;
        }
      })
      .slice(0, 12);
    const candidates = await Promise.all(
      urls.map(async (value) => {
        try {
          return await this.candidate(await this.get(value));
        } catch {
          return null;
        }
      }),
    );
    result.candidates = [
      ...new Map(
        candidates
          .filter((value): value is SourceCandidate => value !== null)
          .map((value) => [value.url, value]),
      ).values(),
    ];
    if (!result.candidates.length)
      result.notice = 'No feeds found. Paste a direct RSS, Atom, or JSON Feed URL.';
    return result;
  }
}
