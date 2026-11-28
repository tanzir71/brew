import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from './src/db/database.js';
import {
  exportNodeArchive,
  inspectNodeArchive,
  importNodeArchive,
  nativeArchiveSql,
} from './src/ports/archive.js';
import { createBrewArchive, readBrewArchive } from '../../packages/core/src/archive.js';
import { captureArchiveRows, replaceArchiveRows } from '../../packages/db/src/archive-sql.js';

const hash = {
  sha256: async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex'),
};
const metadata = { createdAt: '2026-11-28T12:00:00.000Z' };
function removeTemporaryDirectory(directory: string) {
  const absolute = path.resolve(directory);
  if (
    path.dirname(absolute) !== path.resolve(tmpdir()) ||
    !path.basename(absolute).startsWith('brew-archive-')
  )
    throw new Error('Unexpected archive test directory.');
  rmSync(absolute, { recursive: true });
}
function seed(filename = ':memory:') {
  const db = openDatabase(filename);
  db.sqlite.exec(
    "INSERT INTO folders(id,title) VALUES(10,'Design'); INSERT INTO feeds(id,folder_id,url,title,kind) VALUES(20,10,'https://example.test/private?key=secret','Private sample','newsletter'); INSERT INTO tags(id,name,color) VALUES(30,'Saved','#123456'); INSERT INTO articles(id,feed_id,guid,url,title,content_html,published_at,hash,read_at,starred_at,raw_html) VALUES(40,20,'a','https://example.test/a','Café archive','<p>Private letter text</p>',1000,'hash',2000,3000,'<p>Uncleaned original</p>'); INSERT INTO article_tags VALUES(40,30); INSERT INTO api_tokens(name,token_hash,scopes,created_at,expires_at) VALUES('My agent','hashed-secret','read',1000,9999999999999); INSERT INTO settings(key,value) VALUES('test-private-setting','keep me');",
  );
  db.sqlite.prepare("UPDATE sqlite_sequence SET seq=100 WHERE name='articles'").run();
  return db;
}
it('round-trips real canonical SQLite, FTS, private letters, state, settings, tokens and sequence high-water marks', async () => {
  const source = seed();
  const directory = mkdtempSync(path.join(tmpdir(), 'brew-archive-unit-'));
  const filename = path.join(directory, 'target.db');
  let target = openDatabase(filename);
  try {
    const bytes = await exportNodeArchive(source, metadata);
    const file = await readBrewArchive(bytes, hash);
    expect(file.database.slice(0, 16)).toEqual(new TextEncoder().encode('SQLite format 3\0'));
    expect(file.database[18]).toBe(1);
    const inspected = await inspectNodeArchive(bytes);
    expect(inspected.counts.articles).toBe(1);
    expect(inspected.counts.feeds).toBe(1);
    target.sqlite.exec(
      "INSERT INTO feeds(id,url,title) VALUES(99,'https://old.test','Old library')",
    );
    importNodeArchive(target, inspected);
    expect(() => target.sqlite.prepare('SELECT title FROM articles').all()).toThrow(/Reopen/);
    target.close();
    target = openDatabase(filename);
    expect(
      target.sqlite.prepare('SELECT title,read_at,starred_at,raw_html FROM articles').get(),
    ).toEqual({
      title: 'Café archive',
      read_at: 2000,
      starred_at: 3000,
      raw_html: '<p>Uncleaned original</p>',
    });
    expect(target.sqlite.prepare('SELECT url,kind FROM feeds').get()).toEqual({
      url: 'https://example.test/private?key=secret',
      kind: 'newsletter',
    });
    expect(target.sqlite.prepare('SELECT name,token_hash FROM api_tokens').get()).toEqual({
      name: 'My agent',
      token_hash: 'hashed-secret',
    });
    expect(
      target.sqlite.prepare("SELECT value FROM settings WHERE key='test-private-setting'").get(),
    ).toEqual({ value: 'keep me' });
    expect(
      target.sqlite.prepare("SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'Café'").all(),
    ).toEqual([{ rowid: 40 }]);
    expect(target.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(target.sqlite.prepare('PRAGMA integrity_check').get()).toEqual({
      integrity_check: 'ok',
    });
    expect(
      target.sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name='articles'").get(),
    ).toEqual({ seq: 100 });
    const again = await exportNodeArchive(target, metadata);
    expect((await inspectNodeArchive(again)).rows).toEqual(inspected.rows);
  } finally {
    source.close();
    target.close();
    removeTemporaryDirectory(directory);
  }
});

it('rejects old reads and writes on both importing and independent native connections, including cached statements', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'brew-archive-fence-'));
  const filename = path.join(directory, 'library.db');
  const owner = seed(filename);
  const old = openDatabase(filename);
  const source = seed();
  const read = old.sqlite.prepare('SELECT title FROM articles WHERE id=?').safeIntegers(true);
  const update = old.sqlite.prepare('UPDATE articles SET title=? WHERE id=?');
  const lazy = old.sqlite.prepare('SELECT title FROM articles').iterate();
  try {
    expect(read.get(40)).toEqual({ title: 'Café archive' });
    source.sqlite.exec("UPDATE articles SET title='Replacement private letter' WHERE id=40");
    importNodeArchive(owner, await inspectNodeArchive(await exportNodeArchive(source, metadata)));
    for (const database of [owner, old]) {
      expect(() => database.sqlite.prepare('SELECT title FROM articles').all()).toThrow(/Reopen/);
      expect(() =>
        database.sqlite.exec("UPDATE articles SET title='stale write' WHERE id=40"),
      ).toThrow(/Reopen/);
    }
    expect(() => read.get(40)).toThrow(/Reopen/);
    expect(() => read.raw().all(40)).toThrow(/Reopen/);
    expect(() => update.run('stale write', 40)).toThrow(/Reopen/);
    expect(() => lazy.next()).toThrow(/Reopen/);
    await expect(exportNodeArchive(old, metadata)).rejects.toThrow(/Reopen/);
    const reopened = openDatabase(filename);
    try {
      expect(reopened.sqlite.prepare('SELECT title FROM articles WHERE id=40').get()).toEqual({
        title: 'Replacement private letter',
      });
      const iterator = reopened.sqlite.prepare('SELECT title FROM articles').iterate();
      try {
        expect(iterator.next().value).toEqual({ title: 'Replacement private letter' });
      } finally {
        iterator.return?.();
      }
      reopened.sqlite.prepare('UPDATE articles SET read_at=? WHERE id=?').run(5555, 40);
    } finally {
      reopened.close();
    }
  } finally {
    source.close();
    owner.close();
    old.close();
    removeTemporaryDirectory(directory);
  }
});
it('validates an imported database against trusted migrations before exposing rows', async () => {
  const source = seed();
  try {
    const archive = await readBrewArchive(await exportNodeArchive(source, metadata), hash);
    const modified = new Database(Buffer.from(archive.database));
    try {
      modified.exec(
        'CREATE TRIGGER malicious AFTER INSERT ON feeds BEGIN DELETE FROM articles; END',
      );
      const bytes = await createBrewArchive(modified.serialize(), archive.manifest, hash);
      await expect(inspectNodeArchive(bytes)).rejects.toThrow(/schema/);
    } finally {
      modified.close();
    }
  } finally {
    source.close();
  }
});
it('rejects a checksum-valid database with broken references without changing the destination', async () => {
  const source = seed();
  const target = seed();
  try {
    const archive = await readBrewArchive(await exportNodeArchive(source, metadata), hash);
    const modified = new Database(Buffer.from(archive.database));
    try {
      modified.pragma('foreign_keys=OFF');
      modified.exec('UPDATE articles SET feed_id=999');
      await expect(
        inspectNodeArchive(await createBrewArchive(modified.serialize(), archive.manifest, hash)),
      ).rejects.toThrow(/references/);
      expect(target.sqlite.prepare('SELECT feed_id FROM articles').get()).toEqual({ feed_id: 20 });
    } finally {
      modified.close();
    }
  } finally {
    source.close();
    target.close();
  }
});
it('rolls back the entire replacement and FTS after a late SQL failure', () => {
  const source = seed();
  const target = seed();
  try {
    const rows = captureArchiveRows(
      nativeArchiveSql(source.sqlite),
      nativeArchiveSql(source.sqlite),
    );
    rows.tables
      .find((table) => table.name === 'settings')!
      .rows.push(['test-private-setting', 'duplicate']);
    expect(() => replaceArchiveRows(nativeArchiveSql(target.sqlite), rows)).toThrow();
    expect(
      target.sqlite.prepare("SELECT value FROM settings WHERE key='test-private-setting'").get(),
    ).toEqual({ value: 'keep me' });
    expect(
      target.sqlite.prepare("SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'Café'").all(),
    ).toEqual([{ rowid: 40 }]);
    expect(target.sqlite.prepare('SELECT count(*) AS total FROM articles').get()).toEqual({
      total: 1,
    });
  } finally {
    source.close();
    target.close();
  }
});
