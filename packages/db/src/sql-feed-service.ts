import type { XmlFeedParserPort } from '../../core/src/feed-parser.js';
import type { FeedApiPort } from '../../api/src/ports.js';
import type { FeedSummary, FolderSummary } from '../../core/src/types/api.js';
import { createFeedDiscovery } from '../../core/src/feed-discovery.js';
import type { AsyncSqlStorage } from './async-storage.js';
import { libraryRevision } from './async-storage.js';

type FeedRow = Omit<FeedSummary, 'lastFetchedAt' | 'failingSince' | 'healthWarning'> & {
  lastFetchedAt: number | null;
  failingSince: number | null;
};
const columns =
  'id,folder_id AS folderId,url,site_url AS siteUrl,title,description,fetch_interval_minutes AS fetchIntervalMinutes,retention_days AS retentionDays,last_fetched_at AS lastFetchedAt,last_status AS lastStatus,consecutive_failures AS consecutiveFailures,failing_since AS failingSince';
export class SqlFeeds<Statement> implements FeedApiPort {
  private discovery;
  constructor(
    private storage: AsyncSqlStorage<Statement>,
    parser: XmlFeedParserPort,
    fetcher: typeof fetch = globalThis.fetch,
    private now: () => Date = () => new Date(),
  ) {
    this.discovery = createFeedDiscovery({ parse: (body) => parser.parse(body) }, fetcher);
  }
  private summarize(row: FeedRow): FeedSummary {
    return {
      ...row,
      lastFetchedAt: row.lastFetchedAt === null ? null : new Date(row.lastFetchedAt).toISOString(),
      failingSince: row.failingSince === null ? null : new Date(row.failingSince).toISOString(),
      healthWarning:
        row.failingSince !== null && row.failingSince <= this.now().getTime() - 7 * 86_400_000,
    };
  }
  async listFeeds() {
    return (await this.storage.all<FeedRow>(`SELECT ${columns} FROM feeds ORDER BY title`)).map(
      (row) => this.summarize(row),
    );
  }
  async listFolders() {
    return this.storage.all<FolderSummary>(
      'SELECT id,title,position FROM folders ORDER BY position,title',
    );
  }
  async discover(url: string) {
    return this.discovery.discover(url);
  }
  private async get(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) return undefined;
    const row = await this.storage.first<FeedRow>(`SELECT ${columns} FROM feeds WHERE id=?`, [id]);
    return row ? this.summarize(row) : undefined;
  }
  async prepareAdd(url: string, folderId: number | null = null) {
    return { result: await this.discovery.prepare(url), folderId };
  }
  async add(url: string, folderId: number | null = null) {
    const prepared = (await this.prepareAdd(url, folderId)).result;
    if (
      folderId !== null &&
      !(await this.storage.first('SELECT id FROM folders WHERE id=?', [folderId]))
    )
      throw new Error('Folder not found');
    const result = await this.storage.batch<{ id: number }>([
      this.storage.statement(
        'INSERT INTO feeds(url,title,description,site_url,folder_id) VALUES(?,?,?,?,?) RETURNING id',
        [
          prepared.candidate.url,
          prepared.metadata.title,
          prepared.metadata.description,
          prepared.metadata.siteUrl,
          folderId,
        ],
      ),
      libraryRevision(this.storage),
    ]);
    return (await this.get(result[0]!.results[0]!.id))!;
  }
  async renameFeed(id: number, title: string, folderId?: number | null) {
    if (!Number.isSafeInteger(id) || id < 1) return undefined;
    const columns = ['title=?'],
      values: unknown[] = [title.trim()];
    if (folderId !== undefined) {
      columns.push('folder_id=?');
      values.push(folderId);
    }
    await this.storage.batch([
      this.storage.statement(`UPDATE feeds SET ${columns.join(',')} WHERE id=?`, [...values, id]),
      libraryRevision(this.storage),
    ]);
    return this.get(id);
  }
  async deleteFeed(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) return false;
    return (
      (
        await this.storage.batch([
          this.storage.statement('DELETE FROM feeds WHERE id=?', [id]),
          libraryRevision(this.storage),
        ])
      )[0]!.meta.changes > 0
    );
  }
  async setRetention(id: number, days: number) {
    if (!Number.isInteger(days) || days < 1 || days > 3650)
      throw new Error('Retention must be 1–3650 days');
    if (!Number.isSafeInteger(id) || id < 1) return undefined;
    await this.storage.batch([
      this.storage.statement('UPDATE feeds SET retention_days=? WHERE id=?', [days, id]),
      libraryRevision(this.storage),
    ]);
    return this.get(id);
  }
  async createFolder(title: string) {
    const result = await this.storage.batch<FolderSummary>([
      this.storage.statement(
        'INSERT INTO folders(title,position) SELECT ?,coalesce(max(position),-1)+1 FROM folders RETURNING id,title,position',
        [title.trim()],
      ),
      libraryRevision(this.storage),
    ]);
    return result[0]!.results[0]!;
  }
  async renameFolder(id: number, title: string) {
    if (!Number.isSafeInteger(id) || id < 1) return undefined;
    const result = await this.storage.batch<FolderSummary>([
      this.storage.statement('UPDATE folders SET title=? WHERE id=? RETURNING id,title,position', [
        title.trim(),
        id,
      ]),
      libraryRevision(this.storage),
    ]);
    return result[0]!.results[0];
  }
  async deleteFolder(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) return false;
    return (
      (
        await this.storage.batch([
          this.storage.statement('DELETE FROM folders WHERE id=?', [id]),
          libraryRevision(this.storage),
        ])
      )[0]!.meta.changes > 0
    );
  }
}
