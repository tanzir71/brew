import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schema } from './schema.js';

export interface BrewDatabase {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  close: () => void;
}

const adjacentMigrations = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const migrationsDirectory = fs.existsSync(adjacentMigrations)
  ? adjacentMigrations
  : path.resolve('server/db/migrations');

function migrate(sqlite: Database.Database): void {
  sqlite.exec('CREATE TABLE IF NOT EXISTS __brew_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = sqlite.prepare('SELECT 1 FROM __brew_migrations WHERE name = ?');
  const record = sqlite.prepare('INSERT INTO __brew_migrations (name, applied_at) VALUES (?, ?)');
  const files = fs.readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.get(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDirectory, file), 'utf8');
    sqlite.transaction(() => { sqlite.exec(sql); record.run(file, Date.now()); })();
  }
}

export function openDatabase(filename = process.env.BREW_DB_PATH ?? './data/brew.db'): BrewDatabase {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const sqlite = new Database(filename);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  migrate(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
}
