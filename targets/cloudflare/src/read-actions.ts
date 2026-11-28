import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlReadActions } from '../../../packages/db/src/sql-read-actions.js';
export { sqlSha256 as cloudflareSha256 } from '../../../packages/db/src/sql-read-actions.js';
export class CloudflareReadActions extends SqlReadActions<D1PreparedStatement> {  }
