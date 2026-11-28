import type { WireError } from './errors.js';
import type { Query, QueryResult } from './protocol.js';
import type { RelayConfig } from './relay.js';

export type LibraryOperation =
  | { kind: 'initialize' }
  | { kind: 'configure'; config: RelayConfig | null }
  | { kind: 'refresh'; feedId?: number }
  | { kind: 'close' };
export type LibraryReply = { id: number } & (
  { ok: true; value: unknown } | { ok: false; error: WireError }
);
export type WorkerRequest =
  | { kind: 'sql'; id: number; queries: Query[] }
  | { kind: 'notify'; id: number; article: { id: number; title: string; url: string } };
export type WorkerReply = { kind: 'reply'; id: number } & (
  { ok: true; value: QueryResult[] | undefined } | { ok: false; error: WireError }
);
