import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlBrewStorage } from '../../../packages/db/src/sql-brew-storage.js';
export class CloudflareBrewStorage extends SqlBrewStorage<D1PreparedStatement> {  }
