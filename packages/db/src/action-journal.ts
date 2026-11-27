import { ActionError } from '../../core/src/actions.js';
export type JournalRow = Record<string, string | number | null>;
export type JournalColumn = { name: string; pk: number };
export const journalTables = [
  'folders',
  'feeds',
  'articles',
  'article_tags',
  'tags',
  'rules',
  'rule_logs',
  'brew_configs',
  'ingest_jobs',
  'ingest_job_items',
] as const;
export const quoteJournalName = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function journalTriggers(
  table: (typeof journalTables)[number],
  columns: JournalColumn[],
  activeId: string,
  temporary = false,
): string[] {
  const output: string[] = [];
  const groups = (values: string[]) => {
    const chunks: string[] = [];
    for (let offset = 0; offset < values.length; offset += 16)
      chunks.push(`json_array(${values.slice(offset, offset + 16).join(',')})`);
    return `json_each(json_array(${chunks.join(',')})) blocks JOIN json_each(blocks.value) entry`;
  };
  const object = (prefix: string, list = columns) =>
    list.length <= 16
      ? `json_object(${list.flatMap((column) => [`'${column.name}'`, `${prefix}.${quoteJournalName(column.name)}`]).join(',')})`
      : `(SELECT json_group_object(json_extract(entry.value,'$.name'),json_extract(entry.value,'$.value')) FROM ${groups(list.map((column) => `json_object('name','${column.name}','value',${prefix}.${quoteJournalName(column.name)})`))})`;
  const keys = columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk);
  const changed = columns
    .map(
      (column) =>
        `OLD.${quoteJournalName(column.name)} IS NOT NEW.${quoteJournalName(column.name)}`,
    )
    .join(' OR ');
  const changes = (prefix: string) =>
    `(SELECT json_group_object(json_extract(entry.value,'$.name'),json_extract(entry.value,'$.value')) FROM ${groups(columns.map((column) => `CASE WHEN OLD.${quoteJournalName(column.name)} IS NOT NEW.${quoteJournalName(column.name)} THEN json_object('name','${column.name}','value',${prefix}.${quoteJournalName(column.name)}) END`))} WHERE entry.type='object')`;
  for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
    if (table === 'brew_configs' && event !== 'UPDATE') continue;
    const before =
      event === 'INSERT' ? 'NULL' : event === 'UPDATE' ? changes('OLD') : object('OLD');
    const after = event === 'DELETE' ? 'NULL' : event === 'UPDATE' ? changes('NEW') : object('NEW');
    // Legacy rule application retains reusable tag definitions. Only the
    // explicit named-tag action owns creation/removal of a new definition.
    const tagOwner =
      table === 'tags'
        ? `AND (SELECT tool FROM agent_actions WHERE id=${activeId})='tag_item'`
        : '';
    const pausePending =
      table === 'ingest_job_items' && event === 'DELETE'
        ? `UPDATE ingest_jobs SET runner=NULL,expires_at=(SELECT created_at+30000 FROM agent_actions WHERE id=${activeId}),version=version+1 WHERE id=OLD.job_id;`
        : '';
    output.push(`CREATE ${temporary ? 'TEMP ' : ''}TRIGGER IF NOT EXISTS ${quoteJournalName(`${temporary ? 'brew_action' : 'brew_persistent_action'}_${table}_${event}`)} AFTER ${event} ON main.${quoteJournalName(table)} WHEN ${activeId} IS NOT NULL ${tagOwner} ${event === 'UPDATE' ? `AND (${changed})` : ''} BEGIN
          INSERT INTO agent_action_changes(action_id,table_name,key_json,before_json,after_json)
          VALUES(${activeId},'${table}',${object(event === 'DELETE' ? 'OLD' : 'NEW', keys)},${before},${after}); ${pausePending} END`);
  }
  return output;
}
export interface JournalChange {
  table_name: string;
  key_json: string;
  before_json: string | null;
  after_json: string | null;
}
export function journalReferences(
  configs: Array<{ sections_json: string; legacy_sections_json: string | null }>,
  rules: Array<{ scope_json: string }>,
) {
  const referenced = { feeds: new Set<number>(), folders: new Set<number>() };
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
  for (const row of configs)
    for (const value of [row.sections_json, row.legacy_sections_json])
      if (value) {
        try {
          visit(JSON.parse(value));
        } catch {
          /* Unreadable definitions have no active source references. */
        }
      }
  for (const row of rules) {
    try {
      const scope = JSON.parse(row.scope_json);
      for (const value of Array.isArray(scope?.feedIds) ? scope.feedIds : []) add('feed', value);
      for (const value of Array.isArray(scope?.folderIds) ? scope.folderIds : [])
        add('folder', value);
    } catch {
      /* Invalid rules cannot select these sources. */
    }
  }

  return referenced;
}
export function journalRestoreRow(
  change: JournalChange,
  current: JournalRow | undefined,
  uses: { children: boolean; referenced: boolean },
) {
  if (!journalTables.includes(change.table_name as (typeof journalTables)[number]))
    throw new ActionError(409, 'This action cannot be restored.');
  const before = change.before_json ? (JSON.parse(change.before_json) as JournalRow) : null;
  const after = change.after_json ? (JSON.parse(change.after_json) as JournalRow) : null;
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
    if (change.table_name === 'rules' && uses.children)
      throw new ActionError(
        409,
        'The copied rule has execution history. Undo could not remove it.',
      );
    if (['feeds', 'folders'].includes(change.table_name) && (uses.children || uses.referenced))
      throw new ActionError(
        409,
        'These imported feeds or folders are now in use. Undo could not remove them.',
      );
    if (change.table_name === 'tags' && uses.children)
      throw new ActionError(409, 'This new tag is now used by another article.');
    return null;
  }
  return after ? { ...current, ...before } : before;
}
