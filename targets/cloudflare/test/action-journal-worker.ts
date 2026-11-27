import type { D1Database } from '@cloudflare/workers-types';
import { CloudflareStorage } from '../src/storage.js';
import {
  CloudflareActionJournal,
  type JournalTransaction,
  type JournalSql,
} from '../src/action-journal.js';
import { ActionError } from '../../../packages/core/src/actions.js';

// Raw SQL and journal ingress exist only in this integration fixture.
// This is not a product Worker, action router or authorization boundary.
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    let statements = 0,
      largestBinding = 0;
    class MeasuredStorage extends CloudflareStorage {
      override statement(sql: string, values: unknown[] = []) {
        for (const value of values)
          if (typeof value === 'string')
            largestBinding = Math.max(largestBinding, new TextEncoder().encode(value).byteLength);
        return super.statement(sql, values);
      }
      override async batch<T = Record<string, unknown>>(
        queries: Parameters<CloudflareStorage['batch']>[0],
      ) {
        statements += queries.length;
        return super.batch<T>(queries);
      }
      override async all<T>(sql: string, values: unknown[] = []) {
        statements++;
        return super.all<T>(sql, values);
      }
    }
    const journal = new CloudflareActionJournal(new MeasuredStorage(env.DB));
    try {
      if (new URL(request.url).pathname === '/write')
        await journal.transaction((await request.json()) as JournalTransaction);
      else {
        const input = (await request.json()) as { id: number; at: number; after?: JournalSql[] };
        await journal.restore(input.id, input.at, { after: input.after });
      }
      return Response.json({ statements, largestBinding });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: error instanceof ActionError ? error.status : 500 },
      );
    }
  },
};
