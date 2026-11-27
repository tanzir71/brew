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
  async publish(type: 'notification', data: { id: number; title: string; url: string }) {
    await this.storage.batch([
      this.storage.statement(
        'INSERT INTO instance_events(article_id,type,data_json) VALUES(?,?,?)',
        [data.id, type, JSON.stringify(data)],
      ),
      this.storage.statement(
        'DELETE FROM instance_events WHERE id NOT IN (SELECT id FROM instance_events ORDER BY id DESC LIMIT 256)',
      ),
      libraryRevision(this.storage),
    ]);
  }
  subscribe(listener: (event: string, data: unknown) => void, onClose: () => void) {
    let active = true,
      busy = false,
      previous: string | undefined,
      cursor: number | undefined;
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
        const result = await this.storage.batch([
          this.storage.statement(
            "SELECT coalesce((SELECT value FROM settings WHERE key=?),'0') AS revision,coalesce((SELECT max(id) FROM instance_events),0) AS last",
            [revisionKey],
          ),
          this.storage.statement(
            'SELECT id,type,data_json AS data FROM instance_events WHERE id>? ORDER BY id',
            [cursor ?? Number.MAX_SAFE_INTEGER],
          ),
        ]);
        const state = result[0]!.results[0]!;
        const revision = String(state.revision);
        // Like Node's live broker, a new connection starts with future notices.
        // The revision still catches up the library after a disconnected period.
        cursor = Number(state.last);
        if (active && revision !== previous) {
          previous = revision;
          listener('reader:sync', {});
        }
        if (active)
          for (const event of result[1]!.results)
            listener(String(event.type), JSON.parse(String(event.data)));
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
