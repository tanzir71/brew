import type { BrewDatabase } from '../db/database.js';
import { ActionError } from '../../../../packages/core/src/actions.js';

type Row = Record<string, string | number | null>;
type Column = { name: string; pk: number };
const tables = [
  'folders',
  'feeds',
  'articles',
  'article_tags',
  'tags',
  'rules',
  'rule_logs',
  'brew_configs',
] as const;
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
        if (table === 'brew_configs' && event !== 'UPDATE') continue;
        const before =
          event === 'INSERT' ? 'NULL' : event === 'UPDATE' ? changes('OLD') : object('OLD');
        const after =
          event === 'DELETE' ? 'NULL' : event === 'UPDATE' ? changes('NEW') : object('NEW');
        // Legacy rule application retains reusable tag definitions. Only the
        // explicit named-tag action owns creation/removal of a new definition.
        const tagOwner =
          table === 'tags'
            ? "AND (SELECT tool FROM agent_actions WHERE id=(SELECT id FROM brew_active_action))='tag_item'"
            : '';
        sql.exec(`CREATE TEMP TRIGGER IF NOT EXISTS ${quote(`brew_action_${table}_${event}`)} AFTER ${event} ON main.${quote(table)} WHEN (SELECT id FROM brew_active_action) IS NOT NULL ${tagOwner} ${event === 'UPDATE' ? `AND (${changed})` : ''} BEGIN
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
    const referenced = { feeds: new Set<number>(), folders: new Set<number>() };
    if (
      changes.some(
        (change) => !change.before_json && ['feeds', 'folders'].includes(change.table_name),
      )
    ) {
      const add = (kind: unknown, value: unknown) => {
        const id = Number(value);
        if (Number.isSafeInteger(id) && id > 0 && (kind === 'feed' || kind === 'folder'))
          referenced[kind === 'feed' ? 'feeds' : 'folders'].add(id);
      };
      const visit = (value: unknown) => {
        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }
        if (!value || typeof value !== 'object') return;
        const row = value as Record<string, unknown>;
        add(row.kind ?? row.type, row.id);
        add(row.source, row.sourceId);
        Object.values(row).forEach(visit);
      };
      for (const row of sql
        .prepare('SELECT sections_json,legacy_sections_json FROM brew_configs')
        .all() as Array<{ sections_json: string; legacy_sections_json: string | null }>)
        for (const value of [row.sections_json, row.legacy_sections_json])
          if (value) {
            try {
              visit(JSON.parse(value));
            } catch {
              /* Unreadable definitions have no active source references. */
            }
          }
      for (const row of sql.prepare('SELECT scope_json FROM rules').all() as Array<{
        scope_json: string;
      }>) {
        try {
          const scope = JSON.parse(row.scope_json);
          for (const value of Array.isArray(scope?.feedIds) ? scope.feedIds : [])
            add('feed', value);
          for (const value of Array.isArray(scope?.folderIds) ? scope.folderIds : [])
            add('folder', value);
        } catch {
          /* Invalid rules cannot select these sources. */
        }
      }
    }
    const articleChild = sql.prepare('SELECT 1 FROM articles WHERE feed_id=? LIMIT 1');
    const feedChild = sql.prepare('SELECT 1 FROM feeds WHERE folder_id=? LIMIT 1');
    const ruleHistory = sql.prepare('SELECT 1 FROM rule_logs WHERE rule_id=? LIMIT 1');
    const tagUses = sql.prepare('SELECT 1 FROM article_tags WHERE tag_id=? LIMIT 1');
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
        if (change.table_name === 'rules' && ruleHistory.get(key.id))
          throw new ActionError(
            409,
            'The copied rule has execution history. Undo could not remove it.',
          );
        if (
          (change.table_name === 'feeds' &&
            (articleChild.get(key.id) || referenced.feeds.has(Number(key.id)))) ||
          (change.table_name === 'folders' &&
            (feedChild.get(key.id) || referenced.folders.has(Number(key.id))))
        )
          throw new ActionError(
            409,
            'These imported feeds or folders are now in use. Undo could not remove them.',
          );
        // Parent rows may acquire children or saved source references after import.
        // Never cascade away that later work while reversing their insertion.
        if (change.table_name === 'tags' && tagUses.get(key.id))
          throw new ActionError(409, 'This new tag is now used by another article.');
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
