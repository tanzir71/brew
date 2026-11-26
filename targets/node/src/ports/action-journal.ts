import type { BrewDatabase } from '../db/database.js';
import { ActionError } from '../../../../packages/core/src/actions.js';

type Row = Record<string, string | number | null>;
type Column = { name: string; pk: number };
const tables = ['folders', 'feeds', 'articles', 'article_tags', 'rules', 'rule_logs'] as const;
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** SQLite records each synchronous write and its cascades atomically with the action.
 * The flag is off across awaits, so unrelated requests never join the journal. */
export class ActionJournal {
  constructor(private readonly database: BrewDatabase) {
    const sql = database.sqlite;
    sql.exec(
      'CREATE TEMP TABLE IF NOT EXISTS brew_active_action (id INTEGER); INSERT INTO brew_active_action SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM brew_active_action)',
    );
    for (const table of tables) {
      const columns = sql.prepare(`PRAGMA table_info(${quote(table)})`).all() as Column[];
      const object = (prefix: string, list = columns) =>
        `json_object(${list.flatMap((column) => [`'${column.name}'`, `${prefix}.${quote(column.name)}`]).join(',')})`;
      const keys = columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk);
      const changed = columns
        .map((column) => `OLD.${quote(column.name)} IS NOT NEW.${quote(column.name)}`)
        .join(' OR ');
      const changes = (prefix: string) =>
        `(SELECT json_group_object(name,value) FROM (${columns.map((column) => `SELECT '${column.name}' AS name, ${prefix}.${quote(column.name)} AS value WHERE OLD.${quote(column.name)} IS NOT NEW.${quote(column.name)}`).join(' UNION ALL ')}))`;
      for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
        const before =
          event === 'INSERT' ? 'NULL' : event === 'UPDATE' ? changes('OLD') : object('OLD');
        const after =
          event === 'DELETE' ? 'NULL' : event === 'UPDATE' ? changes('NEW') : object('NEW');
        sql.exec(`CREATE TEMP TRIGGER IF NOT EXISTS ${quote(`brew_action_${table}_${event}`)} AFTER ${event} ON main.${quote(table)} WHEN (SELECT id FROM brew_active_action) IS NOT NULL ${event === 'UPDATE' ? `AND (${changed})` : ''} BEGIN
          INSERT INTO agent_action_changes(action_id,table_name,key_json,before_json,after_json)
          VALUES((SELECT id FROM brew_active_action),'${table}',${object(event === 'DELETE' ? 'OLD' : 'NEW', keys)},${before},${after}); END`);
      }
    }
  }
  write<T>(id: number, run: () => T): T {
    return this.database.sqlite.transaction(() => {
      const previous = (
        this.database.sqlite.prepare('SELECT id FROM brew_active_action').get() as {
          id: number | null;
        }
      ).id;
      this.database.sqlite.prepare('UPDATE brew_active_action SET id=?').run(id);
      try {
        return run();
      } finally {
        this.database.sqlite.prepare('UPDATE brew_active_action SET id=?').run(previous);
      }
    })();
  }
  restore(id: number): void {
    const sql = this.database.sqlite;
    const changes = sql
      .prepare(
        'SELECT table_name,key_json,before_json,after_json FROM agent_action_changes WHERE action_id=? ORDER BY id DESC',
      )
      .all(id) as Array<{
      table_name: string;
      key_json: string;
      before_json: string | null;
      after_json: string | null;
    }>;
    for (const change of changes) {
      if (!tables.includes(change.table_name as (typeof tables)[number]))
        throw new ActionError(409, 'This action cannot be restored.');
      const table = quote(change.table_name);
      const key = JSON.parse(change.key_json) as Row;
      const before = change.before_json ? (JSON.parse(change.before_json) as Row) : null;
      const after = change.after_json ? (JSON.parse(change.after_json) as Row) : null;
      const where = Object.keys(key)
        .map((name) => `${quote(name)} IS ?`)
        .join(' AND ');
      const params = Object.values(key);
      const current = sql.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...params) as
        Row | undefined;
      if (
        after
          ? !current || Object.entries(after).some(([name, value]) => current[name] !== value)
          : current !== undefined
      )
        throw new ActionError(
          409,
          'These items changed after the action. Undo could not restore them.',
        );
      if (!before) {
        // New tag definitions are intentionally retained; only assignments are journalled.
        // New journalled rows (assignments/logs) have no dependent child records.
        sql.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...params);
      } else if (!after) {
        const names = Object.keys(before);
        sql
          .prepare(
            `INSERT INTO ${table} (${names.map(quote).join(',')}) VALUES (${names.map(() => '?').join(',')})`,
          )
          .run(...Object.values(before));
      } else {
        sql
          .prepare(
            `UPDATE ${table} SET ${Object.keys(before)
              .map((name) => `${quote(name)}=?`)
              .join(',')} WHERE ${where}`,
          )
          .run(...Object.values(before), ...params);
      }
    }
  }
}
