import { beforeAll, expect, test } from 'vitest';
import init, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import NativeSqlite from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BrowserSqliteEngine } from '../src/engine.js';
import { migrateDatabase } from '../../node/src/db/database.js';
import { migrateSqlite, type Migration } from '../../../packages/db/src/migrate.js';

const directory = fileURLToPath(new URL('../../../packages/db/migrations/', import.meta.url));
const migrations: Migration[] = readdirSync(directory)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(directory + '/' + name, 'utf8') }));
let sqlite3: Sqlite3Static;
beforeAll(async () => {
  sqlite3 = await init();
});
const memory = (save?: (image: Uint8Array<ArrayBuffer>) => Promise<void>) =>
  new BrowserSqliteEngine(sqlite3, BrowserSqliteEngine.memory(sqlite3), save);
const feed = {
  sql: 'INSERT INTO feeds(id,title,url) VALUES(1,?,?)',
  params: ['Notes', 'https://example.test/feed'],
};
const article = {
  sql: 'INSERT INTO articles(id,feed_id,guid,url,title,content_html,published_at,hash) VALUES(1,1,?,?,?,?,?,?)',
  params: [
    'one',
    'https://example.test/one',
    'Café typography',
    '<p>Quiet interfaces</p>',
    1000,
    'hash',
  ],
};

test('the actual WASM engine runs every canonical migration and maintains FTS5 through update and cascade', async () => {
  const engine = memory();
  try {
    await engine.migrate(migrations, 'Asia/Dhaka');
    expect(
      (await engine.execute([{ sql: 'SELECT count(*) FROM __brew_migrations' }]))[0]!.rows,
    ).toEqual([[20]]);
    await engine.execute([feed, article]);
    expect(
      (
        await engine.execute([
          { sql: "SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'cafe'" },
        ])
      )[0]!.rows,
    ).toEqual([[1]]);
    await engine.execute([
      { sql: "UPDATE articles SET title='Letterpress',full_text_html='Wood type' WHERE id=1" },
    ]);
    expect(
      (
        await engine.execute([
          { sql: "SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'cafe'" },
        ])
      )[0]!.rows,
    ).toEqual([]);
    expect(
      (
        await engine.execute([
          { sql: "SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'wood'" },
        ])
      )[0]!.rows,
    ).toEqual([[1]]);
    await engine.execute([{ sql: 'DELETE FROM feeds WHERE id=1' }]);
    expect((await engine.execute([{ sql: 'SELECT count(*) FROM articles_fts' }]))[0]!.rows).toEqual(
      [[0]],
    );
  } finally {
    engine.close();
  }
});

test('a rejected native SQL batch rolls back both data and its search index', async () => {
  const engine = memory();
  try {
    await engine.migrate(migrations, 'UTC');
    await expect(engine.execute([feed, article, feed])).rejects.toThrow();
    expect(
      (
        await engine.execute([
          { sql: 'SELECT count(*) FROM feeds' },
          { sql: 'SELECT count(*) FROM articles_fts' },
        ])
      ).map((r) => r.rows),
    ).toEqual([[[0]], [[0]]]);
    await expect(engine.execute([article])).rejects.toThrow(/FOREIGN KEY/);
  } finally {
    engine.close();
  }
});

test('failed snapshot persistence restores the acknowledged image and allows a later real write', async () => {
  let durable!: Uint8Array<ArrayBuffer>;
  let fail = false;
  const engine = memory(async (image) => {
    if (fail) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    durable = image.slice();
  });
  try {
    await engine.migrate(migrations, 'UTC');
    fail = true;
    await expect(engine.execute([feed, article])).rejects.toThrow('Quota exceeded');
    expect((await engine.execute([{ sql: 'SELECT count(*) FROM feeds' }]))[0]!.rows).toEqual([[0]]);
    const persisted = new NativeSqlite(Buffer.from(durable));
    expect(persisted.prepare('SELECT count(*) AS n FROM articles_fts').get()).toEqual({ n: 0 });
    persisted.close();
    fail = false;
    await engine.execute([feed, article]);
    const reopened = new NativeSqlite(Buffer.from(durable));
    expect(
      reopened.prepare("SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'quiet'").all(),
    ).toEqual([{ rowid: 1 }]);
    reopened.close();
  } finally {
    engine.close();
  }
});

