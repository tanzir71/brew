import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlSearch } from '../../../packages/db/src/sql-search-service.js';
export class CloudflareSearch extends SqlSearch<D1PreparedStatement> {  }
