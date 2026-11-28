import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlReader } from '../../../packages/db/src/sql-reader-service.js';
export class CloudflareReader extends SqlReader<D1PreparedStatement> {  }
