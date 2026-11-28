import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schema } from './schema.js';
import { migrateSqlite } from '../../../../packages/db/src/migrate.js';
import { fenceLibrary } from './library-fence.js';

export interface BrewDatabase {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  close: () => void;
}

const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations/', import.meta.url),
);

export function migrateDatabase(sqlite: Database.Database): void {
  const files = fs
    .readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  migrateSqlite(
    {
      exec: (sql) => {
        sqlite.exec(sql);
      },
      all: <T>(sql: string, values: unknown[] = []) => sqlite.prepare(sql).all(...values) as T[],
      run: (sql, values) => {
        sqlite.prepare(sql).run(...values);
      },
      transaction: (work) => {
        sqlite.transaction(work)();
      },
    },
    files.map((name) => ({
      name,
      sql: fs.readFileSync(path.join(migrationsDirectory, name), 'utf8'),
    })),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
}

export function openDatabase(
  filename = process.env.BREW_DB_PATH ?? './data/brew.db',
): BrewDatabase {
  if (filename !== ':memory:')
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const sqlite = new Database(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  migrateDatabase(sqlite);
  fenceLibrary(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
}
