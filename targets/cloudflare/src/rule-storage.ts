import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlRuleStorage } from '../../../packages/db/src/sql-rule-storage.js';
import { CloudflareStorage } from './storage.js';
import { isD1Constraint } from './sqlite-errors.js';
export class CloudflareRuleStorage extends SqlRuleStorage<D1PreparedStatement> {
  constructor(storage: CloudflareStorage) {
    super(storage, isD1Constraint);
  }
}
