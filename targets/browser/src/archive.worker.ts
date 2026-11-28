import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { WasmArchives } from '../../../packages/db/src/wasm-archive.js';
import type { ArchiveRows } from '../../../packages/db/src/archive-sql.js';
import type { ArchiveMetadata } from '../../../packages/core/src/archive.js';
import { migrations } from './migrations.js';
declare const self: DedicatedWorkerGlobalScope;
let archives: Promise<WasmArchives> | undefined;
self.onmessage = async ({
  data,
}: MessageEvent<
  | { kind: 'inspect'; bytes: Uint8Array }
  | { kind: 'create'; rows: ArchiveRows; metadata: Omit<ArchiveMetadata, 'migrations'> }
>) => {
  try {
    const service = await (archives ??= sqlite3InitModule().then(
      (sqlite) =>
        new WasmArchives(sqlite, migrations, Intl.DateTimeFormat().resolvedOptions().timeZone),
    ));
    const value =
      data.kind === 'inspect'
        ? await service.inspect(data.bytes)
        : await service.create(data.rows, data.metadata);
    self.postMessage({ ok: true, value }, value instanceof Uint8Array ? [value.buffer] : []);
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not read this Brew archive.',
    });
  }
};
