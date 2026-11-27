import { ActionError } from '../../../packages/core/src/actions.js';
import type { ReadActionTarget } from '../../../packages/core/src/read-actions.js';
import {
  readActionQuery,
  readActionPlan,
  type ReadActionRow,
} from '../../../packages/db/src/read-action-queries.js';
import { CloudflareStorage } from './storage.js';

export async function cloudflareSha256(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}
export class CloudflareReadActions {
  constructor(
    private storage: CloudflareStorage,
    private now: () => Date,
  ) {}
  async inspect(target: ReadActionTarget) {
    const query = readActionQuery(target, this.now().getTime());
    const guards: Array<{ sql: string; values: unknown[] }> = [];
    if (target.kind === 'reader')
      for (const [field, table] of [
        ['feedId', 'feeds'],
        ['folderId', 'folders'],
      ] as const)
        if (target[field] !== undefined) {
          const id = target[field]!;
          if (!(await this.storage.first(`SELECT id FROM ${table} WHERE id=?`, [id])))
            throw new ActionError(
              404,
              field === 'feedId' ? 'Feed not found.' : 'Folder not found.',
            );
          guards.push({ sql: `EXISTS(SELECT 1 FROM ${table} WHERE id=?)`, values: [id] });
        }
    const rows = await this.storage.all<ReadActionRow>(query.sql, query.values),
      plan = readActionPlan(target, rows);
    guards.push({
      sql: `(SELECT json_group_array(json_array(id,readAt)) FROM (${query.sql})) IS ?`,
      values: [...query.values, JSON.stringify(rows.map((row) => [row.id, row.readAt]))],
    });
    return {
      ids: plan.ids,
      preview: {
        revision: await cloudflareSha256(plan.revisionInput),
        updated: plan.ids.length,
        unavailable: plan.unavailable,
      },
      valid: {
        sql: guards.map((guard) => `(${guard.sql})`).join(' AND '),
        values: guards.flatMap((guard) => guard.values),
      },
    };
  }
}
