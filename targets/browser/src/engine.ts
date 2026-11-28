import type { Database, Sqlite3Static, SqlValue } from '@sqlite.org/sqlite-wasm';
import { migrateSqlite, type Migration } from '../../../packages/db/src/migrate.js';
import type { Query, QueryResult } from './protocol.js';

export type SnapshotCommit = (image: Uint8Array<ArrayBuffer>) => Promise<void>;

/** Synchronous SQLite remains inside the worker; persistence is acknowledged before callers resume. */
export class BrowserSqliteEngine {
  private transactionOpen = false;
  private dirty = false;
  private checkpoint?: Uint8Array<ArrayBuffer>;
  private publicQuery = false;
  constructor(
    readonly sqlite3: Sqlite3Static,
    private connection: Database,
    private readonly save?: SnapshotCommit,
  ) {
    this.configure();
  }

  private configure() {
    const { capi } = this.sqlite3;
    const denied = new Set<number>([
      capi.SQLITE_TRANSACTION,
      capi.SQLITE_SAVEPOINT,
      capi.SQLITE_ATTACH,
      capi.SQLITE_DETACH,
    ]);
    this.connection.checkRc(
      capi.sqlite3_set_authorizer(
        this.connection,
        (_context, action) =>
          this.publicQuery && denied.has(action) ? capi.SQLITE_DENY : capi.SQLITE_OK,
        0,
      ),
    );
  }

  private singleStatement(sql: string) {
    if (sql.includes('\0')) throw new Error('SQL statements cannot contain NUL characters.');
    if (!sql.includes(';')) return;
    const { wasm, capi } = this.sqlite3;
    const scope = wasm.scopedAllocPush();
    try {
      const [start, length] = wasm.scopedAllocCString(sql, true);
      const [statement, tail] = wasm.scopedAllocPtr(2);
      let position = start;
      let count = 0;
      while (position < start + length) {
        this.connection.checkRc(
          capi.sqlite3_prepare_v3(this.connection, position, -1, 0, statement!, tail!),
        );
        const prepared = wasm.peekPtr(statement!);
        if (prepared) {
          capi.sqlite3_finalize(prepared);
          if (++count > 1) throw new Error('Send one SQL statement per query.');
        }
        const next = wasm.peekPtr(tail!);
        if (next <= position) break;
        position = next;
      }
    } finally {
      wasm.scopedAllocPop(scope);
    }
  }

  image(): Uint8Array<ArrayBuffer> {
    if (this.transactionOpen) throw new Error('Cannot export an unfinished transaction.');
    return this.sqlite3.capi.sqlite3_js_db_export(this.connection);
  }

  static memory(sqlite3: Sqlite3Static, image?: Uint8Array): Database {
    const db = new sqlite3.oo1.DB();
    try {
      if (image) {
        const pointer = sqlite3.wasm.allocFromTypedArray(new Uint8Array(image));
        const rc = sqlite3.capi.sqlite3_deserialize(
          db,
          'main',
          pointer,
          image.byteLength,
          image.byteLength,
          sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
        );
        if (rc) {
          sqlite3.wasm.dealloc(pointer);
          db.checkRc(rc);
        }
      }
      db.exec('PRAGMA foreign_keys=ON');
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  async migrate(migrations: readonly Migration[], timezone: string) {
    this.checkpoint = this.save ? this.image() : undefined;
    try {
      this.connection.exec('PRAGMA foreign_keys=ON');
      migrateSqlite(
        {
          exec: (sql) => {
            this.connection.exec(sql);
          },
          all: <T>(sql: string, values: unknown[] = []) =>
            this.connection.selectObjects(sql, values as SqlValue[]) as T[],
          run: (sql, values) => {
            this.connection.exec({ sql, bind: values as SqlValue[] });
          },
          transaction: (work) => {
            this.connection.exec('BEGIN IMMEDIATE');
            try {
              work();
              this.connection.exec('COMMIT');
            } catch (error) {
              this.connection.exec('ROLLBACK');
              throw error;
            }
          },
        },
        migrations,
        timezone,
      );
      if (this.save) {
        const image = this.image();
        await this.save(image);
        this.checkpoint = image;
      }
    } catch (error) {
      this.restoreCheckpoint();
      throw error;
    }
  }

  begin() {
    if (this.transactionOpen) throw new Error('A transaction is already open.');
    this.connection.exec('BEGIN IMMEDIATE');
    this.transactionOpen = true;
    this.dirty = false;
  }
  async commit() {
    if (!this.transactionOpen) throw new Error('No transaction is open.');
    if (this.sqlite3.capi.sqlite3_get_autocommit(this.connection))
      throw new Error('The transaction was already rolled back.');
    this.connection.exec('COMMIT');
    this.transactionOpen = false;
    if (this.dirty && this.save) {
      try {
        const image = this.image();
        await this.save(image);
        this.checkpoint = image;
      } catch (error) {
        this.restoreCheckpoint();
        throw error;
      }
    }
    this.dirty = false;
  }
  rollback() {
    try {
      if (this.connection.isOpen() && !this.sqlite3.capi.sqlite3_get_autocommit(this.connection))
        this.connection.exec('ROLLBACK');
    } finally {
      this.transactionOpen = false;
      this.dirty = false;
    }
  }
  async execute(queries: readonly Query[]): Promise<QueryResult[]> {
    const own = !this.transactionOpen;
    if (!own && this.sqlite3.capi.sqlite3_get_autocommit(this.connection))
      throw new Error('The transaction was already rolled back.');
    if (own) this.begin();
    try {
      const results = queries.map(({ sql, params = [] }) => {
        this.publicQuery = true;
        try {
          this.singleStatement(sql);
          const statement = this.connection.prepare(sql);
          try {
            const readonly = Boolean(this.sqlite3.capi.sqlite3_stmt_readonly(statement));
            if (!readonly) this.dirty = true;
            if (params.length) statement.bind(params);
            const columns = statement.columnCount ? statement.getColumnNames() : [];
            const rows: SqlValue[][] = [];
            while (statement.step()) rows.push(statement.get([]));
            return { columns, rows, changes: readonly ? 0 : this.connection.changes() };
          } finally {
            statement.finalize();
          }
        } finally {
          this.publicQuery = false;
        }
      });
      if (own) await this.commit();
      return results;
    } catch (error) {
      if (own) this.rollback();
      throw error;
    }
  }
  close() {
    this.rollback();
    this.connection.close();
  }
  private restoreCheckpoint() {
    if (!this.save || !this.checkpoint) return;
    this.connection.close();
    this.connection = BrowserSqliteEngine.memory(this.sqlite3, this.checkpoint);
    this.configure();
    this.transactionOpen = false;
    this.dirty = false;
  }
}
