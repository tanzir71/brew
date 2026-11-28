import type Database from 'better-sqlite3';
import { LibraryFence } from '../../../../packages/db/src/library-fence.js';

interface Admission {
  fence: LibraryFence;
  depth: number;
}
const admissions = new WeakMap<Database.Database, Admission>();

/** Old request scopes must not read replacement rows that happen to reuse the same IDs. */
export function fenceLibrary(database: Database.Database) {
  const prepare = database.prepare.bind(database);
  const connection = {
    all: <T>(sql: string, values: unknown[] = []) => prepare(sql).all(...values) as T[],
    run: (sql: string, values: unknown[] = []) => {
      prepare(sql).run(...values);
    },
  };
  const fence = new LibraryFence(connection);
  const admission = { fence, depth: 0 };
  admissions.set(database, admission);
  const epoch = prepare('SELECT epoch FROM __brew_library_identity WHERE id=1');
  const checked = <T>(work: () => T): T => {
    if ((epoch.get() as { epoch: string } | undefined)?.epoch !== fence.epoch)
      throw new Error('The library was imported. Reopen Brew before accessing it.');
    return work();
  };
  // Check and query share one SQLite snapshot, including across another process's import.
  const snapshot = database.transaction((work: () => unknown) => checked(work));
  const begin = prepare('BEGIN');
  const commit = prepare('COMMIT');
  const rollback = prepare('ROLLBACK');
  const read = <T>(work: () => T): T => {
    if (admission.depth) return work();
    return database.inTransaction ? checked(work) : (snapshot(work) as T);
  };
  database.prepare = ((sql: string) => {
    const statement = prepare(sql);
    const proxy = new Proxy(statement, {
      get(target, key) {
        const member: unknown = Reflect.get(target, key, target);
        if (typeof member !== 'function') return member;
        if (key === 'get' || key === 'all')
          return (...args: unknown[]) => read(() => Reflect.apply(member, target, args));
        if (key === 'iterate')
          return function* (...args: unknown[]) {
            // Keep the checked read snapshot until the native cursor is closed. SQLite cannot
            // commit or execute the epoch query while better-sqlite3's iterator is active.
            const own = !database.inTransaction;
            if (own) begin.run();
            let failed = false;
            try {
              if (!admission.depth) checked(() => undefined);
              const iterator = Reflect.apply(member, target, args) as IterableIterator<unknown>;
              try {
                yield* iterator;
              } finally {
                iterator.return?.();
              }
            } catch (error) {
              failed = true;
              throw error;
            } finally {
              if (own && database.inTransaction) (failed ? rollback : commit).run();
            }
          };
        return (...args: unknown[]) => {
          const result: unknown = Reflect.apply(member, target, args);
          return result === target ? proxy : result;
        };
      },
    });
    return proxy;
  }) as typeof database.prepare;
}

/** Only the synchronous archive owner bypasses guards, never an asynchronous request. */
export function withArchiveWrite<T>(database: Database.Database, work: () => T): T {
  const admission = admissions.get(database);
  if (!admission) return work();
  admission.depth++;
  try {
    return admission.fence.privileged(work);
  } finally {
    admission.depth--;
  }
}
