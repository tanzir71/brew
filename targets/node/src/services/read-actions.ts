import { createHash } from 'node:crypto';
import type { BrewDatabase } from '../db/database.js';
import type {
  ReadActionTarget,
  ReadActionPreview,
} from '../../../../packages/core/src/read-actions.js';
import { ActionError } from '../../../../packages/core/src/actions.js';
import {
  readActionQuery,
  readActionPlan,
  type ReadActionRow as Row,
} from '../../../../packages/db/src/read-action-queries.js';

export class ReadActions {
  constructor(
    private readonly database: BrewDatabase,
    private readonly now: () => Date,
  ) {}
  inspect(target: ReadActionTarget): { ids: number[]; preview: ReadActionPreview } {
    return this.database.sqlite.transaction(() => {
      if (target.kind === 'reader') {
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
      }
      const query = readActionQuery(target, this.now().getTime());
      const rows = this.database.sqlite.prepare(query.sql).all(...query.values) as Row[];
      rows.sort((a, b) => a.id - b.id);
      const plan = readActionPlan(target, rows),
        ids = plan.ids;
      return {
        ids,
        preview: {
          revision: createHash('sha256').update(plan.revisionInput).digest('hex'),
          updated: ids.length,
          unavailable: plan.unavailable,
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
