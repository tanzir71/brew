import { createHash } from 'node:crypto';
import type { BrewDatabase } from '../db/database.js';
import type {
  ReadActionTarget,
  ReadActionPreview,
} from '../../../../packages/core/src/read-actions.js';
import { ActionError } from '../../../../packages/core/src/actions.js';
import { readerNewsletterVisibility } from '../ports/newsletter-visibility.js';

type Row = { id: number; readAt: number | null };
export class ReadActions {
  constructor(
    private readonly database: BrewDatabase,
    private readonly now: () => Date,
  ) {}
  inspect(target: ReadActionTarget): { ids: number[]; preview: ReadActionPreview } {
    return this.database.sqlite.transaction(() => {
      let rows: Row[] = [];
      if (target.kind === 'items') {
        for (let offset = 0; offset < target.ids.length; offset += 500) {
          const ids = target.ids.slice(offset, offset + 500);
          rows.push(
            ...(this.database.sqlite
              .prepare(
                `SELECT id,read_at AS readAt FROM articles WHERE id IN (${ids.map(() => '?').join(',')})`,
              )
              .all(...ids) as Row[]),
          );
        }
      } else {
        if (
          target.feedId &&
          !this.database.sqlite.prepare('SELECT id FROM feeds WHERE id=?').get(target.feedId)
        )
          throw new ActionError(404, 'Feed not found.');
        if (
          target.folderId &&
          !this.database.sqlite.prepare('SELECT id FROM folders WHERE id=?').get(target.folderId)
        )
          throw new ActionError(404, 'Folder not found.');
        const clauses = ['a.hidden=0', 'a.read_at IS NULL', 'f.muted=0'];
        const args: number[] = [];
        if (target.view !== 'starred' && target.feedId === undefined)
          clauses.push(readerNewsletterVisibility);
        if (target.view === 'today') {
          clauses.push('a.published_at>=?');
          args.push(this.now().getTime() - 86_400_000);
        }
        if (target.view === 'starred') clauses.push('a.starred_at IS NOT NULL');
        if (target.feedId !== undefined) {
          clauses.push('a.feed_id=?');
          args.push(target.feedId);
        }
        if (target.folderId !== undefined) {
          clauses.push('f.folder_id=?');
          args.push(target.folderId);
        }
        rows = this.database.sqlite
          .prepare(
            `SELECT a.id,a.read_at AS readAt FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE ${clauses.join(' AND ')} ORDER BY a.id`,
          )
          .all(...args) as Row[];
      }
      rows.sort((a, b) => a.id - b.id);
      const ids = rows.filter((row) => row.readAt === null).map((row) => row.id);
      return {
        ids,
        preview: {
          revision: createHash('sha256').update(JSON.stringify({ target, rows })).digest('hex'),
          updated: ids.length,
          unavailable: target.kind === 'items' ? target.ids.length - rows.length : 0,
        },
      };
    })();
  }
  apply(ids: number[]): void {
    const update = this.database.sqlite.prepare(
      'UPDATE articles SET read_at=? WHERE id=? AND read_at IS NULL',
    );
    const at = this.now().getTime();
    for (const id of ids) update.run(at, id);
  }
}
