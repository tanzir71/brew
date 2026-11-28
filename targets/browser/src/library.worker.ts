import { wireError, fromWire } from './errors.js';
import { BrowserFetching } from './fetching.js';
import { BrowserSqlStorage } from './sql-storage.js';
import type { QueryResult } from './protocol.js';
import type { LibraryOperation, WorkerReply, WorkerRequest } from './library-protocol.js';

let nextId = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
function request<T>(
  value:
    | Omit<Extract<WorkerRequest, { kind: 'sql' }>, 'id'>
    | Omit<Extract<WorkerRequest, { kind: 'notify' }>, 'id'>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve: (result) => resolve(result as T), reject });
    self.postMessage({ ...value, id });
  });
}
let runtime: BrowserFetching | undefined;
let queue = Promise.resolve();
self.onmessage = ({
  data,
}: MessageEvent<
  WorkerReply | { kind: 'abort' } | { kind: 'halt' } | { id: number; operation: LibraryOperation }
>) => {
  if ('kind' in data) {
    if (data.kind === 'abort') {
      runtime?.abort();
      return;
    }
    if (data.kind === 'halt') {
      runtime?.close();
      return;
    }
    const waiter = pending.get(data.id);
    pending.delete(data.id);
    if (data.ok) waiter?.resolve(data.value);
    else waiter?.reject(fromWire(data.error));
    return;
  }
  queue = queue.then(async () => {
    try {
      let value: unknown;
      switch (data.operation.kind) {
        case 'initialize':
          runtime = new BrowserFetching(
            new BrowserSqlStorage((queries) => request<QueryResult[]>({ kind: 'sql', queries })),
            { notify: (article) => request<void>({ kind: 'notify', article }) },
          );
          value = await runtime.initialize();
          break;
        case 'configure':
          value = await runtime!.configure(data.operation.config);
          break;
        case 'refresh':
          value = await runtime!.refresh(data.operation.feedId);
          break;
        case 'close':
          runtime!.close();
          break;
      }
      self.postMessage({ id: data.id, ok: true, value });
    } catch (error) {
      self.postMessage({
        id: data.id,
        ok: false,
        error: wireError(error),
      });
    }
  });
};
