import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlApiData } from '../../../packages/db/src/sql-api-data.js';
export class CloudflareApiData extends SqlApiData<D1PreparedStatement> {  }
