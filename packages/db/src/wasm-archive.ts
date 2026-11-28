import type { Database, Sqlite3Static, SqlValue } from '@sqlite.org/sqlite-wasm';
import {
  createBrewArchive,
  readBrewArchive,
  type ArchiveMetadata,
} from '../../core/src/archive.js';
import {
  captureArchiveRows,
  replaceArchiveRows,
  validateArchiveSchema,
  type ArchiveRows,
  type ArchiveSql,
} from './archive-sql.js';
import { migrateSqlite, type Migration } from './migrate.js';
import { openSqliteImage } from './sqlite-image.js';

const hash = {
  sha256: async (bytes: Uint8Array) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''),
};
export function wasmArchiveSql(database: Database): ArchiveSql {
  return {
    all: <T>(sql: string, values: unknown[] = []) =>
      database.selectObjects(sql, values as SqlValue[]) as T[],
    run: (sql, values = []) => {
      database.exec({ sql, bind: values as SqlValue[] });
    },
    transaction: (work) => {
      database.exec('BEGIN IMMEDIATE');
      try {
        work();
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
/** SQLite image work stays in a dedicated worker, independent of the persistent library. */
export class WasmArchives {
  readonly migrations: Migration[];
  constructor(
    readonly sqlite3: Sqlite3Static,
    migrations: readonly Migration[],
    readonly timezone: string,
  ) {
    this.migrations = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
  }
  private canonical(names = this.migrations.map((migration) => migration.name)) {
    if (
      names.length < 19 ||
      names.length > this.migrations.length ||
      names.some((name, index) => name !== this.migrations[index]?.name)
    )
      throw new Error(
        'This archive uses an unsupported Brew migration version. Upgrade Brew before importing it.',
      );
    const database = openSqliteImage(this.sqlite3);
    try {
      const connection = wasmArchiveSql(database);
      migrateSqlite(
        {
          ...connection,
          exec: (sql) => {
            database.exec(sql);
          },
        },
        this.migrations.slice(0, names.length),
        this.timezone,
      );
      return { database, connection, names };
    } catch (error) {
      database.close();
      throw error;
    }
  }
  async create(rows: ArchiveRows, metadata: Omit<ArchiveMetadata, 'migrations'>) {
    const target = this.canonical();
    try {
      const expected = captureArchiveRows(target.connection, target.connection);
      if (
        JSON.stringify(rows.tables.map(({ name, columns }) => ({ name, columns }))) !==
        JSON.stringify(expected.tables.map(({ name, columns }) => ({ name, columns })))
      )
        throw new Error('The transfer snapshot does not match the current Brew schema.');
      replaceArchiveRows(target.connection, rows);
      validateArchiveSchema(target.connection, target.connection);
      return await createBrewArchive(
        this.sqlite3.capi.sqlite3_js_db_export(target.database),
        { ...metadata, migrations: target.names },
        hash,
      );
    } finally {
      target.database.close();
    }
  }
  async inspect(bytes: Uint8Array) {
    const archive = await readBrewArchive(bytes, hash);
    const expected = this.canonical(archive.manifest.migrations);
    let source: Database | undefined;
    try {
      source = openSqliteImage(this.sqlite3, archive.database);
      source.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON');
      const input = wasmArchiveSql(source);
      validateArchiveSchema(input, expected.connection);
      const names = input
        .all<{ name: string }>('SELECT name FROM __brew_migrations ORDER BY name')
        .map((row) => row.name);
      if (JSON.stringify(names) !== JSON.stringify(archive.manifest.migrations))
        throw new Error('The archive migration ledger does not match its manifest.');
      const rows = captureArchiveRows(input, expected.connection);
      replaceArchiveRows(expected.connection, rows);
      migrateSqlite(
        {
          ...expected.connection,
          exec: (sql) => {
            expected.database.exec(sql);
          },
        },
        this.migrations,
        this.timezone,
      );
      const upgraded = captureArchiveRows(expected.connection, expected.connection);
      return {
        manifest: archive.manifest,
        rows: upgraded,
        counts: Object.fromEntries(upgraded.tables.map((table) => [table.name, table.rows.length])),
      };
    } finally {
      source?.close();
      expected.database.close();
    }
  }
}
