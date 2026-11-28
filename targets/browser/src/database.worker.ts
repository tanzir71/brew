import sqlite3InitModule, { type SAHPoolUtil } from '@sqlite.org/sqlite-wasm';
import { BrowserSqliteEngine } from './engine.js';
import { IndexedDbSnapshots } from './indexeddb.js';
import { migrations } from './migrations.js';
import type { OpenOptions, Operation, Request, Response } from './protocol.js';

declare const self: DedicatedWorkerGlobalScope;
let engine: BrowserSqliteEngine | undefined;
let snapshots: IndexedDbSnapshots | undefined;
let pool: SAHPoolUtil | undefined;
let releaseLock: (() => Promise<void>) | undefined;

async function acquire(name: string): Promise<() => Promise<void>> {
  if (!navigator.locks) throw new Error('This browser does not provide safe library locking.');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired!: () => void;
  let failed!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    acquired = resolve;
    failed = reject;
  });
  const lock = navigator.locks.request(
    `brew:database:${name}`,
    { ifAvailable: true },
    async (value) => {
      if (!value) {
        failed(new Error('This library is already open in another tab. Close it there and retry.'));
        return;
      }
      acquired();
      await held;
    },
  );
  lock.catch(failed);
  await ready;
  return async () => {
    release();
    await lock;
  };
}

async function close() {
  try {
    engine?.close();
  } finally {
    engine = undefined;
    try {
      pool?.pauseVfs();
    } finally {
      pool = undefined;
      snapshots?.close();
      snapshots = undefined;
      await releaseLock?.();
      releaseLock = undefined;
    }
  }
}

async function open(options: OpenOptions) {
  if (engine || releaseLock) throw new Error('This storage worker is already open.');
  const name = options.name ?? 'library';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error('Invalid browser library name.');
  const requested = options.persistence ?? 'auto';
  if (!['auto', 'opfs', 'indexeddb'].includes(requested))
    throw new Error('Invalid browser persistence option.');
  releaseLock = await acquire(name);
  try {
    snapshots = await IndexedDbSnapshots.open(name);
    const stored = await snapshots.read();
    if (stored && (stored.version !== 1 || !['opfs', 'indexeddb'].includes(stored.persistence)))
      throw new Error('Unsupported browser library format.');
    if (stored && requested !== 'auto' && requested !== stored.persistence)
      throw new Error(
        `This library uses ${stored.persistence}; changing its storage needs an explicit migration.`,
      );
    const supportsOpfs =
      typeof FileSystemFileHandle !== 'undefined' &&
      'createSyncAccessHandle' in FileSystemFileHandle.prototype &&
      Boolean(navigator.storage?.getDirectory);
    const persistence =
      stored?.persistence ??
      (requested === 'auto' ? (supportsOpfs ? 'opfs' : 'indexeddb') : requested);
    const sqlite3 = await sqlite3InitModule();
    if (persistence === 'opfs') {
      if (!supportsOpfs)
        throw new Error('The existing OPFS library is unavailable in this browser context.');
      pool = await sqlite3.installOpfsSAHPoolVfs({
        name: `brew-${name}`,
        directory: `/.brew-${name}`,
        initialCapacity: 6,
        preserveOnInitFailure: true,
      });
      engine = new BrowserSqliteEngine(sqlite3, new pool.OpfsSAHPoolDb('/brew.db'));
      await snapshots.write({ version: 1, persistence });
    } else {
      if (stored && (!(stored.image instanceof Uint8Array) || stored.image.byteLength === 0))
        throw new Error('The saved SQLite image is missing or empty.');
      const store = snapshots;
      engine = new BrowserSqliteEngine(
        sqlite3,
        BrowserSqliteEngine.memory(sqlite3, stored?.image),
        (image) => store.write({ version: 1, persistence, image }),
      );
    }
    await engine.migrate(migrations, Intl.DateTimeFormat().resolvedOptions().timeZone);
    return {
      persistence,
      sqliteVersion: sqlite3.version.libVersion,
      migrations: migrations.length,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function operate(operation: Operation): Promise<unknown> {
  if (operation.kind === 'open') return open(operation.options);
  if (operation.kind === 'close') return close();
  if (!engine) throw new Error('Browser storage is not open.');
  switch (operation.kind) {
    case 'execute':
      return engine.execute(operation.queries);
    case 'begin':
      return engine.begin();
    case 'commit':
      return engine.commit();
    case 'rollback':
      return engine.rollback();
    case 'export':
      return engine.image();
  }
}

let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  queue = queue.then(async () => {
    let response: Response;
    try {
      response = { id: request.id, ok: true, value: await operate(request.operation) };
    } catch (error) {
      response = {
        id: request.id,
        ok: false,
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    self.postMessage(response);
  });
};
