import type { Persistence } from './protocol.js';

export interface StoredDatabase {
  version: 1;
  persistence: Persistence;
  image?: Uint8Array<ArrayBuffer>;
}

/** One atomic record contains the durable backend choice and, for the fallback, its SQLite image. */
export class IndexedDbSnapshots {
  private constructor(
    private readonly database: IDBDatabase,
    private readonly name: string,
  ) {}
  static async open(name: string): Promise<IndexedDbSnapshots> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('brew-browser-storage-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('databases');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error('Browser storage is being upgraded in another tab.'));
    });
    database.onversionchange = () => database.close();
    return new IndexedDbSnapshots(database, name);
  }
  read(): Promise<StoredDatabase | undefined> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction('databases', 'readonly');
      const request = transaction.objectStore('databases').get(this.name);
      transaction.oncomplete = () => resolve(request.result as StoredDatabase | undefined);
      transaction.onabort = () => reject(transaction.error ?? request.error);
      transaction.onerror = () => reject(transaction.error ?? request.error);
    });
  }
  write(value: StoredDatabase): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction('databases', 'readwrite', {
        durability: 'strict',
      });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Browser storage commit aborted.'));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('Browser storage commit failed.'));
      try {
        transaction.objectStore('databases').put(value, this.name);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  }
  close() {
    this.database.close();
  }
}
