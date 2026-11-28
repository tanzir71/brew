import { wireError, fromWire } from './errors.js';
import { BrowserFetching } from './fetching.js';
import { BrowserSqlStorage } from './sql-storage.js';
import { BrowserApi } from './api.js';
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
    const timer =
      value.kind === 'notify'
        ? setTimeout(() => {
            pending.delete(id);
            reject(new Error('Browser notification did not acknowledge delivery.'));
          }, 10_000)
        : undefined;
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result as T);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    self.postMessage({ ...value, id });
  });
}
let runtime: BrowserFetching | undefined;
let api: BrowserApi | undefined;
let closing = false;
const activeHttp = new Set<Promise<void>>();
async function respond(id: number, work: () => Promise<unknown>) {
  try {
    self.postMessage({ id, ok: true, value: await work() });
  } catch (error) {
    self.postMessage({ id, ok: false, error: wireError(error) });
  }
}
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
      closing = true;
      runtime?.close();
      return;
    }
    const waiter = pending.get(data.id);
    pending.delete(data.id);
    if (data.ok) waiter?.resolve(data.value);
    else waiter?.reject(fromWire(data.error));
    return;
  }
  if (data.operation.kind === 'http') {
    const input = data.operation.request;
    const operation = respond(data.id, async () => {
      if (closing || !api) throw new Error('Browser library is closed.');
      return api.http(input);
    });
    activeHttp.add(operation);
    void operation.finally(() => activeHttp.delete(operation));
    return;
  }
  queue = queue.then(async () => {
    try {
      let value: unknown;
      switch (data.operation.kind) {
        case 'initialize': {
          const storage = new BrowserSqlStorage((queries) =>
            request<QueryResult[]>({ kind: 'sql', queries }),
          );
          const notifications = {
            notify: (article: { id: number; title: string; url: string }) =>
              request<void>({ kind: 'notify', article }),
          };
          runtime = new BrowserFetching(storage, notifications, data.operation.options.assetBase);
          value = await runtime.initialize();
          api = new BrowserApi(storage, runtime, notifications, data.operation.options);
          break;
        }
        case 'configure':
          value = await runtime!.configure(data.operation.config);
          break;
        case 'refresh':
          value = await runtime!.refresh(data.operation.feedId);
          if (!closing) await api!.scheduled();
          break;
        case 'close':
          runtime!.close();
          await Promise.allSettled([...activeHttp]);
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
