import type { BrewDatabase } from '../db/database.js';
import {
  ReaderSyncError,
  type ReaderSyncStoragePort,
  type SyncMetadata,
  type SyncPatch,
  type SyncQuery,
} from '../../../../packages/core/src/reader-sync.js';
import {
  syncFrom as from,
  syncWhere,
  syncItemsQuery,
  syncLabelsQuery,
  syncItemPage,
  syncFeedsQuery,
  syncSummaryQuery,
  type SyncRow,
} from '../../../../packages/db/src/reader-sync-queries.js';

export class NodeReaderSyncStorage implements ReaderSyncStoragePort {
  constructor(
    private database: BrewDatabase,
    public now: () => number = Date.now,
    private changed: () => void = () => {},
  ) {}
  metadata(): SyncMetadata {
    const feeds = this.database.sqlite.prepare(syncFeedsQuery).all() as SyncMetadata['feeds'];
    const summary = this.database.sqlite.prepare(syncSummaryQuery).get() as Pick<
      SyncMetadata,
      'totalItems' | 'totalUnread' | 'newestUnread'
    >;
    return {
      feeds,
      folders: this.database.sqlite
        .prepare('SELECT id,title FROM folders ORDER BY id')
        .all() as SyncMetadata['folders'],
      tags: this.database.sqlite
        .prepare('SELECT id,name FROM tags ORDER BY id')
        .all() as SyncMetadata['tags'],
      ...summary,
    };
  }
  items(query: SyncQuery) {
    const built = syncItemsQuery(query);
    const count = this.database.sqlite.prepare(built.count.sql).get(...built.count.values) as {
      n: number;
    };
    const rows = this.database.sqlite
      .prepare(built.rows.sql)
      .all(...built.rows.values) as SyncRow[];
    const page = rows.slice(0, built.limit);
    const tags =
      page.length && !query.idsOnly
        ? (this.database.sqlite
            .prepare(syncLabelsQuery)
            .all(JSON.stringify(page.map((row) => row.id))) as Array<{ id: number; name: string }>)
        : [];
    return syncItemPage(rows, count.n, query, tags);
  }
  stateIds(state: 'unread' | 'starred') {
    const { values, clause } = syncWhere({ streams: [{ kind: state }] });
    return (
      this.database.sqlite
        .prepare(`SELECT a.id ${from} WHERE ${clause} ORDER BY a.id`)
        .all(...values) as Array<{ id: number }>
    ).map((row) => row.id);
  }
  private authorize(generation?: string) {
    if (
      generation !== undefined &&
      !this.database.sqlite
        .prepare('SELECT 1 FROM reader_access WHERE id=1 AND generation=?')
        .get(generation)
    )
      throw new ReaderSyncError(403, 'Reader access has changed. Sign in again.');
  }
  notify() {
    this.changed();
  }
  editFeed(id: number, title: string, folderId: number | null | undefined, generation: string) {
    if (!title.trim() || title.length > 200)
      throw new ReaderSyncError(400, 'Choose a feed title of 1–200 characters.');
    this.database.sqlite.transaction(() => {
      this.authorize(generation);
      if (folderId === undefined)
        this.database.sqlite.prepare('UPDATE feeds SET title=? WHERE id=?').run(title.trim(), id);
      else
        this.database.sqlite
          .prepare('UPDATE feeds SET title=?,folder_id=? WHERE id=?')
          .run(title.trim(), folderId, id);
    })();
    this.changed();
  }
  change(query: SyncQuery, patch: SyncPatch) {
    const { values, clause } = syncWhere(query);
    const result = this.database.sqlite.transaction(() => {
      this.authorize(query.generation);
      const rows = this.database.sqlite
        .prepare(`SELECT a.id ${from} WHERE ${clause}`)
        .all(...values) as Array<{ id: number }>;
      const modified = new Set<number>(),
        assignments: string[] = [],
        bindings: unknown[] = [],
        differences: string[] = [];
      for (const [field, column] of [
        ['read', 'read_at'],
        ['starred', 'starred_at'],
      ] as const)
        if (patch[field] !== undefined) {
          assignments.push(`${column}=${patch[field] ? `coalesce(${column},?)` : 'NULL'}`);
          if (patch[field]) bindings.push(this.now());
          differences.push(`${column} IS ${patch[field] ? '' : 'NOT '}NULL`);
        }
      const update = assignments.length
        ? this.database.sqlite.prepare(
            `UPDATE articles SET ${assignments.join(',')} WHERE id=? AND (${differences.join(' OR ')})`,
          )
        : null;
      const add = this.database.sqlite.prepare(
        'INSERT OR IGNORE INTO article_tags(article_id,tag_id) VALUES(?,?)',
      );
      const remove = this.database.sqlite.prepare(
        'DELETE FROM article_tags WHERE article_id=? AND tag_id IN (SELECT id FROM tags WHERE name=?)',
      );
      const tags = new Map<string, number>();
      if (rows.length)
        for (const name of patch.add ?? []) {
          this.database.sqlite
            .prepare("INSERT OR IGNORE INTO tags(name,color) VALUES(?,'#d97706')")
            .run(name);
          tags.set(
            name,
            (
              this.database.sqlite.prepare('SELECT id FROM tags WHERE name=?').get(name) as {
                id: number;
              }
            ).id,
          );
        }
      for (const row of rows) {
        if (update?.run(...bindings, row.id).changes) modified.add(row.id);
        for (const id of tags.values()) if (add.run(row.id, id).changes) modified.add(row.id);
        for (const name of patch.remove ?? [])
          if (remove.run(row.id, name).changes) modified.add(row.id);
      }
      return modified.size;
    })();
    if (result) this.changed();
    return result;
  }
  label(
    action: 'create' | 'rename' | 'remove',
    name: string,
    destination?: string,
    generation?: string,
  ) {
    this.database.sqlite.transaction(() => {
      this.authorize(generation);
      const folder = this.database.sqlite
        .prepare('SELECT id FROM folders WHERE title=?')
        .get(name) as { id: number } | undefined;
      const tag = this.database.sqlite.prepare('SELECT id FROM tags WHERE name=?').get(name) as
        { id: number } | undefined;
      if (action === 'create') {
        if (!folder) this.database.sqlite.prepare('INSERT INTO folders(title) VALUES(?)').run(name);
        return;
      }
      if (!folder && !tag) throw new ReaderSyncError(404, 'Reader label not found.');
      if (action === 'rename') {
        if (!destination) throw new ReaderSyncError(400, 'Choose a destination label.');
        if (name === destination) return;
        if (tag && destination.length > 100)
          throw new ReaderSyncError(400, 'Article tag names must have at most 100 characters.');
        if (
          this.database.sqlite
            .prepare(
              'SELECT 1 FROM folders WHERE title=? UNION ALL SELECT 1 FROM tags WHERE name=?',
            )
            .get(destination, destination)
        )
          throw new ReaderSyncError(409, 'That reader label already exists.');
        this.database.sqlite
          .prepare('UPDATE folders SET title=? WHERE title=?')
          .run(destination, name);
        this.database.sqlite.prepare('UPDATE tags SET name=? WHERE name=?').run(destination, name);
      } else {
        this.database.sqlite.prepare('DELETE FROM folders WHERE title=?').run(name);
        this.database.sqlite.prepare('DELETE FROM tags WHERE name=?').run(name);
      }
    })();
    this.changed();
  }
}
