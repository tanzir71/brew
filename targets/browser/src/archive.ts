import type { ArchiveMetadata, ArchiveManifest } from '../../../packages/core/src/archive.js';
import type { ArchiveRows } from '../../../packages/db/src/archive-sql.js';
type Inspection = { manifest: ArchiveManifest; rows: ArchiveRows; counts: Record<string, number> };
function operation<T>(input: unknown, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./archive.worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: Error, value?: T) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () =>
      finish(new Error('Archive work was cancelled. The library was not changed.'));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            'The archive could not be processed within one minute. The library was not changed.',
          ),
        ),
      60000,
    );
    worker.onmessage = ({ data }) =>
      finish(data.ok ? undefined : new Error(data.error), data.value);
    worker.onerror = () =>
      finish(new Error('The archive worker stopped. The library was not changed.'));
    worker.onmessageerror = () =>
      finish(new Error('The archive worker returned an unreadable response.'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    else worker.postMessage(input);
  });
}
export const inspectBrowserArchive = (bytes: Uint8Array, signal?: AbortSignal) =>
  operation<Inspection>({ kind: 'inspect', bytes }, signal);
export const createBrowserArchive = (
  rows: ArchiveRows,
  metadata: Omit<ArchiveMetadata, 'migrations'>,
  signal?: AbortSignal,
) => operation<Uint8Array<ArrayBuffer>>({ kind: 'create', rows, metadata }, signal);
