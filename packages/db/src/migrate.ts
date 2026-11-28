import { migrateLegacyBrewRow } from './composition-migration.js';

export interface Migration {
  name: string;
  sql: string;
}
export interface MigrationConnection {
  exec(sql: string): void;
  all<T>(sql: string, values?: unknown[]): T[];
  run(sql: string, values: unknown[]): void;
  transaction(work: () => void): void;
}

/** Canonical DDL and its data step run together on every SQLite target. */
export function migrateSqlite(
  connection: MigrationConnection,
  migrations: readonly Migration[],
  timezone: string,
  now = () => Date.now(),
): void {
  connection.exec(
    'CREATE TABLE IF NOT EXISTS __brew_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
  );
  const applied = new Set(
    connection.all<{ name: string }>('SELECT name FROM __brew_migrations').map((row) => row.name),
  );
  for (const migration of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (applied.has(migration.name)) continue;
    connection.transaction(() => {
      connection.exec(migration.sql);
      if (migration.name === '0006_brew_composition.sql') {
        const rows = connection.all<{
          id: number;
          name: string;
          enabled: number;
          schedule_cron: string;
          sections_json: string;
        }>('SELECT id, name, enabled, schedule_cron, sections_json FROM brew_configs');
        for (const row of rows) {
          const value = migrateLegacyBrewRow(row, timezone);
          connection.run(
            'UPDATE brew_configs SET timezone=?, schedule_json=?, delivery_json=?, sections_json=? WHERE id=?',
            [value.timezone, value.scheduleJson, value.deliveryJson, value.sectionsJson, row.id],
          );
        }
      }
      connection.run('INSERT INTO __brew_migrations (name, applied_at) VALUES (?, ?)', [
        migration.name,
        now(),
      ]);
    });
    applied.add(migration.name);
  }
}
