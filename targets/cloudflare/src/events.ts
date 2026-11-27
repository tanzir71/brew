import type { EventsPort } from '../../../packages/api/src/ports.js';
import { CloudflareStorage } from './storage.js';

const revisionKey = 'library_revision';
export function libraryRevision(storage: CloudflareStorage) {
  return storage.statement(
    "INSERT INTO settings(key,value) VALUES(?,'1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1",
    [revisionKey],
  );
}
/** D1 revision polling crosses Worker isolates; bounded streams reconnect for catch-up. */
export class CloudflareEvents implements EventsPort {
  constructor(
    private storage: CloudflareStorage,
    private pollMs = 5_000,
    private lifetimeMs = 60_000,
  ) {}
  subscribe(listener: (event: string, data: unknown) => void, onClose: () => void) {
    let active = true,
      busy = false,
      previous: string | undefined;
    const stop = () => {
      active = false;
      clearInterval(interval);
      clearTimeout(expiry);
    };
    const close = () => {
      if (active) {
        stop();
        onClose();
      }
    };
    const poll = async () => {
      if (!active || busy) return;
      busy = true;
      try {
        const revision =
          (
            await this.storage.first<{ value: string }>('SELECT value FROM settings WHERE key=?', [
              revisionKey,
            ])
          )?.value ?? '0';
        if (active && revision !== previous) {
          previous = revision;
          listener('reader:sync', {});
        }
      } catch {
        close();
      } finally {
        busy = false;
      }
    };
    const interval = setInterval(() => void poll(), this.pollMs),
      expiry = setTimeout(close, this.lifetimeMs);
    void poll();
    return stop;
  }
}
