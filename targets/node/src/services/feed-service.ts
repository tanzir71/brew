import { asc, eq } from 'drizzle-orm';
import { DOMParser } from 'linkedom';
import Parser from 'rss-parser';
import type { FeedCandidate, FeedSummary, FolderSummary } from '@brew/core/types/api.js';
import type { BrewDatabase } from '../db/database.js';
import { feeds, folders } from '../db/schema.js';

type Fetch = typeof globalThis.fetch;
const parser = new Parser();
const feedMimeTypes = ['application/rss+xml', 'application/atom+xml', 'application/feed+json', 'application/json', 'text/xml', 'application/xml'];

interface ParsedFeed { title: string; description: string | null; siteUrl: string | null; type: FeedCandidate['type'] }

function normalizedUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported');
  url.hash = '';
  return url.toString();
}

async function parseFeed(body: string, contentType = ''): Promise<ParsedFeed | null> {
  const trimmed = body.trimStart();
  if (contentType.includes('json') || trimmed.startsWith('{')) {
    try {
      const value = JSON.parse(body) as { version?: unknown; title?: unknown; home_page_url?: unknown; description?: unknown; items?: unknown };
      if (typeof value.version === 'string' && value.version.includes('jsonfeed.org') && Array.isArray(value.items)) {
        return { title: typeof value.title === 'string' ? value.title : 'Untitled feed', description: typeof value.description === 'string' ? value.description : null, siteUrl: typeof value.home_page_url === 'string' ? value.home_page_url : null, type: 'json' };
      }
    } catch { return null; }
  }
  if (!trimmed.startsWith('<')) return null;
  try {
    const parsed = await parser.parseString(body);
    const atom = /<feed[\s>]/i.test(body);
    if (!parsed.items || (!parsed.title && parsed.items.length === 0)) return null;
    return { title: parsed.title?.trim() || 'Untitled feed', description: parsed.description?.trim() || null, siteUrl: parsed.link || null, type: atom ? 'atom' : 'rss' };
  } catch { return null; }
}

