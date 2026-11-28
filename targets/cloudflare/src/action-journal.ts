import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlActionJournal } from '../../../packages/db/src/sql-action-journal.js';
export type { JournalSql, JournalTransaction } from '../../../packages/db/src/sql-action-journal.js';
export class CloudflareActionJournal extends SqlActionJournal<D1PreparedStatement> {  }
