import { asc, eq } from 'drizzle-orm';
import { createFeedDiscovery } from '../../../../packages/core/src/feed-discovery.js';
import Parser from 'rss-parser';
import type { FeedCandidate, FeedSummary, FolderSummary } from '@brew/core/types/api.js';
import type { BrewDatabase } from '../db/database.js';
import { feeds, folders } from '../db/schema.js';

type Fetch = typeof globalThis.fetch;
const parser = new Parser();
export class FeedService {
  private readonly discovery;
  constructor(
    private readonly database: BrewDatabase,
    fetcher: Fetch = globalThis.fetch,
  ) {
    this.discovery = createFeedDiscovery({ parse: (body) => parser.parseString(body) }, fetcher);
  }

  listFeeds(): FeedSummary[] {
    const warningThreshold = Date.now() - 7 * 86_400_000;
    return this.database.db
      .select()
      .from(feeds)
      .orderBy(asc(feeds.title))
      .all()
      .map((feed) => ({
        id: feed.id,
        folderId: feed.folderId,
        url: feed.url,
        siteUrl: feed.siteUrl,
        title: feed.title,
        description: feed.description,
        fetchIntervalMinutes: feed.fetchIntervalMinutes,
        retentionDays: feed.retentionDays,
        lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
        lastStatus: feed.lastStatus,
        consecutiveFailures: feed.consecutiveFailures,
        failingSince: feed.failingSince?.toISOString() ?? null,
        healthWarning: Boolean(
          feed.failingSince && feed.failingSince.getTime() <= warningThreshold,
        ),
      }));
  }
  listFolders(): FolderSummary[] {
    return this.database.db
      .select({ id: folders.id, title: folders.title, position: folders.position })
      .from(folders)
      .orderBy(asc(folders.position), asc(folders.title))
      .all();
  }

  async discover(input: string): Promise<FeedCandidate[]> {
    return this.discovery.discover(input);
  }

  async add(url: string, folderId: number | null = null): Promise<FeedSummary> {
    return this.insertPrepared(await this.prepareAdd(url, folderId));
  }
  async prepareAdd(url: string, folderId: number | null = null) {
    return { result: await this.discovery.prepare(url), folderId };
  }

  insertPrepared({
    result,
    folderId,
  }: Awaited<ReturnType<FeedService['prepareAdd']>>): FeedSummary {
    if (
      folderId !== null &&
      !this.database.db
        .select({ id: folders.id })
        .from(folders)
        .where(eq(folders.id, folderId))
        .get()
    )
      throw new Error('Folder not found');
    const inserted = this.database.db
      .insert(feeds)
      .values({
        folderId,
        url: result.candidate.url,
        title: result.metadata.title,
        description: result.metadata.description,
        siteUrl: result.metadata.siteUrl,
      })
      .returning()
      .get();
    return {
      id: inserted.id,
      folderId: inserted.folderId,
      url: inserted.url,
      siteUrl: inserted.siteUrl,
      title: inserted.title,
      description: inserted.description,
      fetchIntervalMinutes: inserted.fetchIntervalMinutes,
      retentionDays: inserted.retentionDays,
      lastFetchedAt: null,
      lastStatus: null,
      consecutiveFailures: 0,
      failingSince: null,
      healthWarning: false,
    };
  }

  renameFeed(id: number, title: string, folderId?: number | null): FeedSummary | undefined {
    const values: { title: string; folderId?: number | null } = { title: title.trim() };
    if (folderId !== undefined) values.folderId = folderId;
    const row = this.database.db
      .update(feeds)
      .set(values)
      .where(eq(feeds.id, id))
      .returning()
      .get();
    return (
      row && {
        id: row.id,
        folderId: row.folderId,
        url: row.url,
        siteUrl: row.siteUrl,
        title: row.title,
        description: row.description,
        fetchIntervalMinutes: row.fetchIntervalMinutes,
        retentionDays: row.retentionDays,
        lastFetchedAt: row.lastFetchedAt?.toISOString() ?? null,
        lastStatus: row.lastStatus,
        consecutiveFailures: row.consecutiveFailures,
        failingSince: row.failingSince?.toISOString() ?? null,
        healthWarning: Boolean(
          row.failingSince && row.failingSince.getTime() <= Date.now() - 7 * 86_400_000,
        ),
      }
    );
  }
  deleteFeed(id: number): boolean {
    return this.database.db.delete(feeds).where(eq(feeds.id, id)).run().changes > 0;
  }
  setRetention(id: number, days: number): FeedSummary | undefined {
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new Error('Retention must be 1–3650 days');
    const row = this.database.db
      .update(feeds)
      .set({ retentionDays: days })
      .where(eq(feeds.id, id))
      .returning()
      .get();
    return row ? this.listFeeds().find((feed) => feed.id === id) : undefined;
  }
  createFolder(title: string): FolderSummary {
    const max = this.listFolders().at(-1)?.position ?? -1;
    return this.database.db
      .insert(folders)
      .values({ title: title.trim(), position: max + 1 })
      .returning()
      .get();
  }
  renameFolder(id: number, title: string): FolderSummary | undefined {
    return this.database.db
      .update(folders)
      .set({ title: title.trim() })
      .where(eq(folders.id, id))
      .returning()
      .get();
  }
  deleteFolder(id: number): boolean {
    return this.database.db.delete(folders).where(eq(folders.id, id)).run().changes > 0;
  }
}
