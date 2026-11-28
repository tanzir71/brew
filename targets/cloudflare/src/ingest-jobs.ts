import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlIngestJobs } from '../../../packages/db/src/sql-ingest-jobs.js';
import { CloudflareStorage } from './storage.js';
import { isD1Constraint } from './sqlite-errors.js';
export class CloudflareIngestJobs extends SqlIngestJobs<D1PreparedStatement> {
  constructor(storage: CloudflareStorage) {
    super(storage, isD1Constraint);
  }
}
