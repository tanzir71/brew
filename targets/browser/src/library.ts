import { wireError, fromWire } from './errors.js';
import { BrowserDatabase } from './index.js';
import type { OpenOptions } from './protocol.js';
import type { FetchCycle, RelayStatus } from './fetching.js';
import type { RelayConfig } from './relay.js';
import type { LibraryOperation, LibraryReply, WorkerRequest } from './library-protocol.js';
import type { NotificationPort } from '../../../packages/core/src/ports.js';

export interface BrowserLibraryOptions extends OpenOptions {
  notifications?: NotificationPort;
  onCycle?(result: FetchCycle): void;
  onError?(message: string): void;
}
export class BrowserLibrary {
  private worker = new Worker(new URL('./library.worker.ts', import.meta.url), { type: 'module' });
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  private nextId = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private due: Promise<FetchCycle> | undefined;
  private closing: Promise<void> | undefined;
  private dead = false;
  private wake = () => {
    if (document.visibilityState !== 'hidden') this.background();
  };
  private constructor(
    readonly storage: BrowserDatabase,
    private options: BrowserLibraryOptions,
  ) {
    this.worker.onmessage = async ({ data }: MessageEvent<LibraryReply | WorkerRequest>) => {
      if ('kind' in data) {
        try {
          if (data.kind === 'notify' && !options.notifications)
            throw new Error('Enable browser notifications before using a notify rule.');
          const value =
            data.kind === 'sql'
              ? await storage.execute(data.queries)
              : await options.notifications?.notify(data.article);
          this.worker.postMessage({ kind: 'reply', id: data.id, ok: true, value });
        } catch (error) {
          this.worker.postMessage({
            kind: 'reply',
            id: data.id,
            ok: false,
            error: wireError(error),
          });
        }
      } else {
        const pending = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.ok) pending?.resolve(data.value);
        else pending?.reject(fromWire(data.error));
      }
    };
    this.worker.onerror = () => this.fail(new Error('Browser fetching worker failed.'));
    this.worker.onmessageerror = () =>
      this.fail(new Error('Browser fetching returned an unreadable message.'));
  }
  static async open(options: BrowserLibraryOptions = {}) {
    const storage = await BrowserDatabase.open({
      name: options.name,
      persistence: options.persistence,
    });
    let library: BrowserLibrary | undefined;
    try {
      library = new BrowserLibrary(storage, options);
      await library.request<RelayStatus>({ kind: 'initialize' });
      library.timer = setInterval(() => library!.background(), 60_000);
      window.addEventListener('online', library.wake);
      window.addEventListener('pageshow', library.wake);
      document.addEventListener('visibilitychange', library.wake);
      library.background();
      return library;
    } catch (error) {
      library?.fail(new Error('Browser library could not open.'));
      await storage.close();
      throw error;
    }
  }
  private request<T>(operation: LibraryOperation): Promise<T> {
    if (this.dead) return Promise.reject(new Error('Browser library is closed.'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try {
        this.worker.postMessage({ id, operation });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  private background() {
    if (!this.closing)
      void this.refreshDue().catch((error) =>
        this.options.onError?.(error instanceof Error ? error.message : 'Browser fetching failed.'),
      );
  }
  refreshDue(): Promise<FetchCycle> {
    if (this.closing) return Promise.reject(new Error('Browser library is closed.'));
    if (!this.due)
      this.due = this.cycle().finally(() => {
        this.due = undefined;
      });
    return this.due;
  }
  private async cycle(feedId?: number) {
    const result = await this.request<FetchCycle>({ kind: 'refresh', feedId });
    this.options.onCycle?.(result);
    return result;
  }
  refreshFeed(feedId: number) {
    if (this.closing) return Promise.reject(new Error('Browser library is closed.'));
    if (!Number.isSafeInteger(feedId) || feedId <= 0)
      return Promise.reject(new TypeError('Use a positive feed ID.'));
    return this.cycle(feedId);
  }
  async configureRelay(config: RelayConfig | null) {
    if (this.closing) throw new Error('Browser library is closed.');
    this.worker.postMessage({ kind: 'abort' });
    return this.request<RelayStatus>({ kind: 'configure', config });
  }
  close() {
    return (this.closing ??= (async () => {
      clearInterval(this.timer);
      window.removeEventListener('online', this.wake);
      window.removeEventListener('pageshow', this.wake);
      document.removeEventListener('visibilitychange', this.wake);
      this.worker.postMessage({ kind: 'halt' });
      try {
        if (!this.dead) await this.request({ kind: 'close' });
      } finally {
        this.fail(new Error('Browser library is closed.'));
        await this.storage.close();
      }
    })());
  }
  private fail(error: Error) {
    this.dead = true;
    this.worker.terminate();
    clearInterval(this.timer);
    window.removeEventListener('online', this.wake);
    window.removeEventListener('pageshow', this.wake);
    document.removeEventListener('visibilitychange', this.wake);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
export const openBrowserLibrary = (options: BrowserLibraryOptions = {}) =>
  BrowserLibrary.open(options);
