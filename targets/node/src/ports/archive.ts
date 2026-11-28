import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  createBrewArchive,
  readBrewArchive,
  type ArchiveMetadata,
} from '../../../../packages/core/src/archive.js';
import { migrateSqlite } from '../../../../packages/db/src/migrate.js';
import {
  captureArchiveRows,
  replaceArchiveRows,
  validateArchiveSchema,
  type ArchiveSql,
  type ArchiveRows,
} from '../../../../packages/db/src/archive-sql.js';
import type { BrewDatabase } from '../db/database.js';
import { withArchiveWrite } from '../db/library-fence.js';

const directory = fileURLToPath(new URL('../../../../packages/db/migrations/', import.meta.url));
const migrations = () =>
  fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(directory, name), 'utf8') }));
const hash = {
  sha256: async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
};
export function nativeArchiveSql(database: Database.Database): ArchiveSql {
  return {
    all: <T>(sql: string, values: unknown[] = []) =>
      database
        .prepare(sql)
        .safeIntegers(true)
        .all(...values)
        .map((row) =>
          Object.fromEntries(
            Object.entries(row as Record<string, unknown>).map(([key, value]) => [
              key,
              typeof value === 'bigint' &&
              value >= BigInt(Number.MIN_SAFE_INTEGER) &&
              value <= BigInt(Number.MAX_SAFE_INTEGER)
                ? Number(value)
                : value,
            ]),
          ),
        ) as T[],
    run: (sql, values = []) => {
      database.prepare(sql).run(...values);
    },
    transaction: (work) => {
      database.transaction(work).immediate();
    },
  };
}
function canonical(names?: string[]) {
  const known = migrations();
  const selected = names ?? known.map((migration) => migration.name);
  if (
    selected.length < 19 ||
    selected.length > known.length ||
    selected.some((name, index) => name !== known[index]?.name)
  )
    throw new Error(
      'This archive uses an unsupported Brew migration version. Upgrade Brew before importing it.',
    );
  const sqlite = new Database(':memory:');
  try {
    sqlite.pragma('foreign_keys=ON');
    const connection = nativeArchiveSql(sqlite);
    migrateSqlite(
      {
        ...connection,
        exec: (sql) => {
          sqlite.exec(sql);
        },
      },
      known.slice(0, selected.length),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    return { sqlite, connection, names: selected };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
export async function exportNodeArchive(
  database: BrewDatabase,
  metadata: Omit<ArchiveMetadata, 'source' | 'migrations'>,
) {
  const normalized = canonical();
  try {
    const source = nativeArchiveSql(database.sqlite);
    let rows!: ArchiveRows;
    source.transaction(() => {
      rows = captureArchiveRows(source, normalized.connection);
    });
    replaceArchiveRows(normalized.connection, rows);
    validateArchiveSchema(normalized.connection, normalized.connection);
    return await createBrewArchive(
      normalized.sqlite.serialize(),
      { ...metadata, source: 'node', migrations: normalized.names },
      hash,
    );
  } finally {
    normalized.sqlite.close();
  }
}
/** Validation and normalization never open or write the destination library. */
export async function inspectNodeArchive(bytes: Uint8Array) {
  const archive = await readBrewArchive(bytes, hash);
  const expected = canonical(archive.manifest.migrations);
  let source: Database.Database | undefined;
  try {
    source = new Database(Buffer.from(archive.database), { readonly: true });
    source.pragma('trusted_schema=OFF');
    const input = nativeArchiveSql(source);
    validateArchiveSchema(input, expected.connection);
    const applied = input
      .all<{ name: string }>('SELECT name FROM __brew_migrations ORDER BY name')
      .map((row) => row.name);
    if (JSON.stringify(applied) !== JSON.stringify(archive.manifest.migrations))
      throw new Error('The archive migration ledger does not match its manifest.');
    const rows = captureArchiveRows(input, expected.connection);
    replaceArchiveRows(expected.connection, rows);
    const known = migrations();
    migrateSqlite(
      {
        ...expected.connection,
        exec: (sql) => {
          expected.sqlite.exec(sql);
        },
      },
      known,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    const upgraded = captureArchiveRows(expected.connection, expected.connection);
    return {
      manifest: archive.manifest,
      rows: upgraded,
      counts: Object.fromEntries(upgraded.tables.map((table) => [table.name, table.rows.length])),
    };
  } finally {
    source?.close();
    expected.sqlite.close();
  }
}
/** Destination must be quiesced by its owner. Live transports add lifecycle admission before using this primitive. */
export function importNodeArchive(
  database: BrewDatabase,
  inspected: Awaited<ReturnType<typeof inspectNodeArchive>>,
) {
  withArchiveWrite(database.sqlite, () =>
    replaceArchiveRows(nativeArchiveSql(database.sqlite), inspected.rows, true),
  );
}
