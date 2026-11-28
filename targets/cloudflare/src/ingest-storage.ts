import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { SqlIngestStorage } from '../../../packages/db/src/sql-ingest-storage.js';
export type {
  StorageAdmission,
  IngestAdmission,
} from '../../../packages/db/src/sql-ingest-storage.js';
export class CloudflareIngestStorage extends SqlIngestStorage<D1PreparedStatement> {}
