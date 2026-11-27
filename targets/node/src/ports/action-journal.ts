import {
  journalTables as tables,
  quoteJournalName as quote,
  journalTriggers,
  journalReferences,
  journalRestoreRow,
  type JournalRow as Row,
  type JournalColumn as Column,
  type JournalChange,
} from '../../../../packages/db/src/action-journal.js';
import type { BrewDatabase } from '../db/database.js';
import { ActionError } from '../../../../packages/core/src/actions.js';

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
      for (const trigger of journalTriggers(
        table,
        columns,
        '(SELECT id FROM brew_active_action)',
        true,
      ))
        sql.exec(trigger);
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
      .all(id) as JournalChange[];
    const referenced = journalReferences(
      sql.prepare('SELECT sections_json,legacy_sections_json FROM brew_configs').all() as Array<{
        sections_json: string;
        legacy_sections_json: string | null;
      }>,
      sql.prepare('SELECT scope_json FROM rules').all() as Array<{ scope_json: string }>,
    );
    const articleChild = sql.prepare('SELECT 1 FROM articles WHERE feed_id=? LIMIT 1');
    const feedChild = sql.prepare('SELECT 1 FROM feeds WHERE folder_id=? LIMIT 1');
    const ruleHistory = sql.prepare('SELECT 1 FROM rule_logs WHERE rule_id=? LIMIT 1');
    const tagUses = sql.prepare('SELECT 1 FROM article_tags WHERE tag_id=? LIMIT 1');
    const prepared = new Map<string, ReturnType<typeof sql.prepare<unknown[]>>>();
    const prepare = (query: string) => {
      let statement = prepared.get(query);
      if (!statement) {
        statement = sql.prepare(query);
        prepared.set(query, statement);
      }
      return statement;
    };
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
      const current = prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...params) as
        Row | undefined;
      journalRestoreRow(change, current, {
        children: Boolean(
          change.table_name === 'rules'
            ? ruleHistory.get(key.id)
            : change.table_name === 'feeds'
              ? articleChild.get(key.id)
              : change.table_name === 'folders'
                ? feedChild.get(key.id)
                : change.table_name === 'tags'
                  ? tagUses.get(key.id)
                  : false,
        ),
        referenced:
          change.table_name === 'feeds'
            ? referenced.feeds.has(Number(key.id))
            : change.table_name === 'folders'
              ? referenced.folders.has(Number(key.id))
              : false,
      });
      if (!before) {
        prepare(`DELETE FROM ${table} WHERE ${where}`).run(...params);
      } else if (!after) {
        const names = Object.keys(before);
        prepare(
          `INSERT INTO ${table} (${names.map(quote).join(',')}) VALUES (${names.map(() => '?').join(',')})`,
        ).run(...Object.values(before));
      } else {
        prepare(
          `UPDATE ${table} SET ${Object.keys(before)
            .map((name) => `${quote(name)}=?`)
            .join(',')} WHERE ${where}`,
        ).run(...Object.values(before), ...params);
      }
    }
    const jobs = changes
      .filter((change) => change.table_name === 'ingest_jobs')
      .map((change) => Number((JSON.parse(change.key_json) as Row).sequence));
    if (jobs.length)
      sql
        .prepare(
          'UPDATE ingest_jobs SET runner=NULL,expires_at=0,version=version+1 WHERE sequence IN (SELECT value FROM json_each(?))',
        )
        .run(JSON.stringify(jobs));
  }
}
