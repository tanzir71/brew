import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';

/** Ownership of an admitted image transfers to SQLite and is released with its connection. */
export function openSqliteImage(sqlite3: Sqlite3Static, image?: Uint8Array): Database {
  const db = new sqlite3.oo1.DB();
  try {
    if (image) {
      const pointer = sqlite3.wasm.allocFromTypedArray(new Uint8Array(image));
      const rc = sqlite3.capi.sqlite3_deserialize(
        db,
        'main',
        pointer,
        image.byteLength,
        image.byteLength,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
      );
      if (rc) {
        sqlite3.wasm.dealloc(pointer);
        db.checkRc(rc);
      }
    }
    db.exec('PRAGMA foreign_keys=ON');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
