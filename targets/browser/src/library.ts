import { wireError, fromWire } from './errors.js';
import { BrowserDatabase } from './index.js';
import type { OpenOptions } from './protocol.js';
import type { FetchCycle, RelayStatus } from './fetching.js';
import type { RelayConfig } from './relay.js';
import type { LibraryOperation, LibraryReply, WorkerRequest } from './library-protocol.js';
import type { NotificationPort } from '../../../packages/core/src/ports.js';
import type { BrowserHttpResponse } from './api.js';

export interface BrowserLibraryOptions extends OpenOptions {
  assetBase?: string;
  webmcp?: boolean;
  timezone?: string;
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
      await library.request<RelayStatus>({
        kind: 'initialize',
        options: {
          origin: window.location.origin,
          assetBase: options.assetBase ?? new URL('./', window.location.href).href,
          timezone: options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          webmcp: options.webmcp === true,
        },
      });
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
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (this.closing) throw new Error('Browser library is closed.');
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(new URL(String(input), window.location.origin), init);
    if (request.signal.aborted) throw request.signal.reason;
    const body = ['GET', 'HEAD'].includes(request.method)
      ? undefined
      : new Uint8Array(await request.arrayBuffer());
    if (this.closing) throw new Error('Browser library is closed.');
    const headers = new Headers(request.headers);
    if (!['GET', 'HEAD'].includes(request.method) && !headers.has('Origin'))
      headers.set('Origin', window.location.origin);
    const pending = this.request<BrowserHttpResponse>({
      kind: 'http',
      request: {
        url: request.url,
        method: request.method,
        headers: [...headers],
        body,
      },
    });
    const result = await new Promise<BrowserHttpResponse>((resolve, reject) => {
      const abort = () => {
        request.signal.removeEventListener('abort', abort);
        reject(request.signal.reason);
      };
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
      pending.then(
        (value) => {
          request.signal.removeEventListener('abort', abort);
          resolve(value);
        },
        (error) => {
          request.signal.removeEventListener('abort', abort);
          reject(error);
        },
      );
    });
    return new Response(
      request.method === 'HEAD' || [204, 205, 304].includes(result.status)
        ? null
        : (result.body as BodyInit),
      result,
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
