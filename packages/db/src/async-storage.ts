/** Atomic SQL batches over a target-owned connection and durability boundary. */
export interface AsyncSqlStorage<Statement> {
  statement(sql: string, values?: unknown[]): Statement;
  first<T>(sql: string, values?: unknown[]): Promise<T | null>;
  all<T>(sql: string, values?: unknown[]): Promise<T[]>;
  run(sql: string, values?: unknown[]): Promise<{ meta: { changes: number } }>;
  batch<T = Record<string, unknown>>(
    statements: Statement[],
  ): Promise<Array<{ results: T[]; meta: { changes: number } }>>;
}

export function libraryRevision<S>(storage: AsyncSqlStorage<S>) {
  return storage.statement(
    "INSERT INTO settings(key,value) VALUES('library_revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1",
  );
}
