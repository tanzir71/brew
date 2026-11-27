import type { ReadActionTarget } from '../../core/src/read-actions.js';
import { readerNewsletterVisibility } from './reader-queries.js';
export interface ReadActionRow {
  id: number;
  readAt: number | null;
}
export function readActionQuery(target: ReadActionTarget, at: number) {
  if (target.kind === 'items')
    return {
      sql: 'SELECT id,read_at AS readAt FROM articles WHERE id IN(SELECT value FROM json_each(?)) ORDER BY id',
      values: [JSON.stringify(target.ids)] as unknown[],
    };
  const clauses = ['a.hidden=0', 'a.read_at IS NULL', 'f.muted=0'],
    values: unknown[] = [];
  if (target.view !== 'starred' && target.feedId === undefined)
    clauses.push(readerNewsletterVisibility);
  if (target.view === 'today') {
    clauses.push('a.published_at>=?');
    values.push(at - 86400000);
  }
  if (target.view === 'starred') clauses.push('a.starred_at IS NOT NULL');
  if (target.feedId !== undefined) {
    clauses.push('a.feed_id=?');
    values.push(target.feedId);
  }
  if (target.folderId !== undefined) {
    clauses.push('f.folder_id=?');
    values.push(target.folderId);
  }
  return {
    sql: `SELECT a.id,a.read_at AS readAt FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE ${clauses.join(' AND ')} ORDER BY a.id`,
    values,
  };
}
export function readActionPlan(target: ReadActionTarget, rows: ReadActionRow[]) {
  return {
    ids: rows.filter((row) => row.readAt === null).map((row) => row.id),
    revisionInput: JSON.stringify({ target, rows }),
    unavailable: target.kind === 'items' ? target.ids.length - rows.length : 0,
  };
}