test('writes are not acknowledged while their persistent snapshot is still pending', async () => {
  let release: (() => void) | undefined;
  let hold = false;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const engine = memory(async () => {
    if (hold) {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
  });
  try {
    await engine.migrate(migrations, 'UTC');
    hold = true;
    let acknowledged = false;
    const write = engine.execute([feed]).then(() => {
      acknowledged = true;
    });
    await Promise.race([entered, write]);
    expect(acknowledged).toBe(false);
    release!();
    await write;
    expect(acknowledged).toBe(true);
  } finally {
    release?.();
    engine.close();
  }
});

test('Node and WASM migrate the same legacy SQLite bytes with identical composition data', async () => {
  const node = new NativeSqlite(':memory:');
  let engine: BrowserSqliteEngine | undefined;
  try {
    migrateSqlite(
      {
        exec: (sql) => {
          node.exec(sql);
        },
        all: <T>(sql: string, values: unknown[] = []) => node.prepare(sql).all(...values) as T[],
        run: (sql, values) => {
          node.prepare(sql).run(...values);
        },
        transaction: (work) => {
          node.transaction(work)();
        },
      },
      migrations.slice(0, 5),
      'UTC',
    );
    node
      .prepare('INSERT INTO brew_configs(name,enabled,schedule_cron,sections_json) VALUES(?,?,?,?)')
      .run('Weekend', 1, '0 7 * * 6', '[]');
    engine = new BrowserSqliteEngine(
      sqlite3,
      BrowserSqliteEngine.memory(sqlite3, node.serialize()),
    );
    await engine.migrate(migrations, Intl.DateTimeFormat().resolvedOptions().timeZone);
    migrateDatabase(node);
    const transferred = new NativeSqlite(Buffer.from(engine.image()));
    try {
      expect(transferred.prepare('SELECT * FROM brew_configs').all()).toEqual(
        node.prepare('SELECT * FROM brew_configs').all(),
      );
      expect(transferred.prepare('SELECT name FROM __brew_migrations ORDER BY name').all()).toEqual(
        node.prepare('SELECT name FROM __brew_migrations ORDER BY name').all(),
      );
      expect(transferred.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(transferred.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      transferred.close();
    }
    await engine.migrate(migrations, 'UTC');
    expect(
      (await engine.execute([{ sql: 'SELECT count(*) FROM __brew_migrations' }]))[0]!.rows,
    ).toEqual([[20]]);
  } finally {
    engine?.close();
    node.close();
  }
});

test('failed migration data and DDL roll back without advancing the durable migration ledger', async () => {
  let durable!: Uint8Array<ArrayBuffer>;
  const engine = memory(async (image) => {
    durable = image.slice();
  });
  try {
    await engine.migrate(migrations, 'UTC');
    await expect(
      engine.migrate(
        [
          ...migrations,
          {
            name: '0021_bad.sql',
            sql: 'CREATE TABLE incomplete(x); INSERT INTO missing VALUES(1);',
          },
        ],
        'UTC',
      ),
    ).rejects.toThrow();
    const persisted = new NativeSqlite(Buffer.from(durable));
    try {
      expect(
        persisted.prepare("SELECT name FROM sqlite_master WHERE name='incomplete'").get(),
      ).toBeUndefined();
      expect(
        persisted.prepare("SELECT name FROM __brew_migrations WHERE name='0021_bad.sql'").get(),
      ).toBeUndefined();
    } finally {
      persisted.close();
    }
  } finally {
    engine.close();
  }
});

test('explicit multi-query transactions roll back without exposing a partially updated database', async () => {
  const engine = memory();
  try {
    await engine.migrate(migrations, 'UTC');
    engine.begin();
    await engine.execute([feed]);
    await engine.execute([article]);
    expect(() => engine.image()).toThrow('unfinished transaction');
    engine.rollback();
    expect((await engine.execute([{ sql: 'SELECT count(*) FROM feeds' }]))[0]!.rows).toEqual([[0]]);
  } finally {
    engine.close();
  }
});

test('raw SQL cannot bypass transaction or database ownership and never silently drops extra statements', async () => {
  const engine = memory();
  try {
    await engine.migrate(migrations, 'UTC');
    for (const sql of [
      'COMMIT',
      'END',
      'ROLLBACK',
      'BEGIN',
      'SAVEPOINT stray',
      'RELEASE stray',
      "ATTACH DATABASE ':memory:' AS stray",
      'DETACH DATABASE main',
    ])
      await expect(engine.execute([{ sql }])).rejects.toThrow();
    await expect(
      engine.execute([
        { sql: "INSERT INTO tags(name) VALUES('first'); INSERT INTO tags(name) VALUES('lost')" },
      ]),
    ).rejects.toThrow('one SQL statement');
    await expect(engine.execute([{ sql: 'SELECT 1\0; SELECT 2' }])).rejects.toThrow('NUL');
    expect(
      (await engine.execute([{ sql: "SELECT ';' AS value; -- trailing comment" }]))[0]!.rows,
    ).toEqual([[';']]);
    expect((await engine.execute([{ sql: 'SELECT count(*) FROM tags' }]))[0]!.rows).toEqual([[0]]);
    await engine.execute([feed]);
  } finally {
    engine.close();
  }
});

test('SQLite implicit rollback preserves the original error and requires rollback before reusing an explicit transaction', async () => {
  const engine = memory();
  try {
    await engine.migrate(migrations, 'UTC');
    await engine.execute([feed]);
    await expect(
      engine.execute([
        {
          sql: "INSERT OR ROLLBACK INTO feeds(id,title,url) VALUES(1,'duplicate','https://duplicate.test')",
        },
      ]),
    ).rejects.toThrow(/UNIQUE/);
    engine.begin();
    await expect(
      engine.execute([
        {
          sql: "INSERT OR ROLLBACK INTO feeds(id,title,url) VALUES(1,'duplicate','https://duplicate.test')",
        },
      ]),
    ).rejects.toThrow(/UNIQUE/);
    await expect(engine.execute([{ sql: 'SELECT 1' }])).rejects.toThrow('already rolled back');
    await expect(engine.commit()).rejects.toThrow('already rolled back');
    engine.rollback();
    expect((await engine.execute([{ sql: 'SELECT count(*) FROM feeds' }]))[0]!.rows).toEqual([[1]]);
  } finally {
    engine.close();
  }
});

test('archive replacement persists the complete library and fences the old WASM service scope until reopen', async () => {
  let durable!: Uint8Array<ArrayBuffer>;
  const source = memory();
  const target = memory(async (image) => {
    durable = image.slice();
  });
  let reopened: BrowserSqliteEngine | undefined;
  try {
    await source.migrate(migrations, 'UTC');
    await source.execute([feed, article]);
    await target.migrate(migrations, 'UTC');
    await target.execute([{ sql: "INSERT INTO tags(name,color) VALUES('Old target','#123456')" }]);
    const rows = source.archiveRows();
    await target.replaceArchive(rows);
    await expect(target.execute([{ sql: 'SELECT title FROM articles' }])).rejects.toThrow(/Reopen/);
    await expect(target.execute([{ sql: "UPDATE articles SET title='stale'" }])).rejects.toThrow(
      /Reopen/,
    );
    expect(() => target.image()).toThrow(/Reopen/);
    expect(() => target.archiveRows()).toThrow(/Reopen/);
    reopened = new BrowserSqliteEngine(sqlite3, BrowserSqliteEngine.memory(sqlite3, durable));
    await reopened.migrate(migrations, 'UTC');
    expect(reopened.archiveRows()).toEqual(rows);
    expect(
      (
        await reopened.execute([
          { sql: "SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'cafe'" },
        ])
      )[0]!.rows,
    ).toEqual([[1]]);
  } finally {
    source.close();
    target.close();
    reopened?.close();
  }
});

test('failed archive persistence keeps the old acknowledged library and permits a later retry', async () => {
  let durable!: Uint8Array<ArrayBuffer>;
  let fail = false;
  const source = memory();
  const target = memory(async (image) => {
    if (fail) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    durable = image.slice();
  });
  try {
    await source.migrate(migrations, 'UTC');
    await source.execute([feed, article]);
    await target.migrate(migrations, 'UTC');
    await target.execute([{ sql: "INSERT INTO tags(name,color) VALUES('Keep me','#123456')" }]);
    const before = target.archiveRows();
    const image = durable.slice();
    fail = true;
    await expect(target.replaceArchive(source.archiveRows())).rejects.toThrow('Quota exceeded');
    expect(target.archiveRows()).toEqual(before);
    expect(durable).toEqual(image);
    fail = false;
    await target.execute([{ sql: "UPDATE tags SET name='Still writable'" }]);
    await target.replaceArchive(source.archiveRows());
    await expect(target.execute([{ sql: 'SELECT title FROM articles' }])).rejects.toThrow(/Reopen/);
  } finally {
    source.close();
    target.close();
  }
});

test('a late archive constraint failure rolls back data, search and identity without invalidating current services', async () => {
  const source = memory();
  const target = memory();
  try {
    await source.migrate(migrations, 'UTC');
    await source.execute([feed, article]);
    await target.migrate(migrations, 'UTC');
    await target.execute([feed, article]);
    const before = target.archiveRows();
    const rows = source.archiveRows();
    rows.tables
      .find((table) => table.name === 'settings')!
      .rows.push(['duplicate', 'one'], ['duplicate', 'two']);
    await expect(target.replaceArchive(rows)).rejects.toThrow(/UNIQUE/);
    expect(target.archiveRows()).toEqual(before);
    expect(
      (
        await target.execute([
          { sql: "SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'cafe'" },
        ])
      )[0]!.rows,
    ).toEqual([[1]]);
  } finally {
    source.close();
    target.close();
  }
});

test('replacement rejects control tables and invalid row shapes before touching the library', async () => {
  const engine = memory();
  try {
    await engine.migrate(migrations, 'UTC');
    await engine.execute([feed, article]);
    const before = engine.archiveRows();
    const rows = engine.archiveRows();
    rows.tables.push({
      name: '__brew_library_identity',
      columns: ['id', 'epoch'],
      rows: [[1, '0'.repeat(32)]],
    });
    await expect(engine.replaceArchive(rows)).rejects.toThrow(/schema/);
    const invalid = engine.archiveRows();
    invalid.tables.find((table) => table.name === 'articles')!.rows[0]!.push('extra column');
    await expect(engine.replaceArchive(invalid)).rejects.toThrow(/value/);
    expect(engine.archiveRows()).toEqual(before);
  } finally {
    engine.close();
  }
});