async function fetchCandidate(fetcher: Fetch, url: string): Promise<{ candidate: FeedCandidate; metadata: ParsedFeed } | null> {
  try {
    const response = await fetcher(url, { headers: { Accept: [...feedMimeTypes, 'text/html;q=0.8'].join(', ') }, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const body = await response.text();
    const metadata = await parseFeed(body, response.headers.get('content-type') ?? '');
    if (!metadata) return null;
    const finalUrl = normalizedUrl(response.url || url);
    return { candidate: { url: finalUrl, title: metadata.title, type: metadata.type }, metadata };
  } catch { return null; }
}

export class FeedService {
  constructor(private readonly database: BrewDatabase, private readonly fetcher: Fetch = globalThis.fetch) {}

  listFeeds(): FeedSummary[] {
    const warningThreshold = Date.now() - 7 * 86_400_000;
    return this.database.db.select().from(feeds).orderBy(asc(feeds.title)).all().map((feed) => ({ id: feed.id, folderId: feed.folderId, url: feed.url, siteUrl: feed.siteUrl, title: feed.title, description: feed.description, fetchIntervalMinutes: feed.fetchIntervalMinutes, retentionDays:feed.retentionDays,lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null, lastStatus: feed.lastStatus, consecutiveFailures: feed.consecutiveFailures, failingSince: feed.failingSince?.toISOString() ?? null, healthWarning: Boolean(feed.failingSince && feed.failingSince.getTime() <= warningThreshold) }));
  }
  listFolders(): FolderSummary[] { return this.database.db.select({ id: folders.id, title: folders.title, position: folders.position }).from(folders).orderBy(asc(folders.position), asc(folders.title)).all(); }

  async discover(input: string): Promise<FeedCandidate[]> {
    const url = normalizedUrl(input);
    const direct = await this.fetcher(url, { headers: { Accept: [...feedMimeTypes, 'text/html;q=0.8'].join(', ') }, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    if (!direct.ok) throw new Error(`URL returned HTTP ${direct.status}`);
    const body = await direct.text();
    const directMetadata = await parseFeed(body, direct.headers.get('content-type') ?? '');
    if (directMetadata) return [{ url: normalizedUrl(direct.url || url), title: directMetadata.title, type: directMetadata.type }];

    const document = new DOMParser().parseFromString(body, 'text/html');
    const discovered = [...document.querySelectorAll('link[rel~="alternate"]')]
      .filter((element) => feedMimeTypes.some((type) => (element.getAttribute('type') ?? '').toLowerCase().includes(type)))
      .map((element) => element.getAttribute('href'))
      .filter((href): href is string => Boolean(href))
      .map((href) => new URL(href, direct.url || url).toString());
    const origin = new URL(direct.url || url).origin;
    discovered.push(...['/feed', '/rss.xml', '/atom.xml', '/index.xml'].map((candidatePath) => new URL(candidatePath, origin).toString()));
    const unique = [...new Set(discovered.map(normalizedUrl))].slice(0, 12);
    const results = await Promise.all(unique.map((candidate) => fetchCandidate(this.fetcher, candidate)));
    return results.filter((result): result is NonNullable<typeof result> => result !== null).map(({ candidate }) => candidate);
  }

  async add(url: string, folderId: number | null = null): Promise<FeedSummary> {
    const result = await fetchCandidate(this.fetcher, normalizedUrl(url));
    if (!result) throw new Error('The selected URL is not a valid RSS, Atom, or JSON feed');
    if (folderId !== null && !this.database.db.select({ id: folders.id }).from(folders).where(eq(folders.id, folderId)).get()) throw new Error('Folder not found');
    const inserted = this.database.db.insert(feeds).values({ folderId, url: result.candidate.url, title: result.metadata.title, description: result.metadata.description, siteUrl: result.metadata.siteUrl }).returning().get();
    return { id: inserted.id, folderId: inserted.folderId, url: inserted.url, siteUrl: inserted.siteUrl, title: inserted.title, description: inserted.description, fetchIntervalMinutes: inserted.fetchIntervalMinutes,retentionDays:inserted.retentionDays, lastFetchedAt: null, lastStatus: null, consecutiveFailures: 0, failingSince: null, healthWarning: false };
  }

  renameFeed(id: number, title: string, folderId?: number | null): FeedSummary | undefined {
    const values: { title: string; folderId?: number | null } = { title: title.trim() };
    if (folderId !== undefined) values.folderId = folderId;
    const row = this.database.db.update(feeds).set(values).where(eq(feeds.id, id)).returning().get();
    return row && { id: row.id, folderId: row.folderId, url: row.url, siteUrl: row.siteUrl, title: row.title, description: row.description, fetchIntervalMinutes: row.fetchIntervalMinutes,retentionDays:row.retentionDays, lastFetchedAt: row.lastFetchedAt?.toISOString() ?? null, lastStatus: row.lastStatus, consecutiveFailures: row.consecutiveFailures, failingSince: row.failingSince?.toISOString() ?? null, healthWarning: Boolean(row.failingSince && row.failingSince.getTime() <= Date.now() - 7 * 86_400_000) };
  }
  deleteFeed(id: number): boolean { return this.database.db.delete(feeds).where(eq(feeds.id, id)).run().changes > 0; }
  setRetention(id:number,days:number):FeedSummary|undefined { if(!Number.isInteger(days)||days<1||days>3650)throw new Error('Retention must be 1–3650 days');const row=this.database.db.update(feeds).set({retentionDays:days}).where(eq(feeds.id,id)).returning().get();return row?this.listFeeds().find((feed)=>feed.id===id):undefined; }
  createFolder(title: string): FolderSummary { const max = this.listFolders().at(-1)?.position ?? -1; return this.database.db.insert(folders).values({ title: title.trim(), position: max + 1 }).returning().get(); }
  renameFolder(id: number, title: string): FolderSummary | undefined { return this.database.db.update(folders).set({ title: title.trim() }).where(eq(folders.id, id)).returning().get(); }
  deleteFolder(id: number): boolean { return this.database.db.delete(folders).where(eq(folders.id, id)).run().changes > 0; }
}
