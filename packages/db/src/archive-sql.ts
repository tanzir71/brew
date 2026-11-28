export type ArchiveValue = string | number | null;
export interface ArchiveSql {
  all<T>(sql: string, values?: unknown[]): T[];
  run(sql: string, values?: unknown[]): void;
  transaction(work: () => void): void;
}
interface Column {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  hidden: number;
}
interface SchemaObject {
  type: string;
  name: string;
  tbl_name: string;
  sql: string | null;
}
export interface ArchiveTable {
  name: string;
  columns: string[];
  rows: ArchiveValue[][];
}
export interface ArchiveRows {
  tables: ArchiveTable[];
  sequences: Array<{ name: string; seq: number }>;
}
export const archiveQuote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export const archiveControlTables = new Set([
  '__brew_migrations',
  '__brew_library_identity',
  '__brew_archive_jobs',
  '__brew_archive_rows',
  '__brew_archive_check',
]);
const shadows = new Set([
  'articles_fts_data',
  'articles_fts_idx',
  'articles_fts_content',
  'articles_fts_docsize',
  'articles_fts_config',
]);
function objects(connection: ArchiveSql) {
  return connection
    .all<SchemaObject>(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .filter((object) => !(object.type === 'table' && shadows.has(object.name)));
}
function columns(connection: ArchiveSql, name: string) {
  return connection.all<Column>(`PRAGMA table_xinfo(${archiveQuote(name)})`);
}
const normalized = (sql: string | null) =>
  sql
    ?.trim()
    .replace(/\s+/g, ' ')
    .replace(/\bIF NOT EXISTS\b/gi, '')
    .replace(/\s+/g, ' ');
export function archiveTableLayout(connection: ArchiveSql) {
  return objects(connection)
    .filter(
      (object) =>
        object.type === 'table' &&
        object.name !== 'articles_fts' &&
        !archiveControlTables.has(object.name),
    )
    .map((table) => ({
      name: table.name,
      columns: columns(connection, table.name)
        .filter((column) => column.hidden === 0)
        .map((column) => column.name),
    }));
}
export function validateArchiveRows(target: ArchiveSql, rows: ArchiveRows) {
  const expected = archiveTableLayout(target);
  if (
    JSON.stringify(rows.tables.map(({ name, columns }) => ({ name, columns }))) !==
    JSON.stringify(expected)
  )
    throw new Error('The transfer snapshot does not match the current Brew schema.');
  for (const table of rows.tables)
    for (const row of table.rows)
      if (
        row.length !== table.columns.length ||
        row.some(
          (value) =>
            value !== null &&
            typeof value !== 'string' &&
            !(
              typeof value === 'number' &&
              Number.isFinite(value) &&
              Math.abs(value) <= Number.MAX_SAFE_INTEGER
            ),
        )
      )
        throw new Error(
          'The transfer snapshot contains a value this Brew version cannot preserve.',
        );
  const sequences = new Set(
    objects(target)
      .filter((object) => object.type === 'table' && /\bAUTOINCREMENT\b/i.test(object.sql ?? ''))
      .map((object) => object.name),
  );
  const seen = new Set<string>();
  for (const row of rows.sequences) {
    if (
      !sequences.has(row.name) ||
      seen.has(row.name) ||
      !Number.isSafeInteger(row.seq) ||
      row.seq < 0
    )
      throw new Error('The transfer snapshot contains an invalid sequence.');
    seen.add(row.name);
  }
}
/** The expected connection is built only from trusted canonical migrations. */
export function validateArchiveSchema(source: ArchiveSql, expected: ArchiveSql) {
  const actual = objects(source);
  const canonical = objects(expected);
  if (
    actual.length !== canonical.length ||
    actual.some((object, index) => {
      const correct = canonical[index]!;
      return (
        object.type !== correct.type ||
        object.name !== correct.name ||
        object.tbl_name !== correct.tbl_name ||
        normalized(object.sql) !== normalized(correct.sql)
      );
    })
  )
    throw new Error(
      'The archive schema does not match its Brew migration version. No library data was changed.',
    );
  const integrity = source.all<Record<string, unknown>>('PRAGMA integrity_check');
  if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== 'ok')
    throw new Error('The archived SQLite database failed its integrity check.');
  if (source.all('PRAGMA foreign_key_check').length)
    throw new Error('The archived SQLite database has broken references.');
}
/** Called inside the adapter's real snapshot transaction. FTS is rebuilt, never copied as user data. */
export function captureArchiveRows(source: ArchiveSql, canonical: ArchiveSql): ArchiveRows {
  const tables = objects(canonical).filter(
    (object) =>
      object.type === 'table' &&
      object.name !== 'articles_fts' &&
      !archiveControlTables.has(object.name),
  );
  const names = new Set(tables.map((table) => table.name));
  return {
    tables: tables.map((table) => {
      const info = columns(canonical, table.name).filter((column) => column.hidden === 0);
      const fields = info.map((column) => column.name);
      const keys = info
        .filter((column) => column.pk)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name);
      const selected = fields.map(archiveQuote).join(',');
      const rows = source.all<Record<string, unknown>>(
        `SELECT ${selected} FROM ${archiveQuote(table.name)} ORDER BY ${(keys.length ? keys : fields).map(archiveQuote).join(',')}`,
      );
      return {
        name: table.name,
        columns: fields,
        rows: rows.map((row) =>
          fields.map((field) => {
            let value = row[field];
            if (
              typeof value === 'bigint' &&
              value >= BigInt(Number.MIN_SAFE_INTEGER) &&
              value <= BigInt(Number.MAX_SAFE_INTEGER)
            )
              value = Number(value);
            if (!(
              value === null ||
              typeof value === 'string' ||
              (typeof value === 'number' &&
                Number.isFinite(value) &&
                Math.abs(value) <= Number.MAX_SAFE_INTEGER)
            ))
              throw new Error('The archive contains a value this Brew version cannot preserve.');
            return value;
          }),
        ),
      };
    }),
    sequences: source
      .all<{ name: string; seq: unknown }>('SELECT name,seq FROM sqlite_sequence ORDER BY name')
      .filter((row) => names.has(row.name))
      .map((row) => {
        const value = typeof row.seq === 'bigint' ? Number(row.seq) : row.seq;
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
          throw new Error('The archive contains an invalid sequence.');
        return { name: row.name, seq: value };
      }),
  };
}
/** Caller provides exclusive lifecycle admission; one transaction protects every row and FTS trigger. */
export function replaceArchiveRows(target: ArchiveSql, rows: ArchiveRows, rotateIdentity = false) {
  target.transaction(() => {
    validateArchiveRows(target, rows);
    target.run('PRAGMA defer_foreign_keys=ON');
    for (const table of rows.tables) target.run(`DELETE FROM ${archiveQuote(table.name)}`);
    for (const table of rows.tables) {
      const fields = table.columns.map(archiveQuote).join(',');
      const placeholders = table.columns.map(() => '?').join(',');
      for (const row of table.rows)
        target.run(
          `INSERT INTO ${archiveQuote(table.name)}(${fields}) VALUES(${placeholders})`,
          row,
        );
    }
    target.run('DELETE FROM sqlite_sequence');
    for (const row of rows.sequences)
      target.run('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)', [row.name, row.seq]);
    if (target.all('PRAGMA foreign_key_check').length)
      throw new Error('The archive has broken references. Your previous library has been kept.');
    if (rotateIdentity)
      target.run('UPDATE __brew_library_identity SET epoch=lower(hex(randomblob(16))) WHERE id=1');
  });
}
