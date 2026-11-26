import type { BrewDatabase } from '../db/database.js';
import {
  ReaderSyncError,
  type ReaderSyncStoragePort,
  type SyncItem,
  type SyncMetadata,
  type SyncPatch,
  type SyncQuery,
  type SyncStream,
} from '../../../../packages/core/src/reader-sync.js';
import { readerNewsletterVisibility } from './newsletter-visibility.js';

type Row = Omit<SyncItem, 'read' | 'starred' | 'tags'> & { read: number; starred: number };
const from =
  'FROM articles a JOIN feeds f ON f.id=a.feed_id LEFT JOIN folders fo ON fo.id=f.folder_id';
export class NodeReaderSyncStorage implements ReaderSyncStoragePort {
  constructor(
    private database: BrewDatabase,
    public now: () => number = Date.now,
    private changed: () => void = () => {},
  ) {}
  metadata(): SyncMetadata {
    const feeds = this.database.sqlite
      .prepare(
        `SELECT f.id,f.title,f.url,f.site_url AS siteUrl,f.folder_id AS folderId,f.favicon_url AS faviconUrl,coalesce(f.last_fetched_at,f.created_at) AS updated, count(CASE WHEN a.hidden=0 AND a.read_at IS NULL AND ${readerNewsletterVisibility} THEN 1 END) AS unread FROM feeds f LEFT JOIN articles a ON a.feed_id=f.id GROUP BY f.id ORDER BY f.id`,
      )
      .all() as SyncMetadata['feeds'];
    const summary = this.database.sqlite
      .prepare(
        `SELECT count(*) AS totalItems,count(CASE WHEN a.read_at IS NULL THEN 1 END) AS totalUnread,coalesce(max(CASE WHEN a.read_at IS NULL THEN a.published_at END),0) AS newestUnread ${from} WHERE a.hidden=0 AND ${readerNewsletterVisibility}`,
      )
      .get() as Pick<SyncMetadata, 'totalItems' | 'totalUnread' | 'newestUnread'>;
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
  private where(query: SyncQuery) {
    const values: unknown[] = [],
      clauses = ['a.hidden=0'];
    const stream = (s: SyncStream): string => {
      if (s.kind === 'all') return '1';
      if (s.kind === 'read') return 'a.read_at IS NOT NULL';
      if (s.kind === 'unread') return 'a.read_at IS NULL';
      if (s.kind === 'starred') return 'a.starred_at IS NOT NULL';
      if (s.kind === 'feed') {
        values.push(s.id);
        return 'a.feed_id=?';
      }
      if (s.kind === 'folder') {
        values.push(s.id);
        return 'f.folder_id=?';
      }
      if (s.kind !== 'label') throw new ReaderSyncError(400, 'Unsupported reader stream.');
      values.push(s.name, s.name);
      return '(fo.title=? OR EXISTS(SELECT 1 FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id=a.id AND t.name=?))';
    };
    if (!query.ids && !query.streams?.some((s) => s.kind === 'feed'))
      clauses.push(readerNewsletterVisibility);
    if (query.streams?.length) clauses.push(`(${query.streams.map(stream).join(' OR ')})`);
    for (const excluded of query.exclude ?? []) clauses.push(`NOT (${stream(excluded)})`);
    if (query.ids) {
      clauses.push(query.ids.length ? `a.id IN (${query.ids.map(() => '?').join(',')})` : '0');
      values.push(...query.ids);
    }
    for (const [key, comparison, column] of [
      ['after', '>', 'published_at'],
      ['before', '<', 'published_at'],
      ['fetchedAfter', '>=', 'fetched_at'],
      ['fetchedBefore', '<', 'fetched_at'],
      ['afterId', '>', 'id'],
      ['beforeId', '<', 'id'],
    ] as const)
      if (query[key] !== undefined) {
        clauses.push(`a.${column}${comparison}?`);
        values.push(query[key]);
      }
    return { values, clause: clauses.map((value) => `(${value})`).join(' AND ') };
  }
  items(query: SyncQuery) {
    const { values, clause } = this.where(query);
    const count = this.database.sqlite
      .prepare(`SELECT count(*) AS n ${from} WHERE ${clause}`)
      .get(...values) as { n: number };
    const pagination: unknown[] = [],
      limit = query.limit ?? 1000,
      oldest = query.oldest === true;
    let boundary = '';
    if (query.cursor) {
      const match = /^bs1:([on]):(-?\d+):([1-9]\d*)$/.exec(query.cursor);
      if (
        !match ||
        (match[1] === 'o') !== oldest ||
        !Number.isSafeInteger(Number(match[2])) ||
        !Number.isSafeInteger(Number(match[3]))
      )
        throw new ReaderSyncError(400, 'Invalid reader continuation.');
      const comparison = oldest ? '>' : '<';
      boundary = ` AND (a.published_at${comparison}? OR (a.published_at=? AND a.id${comparison}?))`;
      pagination.push(Number(match[2]), Number(match[2]), Number(match[3]));
    }
    const rows = this.database.sqlite
      .prepare(
        `SELECT a.id,a.feed_id AS feedId,a.title,a.author,a.url,${query.idsOnly ? "''" : "coalesce(a.full_text_html,a.content_html,a.summary_html,'')"} AS html,a.published_at AS published,a.fetched_at AS fetched,a.read_at IS NOT NULL AS read,a.starred_at IS NOT NULL AS starred,f.title AS feedTitle,f.url AS feedUrl,f.site_url AS siteUrl,fo.title AS folder ${from} WHERE ${clause}${boundary} ORDER BY ${query.byId ? 'a.id' : 'a.published_at'} ${oldest ? 'ASC' : 'DESC'}, a.id ${oldest ? 'ASC' : 'DESC'} LIMIT ?`,
      )
      .all(...values, ...pagination, limit + 1) as Row[];
    const page = rows.slice(0, limit),
      labels = new Map<number, string[]>();
    if (page.length && !query.idsOnly) {
      const tags = this.database.sqlite
        .prepare(
          `SELECT at.article_id AS id,t.name FROM article_tags at JOIN tags t ON t.id=at.tag_id WHERE at.article_id IN (${page.map(() => '?').join(',')}) ORDER BY t.name`,
        )
        .all(...page.map((row) => row.id)) as Array<{ id: number; name: string }>;
      for (const tag of tags) labels.set(tag.id, [...(labels.get(tag.id) ?? []), tag.name]);
    }
    const last = page.at(-1);
    return {
      total: count.n,
      items: page.map((row) => ({
        ...row,
        read: Boolean(row.read),
        starred: Boolean(row.starred),
        tags: labels.get(row.id) ?? [],
      })),
      ...(rows.length > limit && last
        ? { continuation: `bs1:${oldest ? 'o' : 'n'}:${last.published}:${last.id}` }
        : {}),
    };
  }
  stateIds(state: 'unread' | 'starred') {
    const { values, clause } = this.where({ streams: [{ kind: state }] });
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
    const { values, clause } = this.where(query);
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
