import type { WireError } from './errors.js';
import type { SqlValue } from '@sqlite.org/sqlite-wasm';
import type { ArchiveRows } from '../../../packages/db/src/archive-sql.js';

export type Persistence = 'opfs' | 'indexeddb';
export interface OpenOptions {
  name?: string;
  persistence?: 'auto' | Persistence;
}
export interface Query {
  sql: string;
  params?: SqlValue[];
}
export interface QueryResult {
  columns: string[];
  rows: SqlValue[][];
  changes: number;
}
export type Operation =
  | { kind: 'open'; options: OpenOptions }
  | { kind: 'execute'; queries: Query[] }
  | { kind: 'archive-replace'; rows: ArchiveRows }
  | { kind: 'begin' | 'commit' | 'rollback' | 'export' | 'archive-snapshot' | 'close' };
export interface Request {
  id: number;
  operation: Operation;
}
export type Response =
  { id: number; ok: true; value: unknown } | { id: number; ok: false; error: WireError };
