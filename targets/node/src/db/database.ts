import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schema } from './schema.js';
import { migrateLegacyBrewRow } from '../../../../packages/db/src/composition-migration.js';

export interface BrewDatabase {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  close: () => void;
}

const migrationsDirectory = fileURLToPath(
  new URL('../../../../packages/db/migrations/', import.meta.url),
);

export function migrateDatabase(sqlite: Database.Database): void {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS __brew_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const applied = sqlite.prepare('SELECT 1 FROM __brew_migrations WHERE name = ?');
  const record = sqlite.prepare('INSERT INTO __brew_migrations (name, applied_at) VALUES (?, ?)');
  const files = fs
    .readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    if (applied.get(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDirectory, file), 'utf8');
    sqlite.transaction(() => {
      sqlite.exec(sql);
      if (file === '0006_brew_composition.sql') {
        const rows = sqlite
          .prepare('SELECT id, name, enabled, schedule_cron, sections_json FROM brew_configs')
          .all() as Array<{
          id: number;
          name: string;
          enabled: number;
          schedule_cron: string;
          sections_json: string;
        }>;
        const update = sqlite.prepare(
          'UPDATE brew_configs SET timezone=?, schedule_json=?, delivery_json=?, sections_json=? WHERE id=?',
        );
        for (const row of rows) {
          const value = migrateLegacyBrewRow(row, Intl.DateTimeFormat().resolvedOptions().timeZone);
          update.run(
            value.timezone,
            value.scheduleJson,
            value.deliveryJson,
            value.sectionsJson,
            row.id,
          );
        }
      }
      record.run(file, Date.now());
    })();
  }
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
  return { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
}
