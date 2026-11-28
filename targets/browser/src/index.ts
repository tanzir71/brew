import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import type { SqlValue } from '@sqlite.org/sqlite-wasm';
import { schema } from '../../../packages/db/src/schema.js';
import type {
  OpenOptions,
  Operation,
  Persistence,
  Query,
  QueryResult,
  Response,
} from './protocol.js';

export type BrowserDrizzle = Omit<SqliteRemoteDatabase<typeof schema>, 'transaction'>;
export type { OpenOptions, Persistence, Query, QueryResult } from './protocol.js';
export { schema };

class Channel {
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private dead = false;
  constructor(private readonly worker: Worker) {
    worker.onmessage = ({ data }: MessageEvent<Response>) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.ok) pending.resolve(data.value);
      else pending.reject(Object.assign(new Error(data.error.message), { name: data.error.name }));
    };
    worker.onerror = (event) =>
      this.stop(new Error(event.message || 'Browser storage worker failed.'));
    worker.onmessageerror = () =>
      this.stop(new Error('Browser storage returned an unreadable message.'));
  }
  request<T>(operation: Operation): Promise<T> {
    if (this.dead) return Promise.reject(new Error('Browser storage is closed.'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try {
        this.worker.postMessage({ id, operation });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  stop(error = new Error('Browser storage is closed.')) {
    this.dead = true;
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export class BrowserDatabase {
  readonly db: BrowserDrizzle;
  private queue = Promise.resolve();
  private closing = false;
  private constructor(
    private readonly channel: Channel,
    readonly persistence: Persistence,
    readonly sqliteVersion: string,
    readonly migrations: number,
  ) {
    this.db = this.makeDrizzle((queries) => this.execute(queries));
  }
  static async open(options: OpenOptions = {}): Promise<BrowserDatabase> {
    const channel = new Channel(
      new Worker(new URL('./database.worker.ts', import.meta.url), { type: 'module' }),
    );
    try {
      const result = await channel.request<{
        persistence: Persistence;
        sqliteVersion: string;
        migrations: number;
      }>({ kind: 'open', options });
      return new BrowserDatabase(
        channel,
        result.persistence,
        result.sqliteVersion,
        result.migrations,
      );
    } catch (error) {
      channel.stop();
      throw error;
    }
  }
  private enqueue<T>(work: () => Promise<T>, closing = false): Promise<T> {
    if (this.closing && !closing) return Promise.reject(new Error('Browser storage is closed.'));
    const result = this.queue.then(work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  execute(queries: Query[]): Promise<QueryResult[]> {
    return this.enqueue(() => this.channel.request({ kind: 'execute', queries }));
  }
  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const [result] = await this.execute([{ sql, params }]);
    return result!.rows.map(
      (row) =>
        Object.fromEntries(result!.columns.map((column, index) => [column, row[index]])) as T,
    );
  }
  async first<T>(sql: string, params: SqlValue[] = []): Promise<T | null> {
    return (await this.all<T>(sql, params))[0] ?? null;
  }
  async run(sql: string, params: SqlValue[] = []): Promise<QueryResult> {
    return (await this.execute([{ sql, params }]))[0]!;
  }
  /** Serialize the entire callback, including awaited queries, against other clients of this connection. */
  transaction<T>(work: (db: BrowserDrizzle) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.channel.request({ kind: 'begin' });
      let active = true;
      try {
        const value = await work(
          this.makeDrizzle((queries) => {
            if (!active) return Promise.reject(new Error('The transaction scope is closed.'));
            return this.channel.request({ kind: 'execute', queries });
          }),
        );
        active = false;
        await this.channel.request({ kind: 'commit' });
        return value;
      } catch (error) {
        active = false;
        await this.channel.request({ kind: 'rollback' });
        throw error;
      }
    });
  }
  exportBytes(): Promise<Uint8Array<ArrayBuffer>> {
    return this.enqueue(() => this.channel.request({ kind: 'export' }));
  }
  close(): Promise<void> {
    if (this.closing) return this.queue;
    this.closing = true;
    return this.enqueue(async () => {
      try {
        await this.channel.request({ kind: 'close' });
      } finally {
        this.channel.stop();
      }
    }, true);
  }
  private makeDrizzle(execute: (queries: Query[]) => Promise<QueryResult[]>): BrowserDrizzle {
    const rows = (result: QueryResult, method: string) => ({
      rows: method === 'get' ? result.rows[0]! : result.rows,
    });
    const db = drizzle(
      async (sql, params, method) =>
        rows((await execute([{ sql, params: params as SqlValue[] }]))[0]!, method),
      async (batch) => {
        const result = await execute(
          batch.map(({ sql, params }) => ({ sql, params: params as SqlValue[] })),
        );
        return result.map((value, index) => rows(value, batch[index]!.method));
      },
      { schema },
    );
    Object.defineProperty(db, 'transaction', {
      value: () =>
        Promise.reject(
          new Error('Use BrowserDatabase.transaction() to serialize the whole callback.'),
        ),
    });
    return db;
  }
}

export const openBrowserDatabase = BrowserDatabase.open;
