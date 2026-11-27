import {
  ReaderSyncError,
  type ReaderSyncStoragePort,
  type SyncMetadata,
  type SyncQuery,
  type SyncPatch,
} from '../../../packages/core/src/reader-sync.js';
import {
  syncFeedsQuery,
  syncSummaryQuery,
  syncFrom,
  syncWhere,
  syncItemsQuery,
  syncItemPage,
  type SyncRow,
} from '../../../packages/db/src/reader-sync-queries.js';
import { CloudflareStorage } from './storage.js';
import { libraryRevision } from './events.js';

const access = '(? IS NULL OR EXISTS(SELECT 1 FROM reader_access WHERE id=1 AND generation=?))';
export class CloudflareReaderSyncStorage implements ReaderSyncStoragePort {
  constructor(
    private storage: CloudflareStorage,
    public now: () => number = Date.now,
  ) {}
  async metadata(): Promise<SyncMetadata> {
    const result = await this.storage.batch([
      this.storage.statement(syncFeedsQuery),
      this.storage.statement('SELECT id,title FROM folders ORDER BY id'),
      this.storage.statement('SELECT id,name FROM tags ORDER BY id'),
      this.storage.statement(syncSummaryQuery),
    ]);
    return {
      feeds: result[0]!.results,
      folders: result[1]!.results,
      tags: result[2]!.results,
      ...result[3]!.results[0],
    } as unknown as SyncMetadata;
  }
  async items(query: SyncQuery) {
    const built = syncItemsQuery(query);
    // The label selector repeats the same page inside this atomic read batch.
    // One JSON binding handles 10000 selected IDs without D1's parameter limit.
    const result = await this.storage.batch([
      this.storage.statement(built.count.sql, built.count.values),
      this.storage.statement(built.rows.sql, built.rows.values),
      this.storage.statement(
        `SELECT at.article_id AS id,t.name FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE ${query.idsOnly ? '0' : `at.article_id IN (SELECT id FROM (${built.rows.sql}) LIMIT ?)`} ORDER BY t.name`,
        query.idsOnly ? [] : [...built.rows.values, built.limit],
      ),
    ]);
    return syncItemPage(
      result[1]!.results as unknown as SyncRow[],
      Number(result[0]!.results[0]!.n),
      query,
      result[2]!.results as unknown as Array<{ id: number; name: string }>,
    );
  }
  async stateIds(state: 'unread' | 'starred') {
    const built = syncWhere({ streams: [{ kind: state }] });
    return (
      await this.storage.all<{ id: number }>(
        `SELECT a.id ${syncFrom} WHERE ${built.clause} ORDER BY a.id`,
        built.values,
      )
    ).map((row) => row.id);
  }
  async notify() {
    await this.storage.batch([libraryRevision(this.storage)]);
  }
  async editFeed(
    id: number,
    title: string,
    folderId: number | null | undefined,
    generation: string,
  ) {
    if (!title.trim() || title.length > 200)
      throw new ReaderSyncError(400, 'Choose a feed title of 1–200 characters.');
    const result = await this.storage.batch([
      this.storage.statement(`SELECT 1 AS authorized WHERE ${access}`, [generation, generation]),
      this.storage.statement(
        `UPDATE feeds SET title=?${folderId === undefined ? '' : ',folder_id=?'} WHERE id=? AND ${access}`,
        [title.trim(), ...(folderId === undefined ? [] : [folderId]), id, generation, generation],
      ),
      this.storage.statement(
        `INSERT INTO settings(key,value) SELECT 'library_revision','1' WHERE ${access} ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1`,
        [generation, generation],
      ),
    ]);
    if (!result[0]!.results.length)
      throw new ReaderSyncError(403, 'Reader access has changed. Sign in again.');
  }
  async change(query: SyncQuery, patch: SyncPatch) {
    const built = syncWhere(query),
      token = `reader_change:${crypto.randomUUID()}`;
    const assignments: string[] = [],
      bindings: unknown[] = [],
      differences: string[] = [],
      differentValues: unknown[] = [];
    for (const [field, column] of [
      ['read', 'read_at'],
      ['starred', 'starred_at'],
    ] as const)
      if (patch[field] !== undefined) {
        assignments.push(`${column}=${patch[field] ? `coalesce(${column},?)` : 'NULL'}`);
        if (patch[field]) bindings.push(this.now());
        differences.push(`a.${column} IS ${patch[field] ? '' : 'NOT '}NULL`);
      }
    const stateDifferences = [...differences];
    if (patch.add?.length) {
      differences.push(
        'EXISTS(SELECT 1 FROM json_each(?) names WHERE NOT EXISTS(SELECT 1 FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id=a.id AND t.name=names.value))',
      );
      differentValues.push(JSON.stringify(patch.add));
    }
    if (patch.remove?.length) {
      differences.push(
        'EXISTS(SELECT 1 FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id=a.id AND t.name IN (SELECT value FROM json_each(?)))',
      );
      differentValues.push(JSON.stringify(patch.remove));
    }
    const selected =
      "SELECT selected.value FROM settings,json_each(settings.value,'$.selected') selected WHERE settings.key=?";
    const statements = [
      this.storage.statement(
        `WITH selected AS (SELECT a.id,(${differences.join(' OR ') || '0'}) AS modified ${syncFrom} WHERE ${built.clause}) INSERT INTO settings(key,value) SELECT ?,json_object('selected',json((SELECT json_group_array(id) FROM selected)),'modified',json((SELECT json_group_array(id) FROM selected WHERE modified))) WHERE ${access} RETURNING value`,
        [
          ...differentValues,
          ...built.values,
          token,
          query.generation ?? null,
          query.generation ?? null,
        ],
      ),
    ];
    if (assignments.length)
      statements.push(
        this.storage.statement(
          `UPDATE articles AS a SET ${assignments.join(',')} WHERE id IN (${selected}) AND (${stateDifferences.join(' OR ')})`,
          [...bindings, token],
        ),
      );
    if (patch.add?.length) {
      statements.push(
        this.storage.statement(
          `INSERT OR IGNORE INTO tags(name,color) SELECT DISTINCT value,'#d97706' FROM json_each(?) WHERE EXISTS(${selected})`,
          [JSON.stringify(patch.add), token],
        ),
      );
      statements.push(
        this.storage.statement(
          `INSERT OR IGNORE INTO article_tags(article_id,tag_id) SELECT selected.value,t.id FROM settings,json_each(settings.value,'$.selected') selected CROSS JOIN tags t WHERE settings.key=? AND t.name IN (SELECT value FROM json_each(?))`,
          [token, JSON.stringify(patch.add)],
        ),
      );
    }
    if (patch.remove?.length)
      statements.push(
        this.storage.statement(
          `DELETE FROM article_tags WHERE article_id IN (${selected}) AND tag_id IN (SELECT id FROM tags WHERE name IN (SELECT value FROM json_each(?)))`,
          [token, JSON.stringify(patch.remove)],
        ),
      );
    statements.push(
      this.storage.statement(
        "INSERT INTO settings(key,value) SELECT 'library_revision','1' FROM settings WHERE key=? AND json_array_length(value,'$.modified')>0 ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1",
        [token],
      ),
    );
    statements.push(this.storage.statement('DELETE FROM settings WHERE key=?', [token]));
    const result = await this.storage.batch(statements);
    if (!result[0]!.results.length)
      throw new ReaderSyncError(403, 'Reader access has changed. Sign in again.');
    return (JSON.parse(String(result[0]!.results[0]!.value)) as { modified: number[] }).modified
      .length;
  }
  async label(
    action: 'create' | 'rename' | 'remove',
    name: string,
    destination?: string,
    generation?: string,
  ) {
    const token = `reader_label:${crypto.randomUUID()}`;
    const exists =
      'EXISTS(SELECT 1 FROM folders WHERE title=?) OR EXISTS(SELECT 1 FROM tags WHERE name=?)';
    const result = await this.storage.batch([
      this.storage.statement(
        `INSERT INTO settings(key,value) SELECT ?,CASE
        WHEN NOT ${access} THEN '403'
        WHEN ?<>'create' AND NOT (${exists}) THEN '404'
        WHEN ?='rename' AND (? IS NULL OR ?='') THEN '400'
        WHEN ?='rename' AND ?<>? AND EXISTS(SELECT 1 FROM tags WHERE name=?) AND ?>100 THEN '400'
        WHEN ?='rename' AND ?<>? AND (${exists}) THEN '409'
        ELSE 'ok' END RETURNING value`,
        [
          token,
          generation ?? null,
          generation ?? null,
          action,
          name,
          name,
          action,
          destination ?? null,
          destination ?? null,
          action,
          name,
          destination ?? null,
          name,
          destination?.length ?? 0,
          action,
          name,
          destination ?? null,
          destination ?? null,
          destination ?? null,
        ],
      ),
      this.storage.statement(
        "INSERT INTO folders(title) SELECT ? WHERE ?='create' AND NOT EXISTS(SELECT 1 FROM folders WHERE title=?) AND EXISTS(SELECT 1 FROM settings WHERE key=? AND value='ok')",
        [name, action, name, token],
      ),
      this.storage.statement(
        "UPDATE folders SET title=? WHERE title=? AND title<>? AND ?='rename' AND EXISTS(SELECT 1 FROM settings WHERE key=? AND value='ok')",
        [destination ?? name, name, destination ?? name, action, token],
      ),
      this.storage.statement(
        "UPDATE tags SET name=? WHERE name=? AND name<>? AND ?='rename' AND EXISTS(SELECT 1 FROM settings WHERE key=? AND value='ok')",
        [destination ?? name, name, destination ?? name, action, token],
      ),
      this.storage.statement(
        "DELETE FROM folders WHERE title=? AND ?='remove' AND EXISTS(SELECT 1 FROM settings WHERE key=? AND value='ok')",
        [name, action, token],
      ),
      this.storage.statement(
        "DELETE FROM tags WHERE name=? AND ?='remove' AND EXISTS(SELECT 1 FROM settings WHERE key=? AND value='ok')",
        [name, action, token],
      ),
      this.storage.statement(
        "INSERT INTO settings(key,value) SELECT 'library_revision','1' WHERE EXISTS(SELECT 1 FROM settings WHERE key=? AND value='ok') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1",
        [token],
      ),
      this.storage.statement('DELETE FROM settings WHERE key=?', [token]),
    ]);
    const status = String(result[0]!.results[0]!.value);
    if (status === '403')
      throw new ReaderSyncError(403, 'Reader access has changed. Sign in again.');
    if (status === '404') throw new ReaderSyncError(404, 'Reader label not found.');
    if (status === '409') throw new ReaderSyncError(409, 'That reader label already exists.');
    if (status === '400')
      throw new ReaderSyncError(
        400,
        destination
          ? 'Article tag names must have at most 100 characters.'
          : 'Choose a destination label.',
      );
  }
}
