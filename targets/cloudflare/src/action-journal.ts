import { ActionError } from '../../../packages/core/src/actions.js';
import {
  journalTables,
  journalReferences,
  journalRestoreRow,
  quoteJournalName as quote,
  type JournalChange,
  type JournalRow,
} from '../../../packages/db/src/action-journal.js';
import { CloudflareStorage } from './storage.js';

export interface JournalSql {
  sql: string;
  values?: unknown[];
}
type Table = (typeof journalTables)[number];
const keys = (table: Table) =>
  table === 'ingest_jobs'
    ? ['sequence']
    : table === 'ingest_job_items'
      ? ['article_id']
      : table === 'article_tags'
        ? ['article_id', 'tag_id']
        : ['id'];
const identity = (table: Table, row: JournalRow) =>
  JSON.stringify(keys(table).map((key) => row[key]));
const all = (conditions: JournalSql[]): JournalSql => ({
  sql: conditions.map((condition) => `(${condition.sql})`).join(' AND ') || '1',
  values: conditions.flatMap((condition) => condition.values ?? []),
});
type Snapshot = { table?: Table; columns: string[]; query: JournalSql; rows: JournalRow[] };
export interface JournalTransaction {
  actionId: number | null | JournalSql;
  at: number;
  before?: JournalSql[];
  queries: JournalSql[];
  after?: JournalSql[];
  authorized?: JournalSql;
  valid?: JournalSql;
}

/** Activation, writes/cascades, expiry and caller finalization share one D1 batch.
 * No activation flag is held across an await or an external operation. */
