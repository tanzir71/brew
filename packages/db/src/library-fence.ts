import { archiveControlTables, archiveQuote, type ArchiveSql } from './archive-sql.js';
type Connection = Pick<ArchiveSql, 'all' | 'run'>;
export function libraryEpoch(connection: Connection) {
  const row = connection.all<{ epoch: string }>(
    'SELECT epoch FROM __brew_library_identity WHERE id=1',
  )[0];
  if (!row || !/^[a-f0-9]{32}$/.test(row.epoch))
    throw new Error('The library identity is missing or invalid.');
  return row.epoch;
}
/** Temporary guards belong to one connection; replacing data cannot make an old worker current. */
export class LibraryFence {
  private readonly triggers: Array<{ name: string; sql: string }>;
  constructor(
    private readonly connection: Connection,
    readonly epoch = libraryEpoch(connection),
  ) {
    const tables = connection
      .all<{ name: string }>(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .filter(
        ({ name }) =>
          !archiveControlTables.has(name) &&
          name !== '__brew_migrations' &&
          name !== 'articles_fts' &&
          !name.startsWith('articles_fts_'),
      );
    this.triggers = tables.flatMap(({ name: table }) =>
      ['INSERT', 'UPDATE', 'DELETE'].map((event) => {
        const name = 'brew_epoch_' + table + '_' + event;
        return {
          name,
          sql: `CREATE TEMP TRIGGER ${archiveQuote(name)} BEFORE ${event} ON main.${archiveQuote(table)} WHEN (SELECT epoch FROM __brew_library_identity WHERE id=1) IS NOT '${epoch}' BEGIN SELECT RAISE(ABORT,'The library was imported. Reopen Brew before changing it.'); END`,
        };
      }),
    );
    this.install();
  }
  private install() {
    for (const trigger of this.triggers) this.connection.run(trigger.sql);
  }
  assertCurrent() {
    if (libraryEpoch(this.connection) !== this.epoch)
      throw new Error('The library was imported. Reopen Brew before accessing it.');
  }
  /** Synchronous native admission cannot overlap another operation on this connection. */
  privileged<T>(work: () => T): T {
    for (const trigger of this.triggers)
      this.connection.run(`DROP TRIGGER temp.${archiveQuote(trigger.name)}`);
    try {
      return work();
    } finally {
      this.install();
    }
  }
}