export class CloudflareActionJournal {
  constructor(private storage: CloudflareStorage) {}
  async transaction(input: JournalTransaction) {
    const actionId =
      typeof input.actionId === 'object' && input.actionId !== null
        ? input.actionId
        : { sql: '?', values: [input.actionId] };
    const authorized = input.authorized ?? { sql: '1' },
      valid = input.valid ?? { sql: '1' };
    const before = input.before ?? [];
    try {
      const result = await this.storage.batch([
        ...before.map((query) => this.storage.statement(query.sql, query.values)),
        this.storage.statement(
          `INSERT INTO settings(key,value) VALUES('brew_active_action',json_object('id',${actionId.sql},'authorized',${authorized.sql},'valid',${valid.sql}))`,
          [...(actionId.values ?? []), ...(authorized.values ?? []), ...(valid.values ?? [])],
        ),
        this.storage.statement(
          `UPDATE agent_actions SET undo_json=json_set(undo_json,'$.expiresAt',?) WHERE id=${actionId.sql}`,
          [input.at + 30000, ...(actionId.values ?? [])],
        ),
        ...input.queries.map((query) => this.storage.statement(query.sql, query.values)),
        ...(input.after ?? []).map((query) => this.storage.statement(query.sql, query.values)),
        this.storage.statement("DELETE FROM settings WHERE key='brew_active_action'"),
      ]);
      return result.slice(before.length + 2, before.length + 2 + input.queries.length);
    } catch (error) {
      if (String(error).includes('BREW_ACTION_FORBIDDEN'))
        throw new ActionError(403, 'This credential cannot write.');
      if (String(error).includes('BREW_ACTION_CONFLICT'))
        throw new ActionError(
          409,
          'These items changed after the action. Undo could not restore them.',
        );
      throw error;
    }
  }
  private async snapshot(changes: JournalChange[]) {
    const footprints = new Map<Table, { columns: Set<string>; keys: Map<string, JournalRow> }>();
    const parents = {
      feeds: new Set<number>(),
      folders: new Set<number>(),
      rules: new Set<number>(),
      tags: new Set<number>(),
    };
    for (const change of changes) {
      if (!journalTables.includes(change.table_name as Table))
        throw new ActionError(409, 'This action cannot be restored.');
      const table = change.table_name as Table,
        key = JSON.parse(change.key_json) as JournalRow;
      if (JSON.stringify(Object.keys(key).sort()) !== JSON.stringify([...keys(table)].sort()))
        throw new ActionError(409, 'This action cannot be restored.');
      const footprint = footprints.get(table) ?? { columns: new Set(keys(table)), keys: new Map() };
      footprint.keys.set(identity(table, key), key);
      for (const value of [change.before_json, change.after_json])
        if (value) for (const name of Object.keys(JSON.parse(value))) footprint.columns.add(name);
      footprints.set(table, footprint);
      if (!change.before_json && table in parents)
        parents[table as keyof typeof parents].add(Number(key.id));
    }
    const snapshots: Snapshot[] = [];
    for (const [table, footprint] of footprints) {
      const columns = [...footprint.columns];
      snapshots.push({
        table,
        columns,
        rows: [],
        query: {
          sql: `SELECT ${columns.map(quote).join(',')} FROM ${quote(table)} t WHERE (${keys(table)
            .map((key) => `t.${quote(key)}`)
            .join(',')}) IN(SELECT ${keys(table)
            .map((key) => `json_extract(selected.value,'$.${key}')`)
            .join(',')} FROM json_each(?) selected) ORDER BY ${keys(table).map(quote).join(',')}`,
          values: [JSON.stringify([...footprint.keys.values()])],
        },
      });
    }
    for (const [parent, child, foreign] of [
      ['feeds', 'articles', 'feed_id'],
      ['folders', 'feeds', 'folder_id'],
      ['rules', 'rule_logs', 'rule_id'],
      ['tags', 'article_tags', 'tag_id'],
    ] as const)
      if (parents[parent].size) {
        const columns = [...new Set([...keys(child), foreign])];
        snapshots.push({
          table: child,
          columns,
          rows: [],
          query: {
            sql: `SELECT ${columns.map(quote).join(',')} FROM ${quote(child)} WHERE ${quote(foreign)} IN(SELECT value FROM json_each(?)) ORDER BY ${keys(child).map(quote).join(',')}`,
            values: [JSON.stringify([...parents[parent]])],
          },
        });
      }
    const references = parents.feeds.size + parents.folders.size > 0;
    if (references)
      snapshots.push(
        {
          columns: ['id', 'sections_json', 'legacy_sections_json'],
          rows: [],
          query: {
            sql: 'SELECT id,sections_json,legacy_sections_json FROM brew_configs ORDER BY id',
          },
        },
        {
          columns: ['id', 'scope_json'],
          rows: [],
          query: { sql: 'SELECT id,scope_json FROM rules ORDER BY id' },
        },
      );
    const result = await this.storage.batch(
      snapshots.map((snapshot) =>
        this.storage.statement(snapshot.query.sql, snapshot.query.values),
      ),
    );
    snapshots.forEach((snapshot, index) => {
      snapshot.rows = result[index]!.results as JournalRow[];
    });
    const live = new Map<Table, Map<string, JournalRow>>();
    for (const snapshot of snapshots)
      if (snapshot.table) {
        const rows = live.get(snapshot.table) ?? new Map<string, JournalRow>();
        for (const row of snapshot.rows) {
          const id = identity(snapshot.table, row);
          rows.set(id, { ...rows.get(id), ...row });
        }
        live.set(snapshot.table, rows);
      }
    return {
      footprints,
      snapshots,
      live,
      referenced: journalReferences(
        references
          ? (snapshots.at(-2)!.rows as unknown as Array<{
              sections_json: string;
              legacy_sections_json: string | null;
            }>)
          : [],
        references ? (snapshots.at(-1)!.rows as unknown as Array<{ scope_json: string }>) : [],
      ),
    };
  }
  async restore(
    id: number,
    at: number,
    options: { authorized?: JournalSql; valid?: JournalSql; after?: JournalSql[] } = {},
  ) {
    const historyQuery = {
      sql: 'SELECT id,table_name,key_json,before_json,after_json FROM agent_action_changes WHERE action_id=? ORDER BY id DESC',
      values: [id],
    };
    const changes = await this.storage.all<JournalChange & { id: number }>(
      historyQuery.sql,
      historyQuery.values,
    );
    const { footprints, snapshots, live, referenced } = await this.snapshot(changes);
    const initial = new Map<Table, Map<string, JournalRow>>();
    for (const [table, rows] of live) initial.set(table, new Map(rows));
    for (const change of changes) {
      const table = change.table_name as Table,
        key = JSON.parse(change.key_json) as JournalRow,
        rowId = identity(table, key);
      const relation =
        table === 'feeds'
          ? ['articles', 'feed_id']
          : table === 'folders'
            ? ['feeds', 'folder_id']
            : table === 'rules'
              ? ['rule_logs', 'rule_id']
              : table === 'tags'
                ? ['article_tags', 'tag_id']
                : null;
      const children = Boolean(
        relation &&
        [...(live.get(relation[0] as Table)?.values() ?? [])].some(
          (row) => row[relation[1]!] === key.id,
        ),
      );
      const current = live.get(table)?.get(rowId);
      const row = journalRestoreRow(change, current, {
        children,
        referenced:
          table === 'feeds'
            ? referenced.feeds.has(Number(key.id))
            : table === 'folders'
              ? referenced.folders.has(Number(key.id))
              : false,
      });
      const rows = live.get(table) ?? new Map<string, JournalRow>();
      if (row) rows.set(rowId, row);
      else rows.delete(rowId);
      live.set(table, rows);
    }
    const guards: JournalSql[] = [
      ...(options.valid ? [options.valid] : []),
      {
        sql: '(SELECT count(*) FROM agent_action_changes WHERE action_id=?)=? AND (SELECT coalesce(max(id),0) FROM agent_action_changes WHERE action_id=?)=?',
        values: [id, changes.length, id, changes[0]?.id ?? 0],
      },
    ];
    for (const snapshot of snapshots)
      guards.push({
        sql: `(SELECT json_group_array(json_array(${snapshot.columns.map(quote).join(',')})) FROM (${snapshot.query.sql})) IS ?`,
        values: [
          ...(snapshot.query.values ?? []),
          JSON.stringify(snapshot.rows.map((row) => snapshot.columns.map((column) => row[column]))),
        ],
      });
    const queries: JournalSql[] = [];
    if (changes.length <= 24) {
      // Preserve exact reverse order for short journals, including unique-name swaps.
      for (const change of changes) {
        const table = change.table_name as Table,
          key = JSON.parse(change.key_json) as JournalRow,
          before = change.before_json ? (JSON.parse(change.before_json) as JournalRow) : null;
        const where = Object.keys(key)
            .map((name) => `${quote(name)} IS ?`)
            .join(' AND '),
          values = Object.values(key);
        if (!before) queries.push({ sql: `DELETE FROM ${quote(table)} WHERE ${where}`, values });
        else if (!change.after_json)
          queries.push({
            sql: `INSERT INTO ${quote(table)}(${Object.keys(before).map(quote).join(',')}) VALUES(${Object.keys(
              before,
            )
              .map(() => '?')
              .join(',')})`,
            values: Object.values(before),
          });
        else
          queries.push({
            sql: `UPDATE ${quote(table)} SET ${Object.keys(before)
              .map((name) => `${quote(name)}=?`)
              .join(',')} WHERE ${where}`,
            values: [...Object.values(before), ...values],
          });
      }
    } else {
      // Bulk read/import/rule journals restore in a bounded number of statements,
      // independent of item count. Only the recorded columns are overwritten.
      const order: Table[] = [
        'folders',
        'feeds',
        'articles',
        'tags',
        'rules',
        'brew_configs',
        'article_tags',
        'rule_logs',
        'ingest_jobs',
        'ingest_job_items',
      ];
      const plans = new Map<
        Table,
        {
          removed: JournalRow[];
          inserted: JournalRow[];
          updated: Array<{ key: JournalRow; row: JournalRow }>;
        }
      >();
      for (const [table, footprint] of footprints) {
        const plan = {
          removed: [] as JournalRow[],
          inserted: [] as JournalRow[],
          updated: [] as Array<{ key: JournalRow; row: JournalRow }>,
        };
        for (const [key, value] of footprint.keys) {
          const previous = initial.get(table)?.get(key),
            row = live.get(table)?.get(key);
          if (previous && !row) plan.removed.push(value);
          else if (!previous && row) plan.inserted.push(row);
          else if (previous && row) plan.updated.push({ key: value, row });
        }
        plans.set(table, plan);
      }
      for (const table of [...order].reverse())
        if (plans.has(table))
          for (const encoded of jsonChunks(plans.get(table)!.removed))
            queries.push({
              sql: `DELETE FROM ${quote(table)} AS t WHERE (${keys(table)
                .map((key) => `t.${quote(key)}`)
                .join(',')}) IN(SELECT ${keys(table)
                .map((key) => `json_extract(p.value,'$.${key}')`)
                .join(',')} FROM json_each(?) p)`,
              values: [encoded],
            });
      for (const table of order)
        if (plans.has(table)) {
          const columns = [...footprints.get(table)!.columns];
          for (const encoded of jsonChunks(plans.get(table)!.inserted))
            queries.push({
              sql: `INSERT INTO ${quote(table)}(${columns.map(quote).join(',')}) SELECT ${columns.map((column) => `json_extract(p.value,'$.${column}')`).join(',')} FROM json_each(?) p`,
              values: [encoded],
            });
        }
      for (const table of order)
        if (plans.has(table)) {
          const columns = [...footprints.get(table)!.columns].filter(
            (column) => !keys(table).includes(column),
          );
          if (!columns.length) continue;
          const match = keys(table)
            .map((key, index) => `t.${quote(key)} IS p.k${index}`)
            .join(' AND ');
          for (const encoded of jsonChunks(plans.get(table)!.updated))
            queries.push({
              sql: `WITH plan AS MATERIALIZED (SELECT ${keys(table)
                .map((key, index) => `json_extract(value,'$.key.${key}') AS k${index}`)
                .join(
                  ',',
                )},value FROM json_each(?)) UPDATE ${quote(table)} AS t SET ${columns.map((column) => `${quote(column)}=CASE WHEN json_type(p.value,'$.row.${column}') IS NULL THEN t.${quote(column)} ELSE json_extract(p.value,'$.row.${column}') END`).join(',')} FROM plan p WHERE ${match}`,
              values: [encoded],
            });
        }
    }
    const jobs = changes
      .filter((change) => change.table_name === 'ingest_jobs')
      .map((change) => Number((JSON.parse(change.key_json) as JournalRow).sequence));
    if (jobs.length)
      queries.push({
        sql: 'UPDATE ingest_jobs SET runner=NULL,expires_at=0,version=version+1 WHERE sequence IN (SELECT value FROM json_each(?))',
        values: [JSON.stringify(jobs)],
      });
    try {
      await this.transaction({
        actionId: null,
        at,
        authorized: options.authorized,
        valid: all(guards),
        queries,
        after: options.after,
      });
    } catch (error) {
      if (error instanceof ActionError) throw error;
      throw new ActionError(
        409,
        'These items changed after the action. Undo could not restore them.',
      );
    }
  }
}

function jsonChunks(rows: unknown[]) {
  const result: string[] = [],
    encoder = new TextEncoder();
  let chunk: string[] = [],
    bytes = 2;
  for (const row of rows) {
    const value = JSON.stringify(row),
      length = encoder.encode(value).byteLength + 1;
    if (chunk.length && bytes + length > 1000000) {
      result.push(`[${chunk.join(',')}]`);
      chunk = [];
      bytes = 2;
    }
    chunk.push(value);
    bytes += length;
  }
  if (chunk.length) result.push(`[${chunk.join(',')}]`);
  return result;
}
