import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import {
  MAX_NEWSLETTER_BYTES,
  NewsletterInputError,
} from '../../../../packages/core/src/newsletter-mime.js';
import type { NewsletterIngestResult } from '../../../../packages/core/src/types/newsletters.js';
import type { BrewDatabase } from '../db/database.js';
import type { ImapConfig } from '../inbound-config.js';

export interface ImapClient {
  mailbox: false | { uidValidity: bigint; uidNext: number; exists: number };
  connect(): Promise<void>;
  getMailboxLock(path: string, options: { readOnly: true }): Promise<{ release(): void }>;
  search(query: { uid: string }, options: { uid: true }): Promise<number[] | false | undefined>;
  fetchOne(
    uid: number,
    query: { uid?: boolean; size?: boolean; source?: { start: number; maxLength: number } },
    options: { uid: true },
  ): Promise<false | { uid: number; size?: number; source?: Uint8Array }>;
  logout(): Promise<void>;
  close(): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
}
export type ImapClientFactory = (config: ImapConfig) => ImapClient;
export const createImapClient: ImapClientFactory = (config) =>
  new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.security === 'tls',
    doSTARTTLS: config.security === 'starttls' ? true : undefined,
    auth: { user: config.user, pass: config.password },
    tls: { rejectUnauthorized: true },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
interface ImapCursor {
  uidValidity: string;
  uid: number;
  lastRejectedUid?: number;
}
export interface ImapPollResult {
  processed: number;
  rejected: number;
  error?: 'connection' | 'processing';
}

export class ImapPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<ImapPollResult> | null = null;
  private client: ImapClient | null = null;
  private stopped = false;
  readonly cursorKey: string;
  constructor(
    private readonly database: BrewDatabase,
    private readonly config: ImapConfig,
    private readonly ingest: (raw: Uint8Array) => Promise<NewsletterIngestResult>,
    private readonly inserted: (result: NewsletterIngestResult) => void = () => undefined,
    private readonly factory: ImapClientFactory = createImapClient,
    private readonly report: (result: ImapPollResult) => void = () => undefined,
  ) {
    // Account identity excludes the password so rotation resumes the same cursor.
    this.cursorKey = `inbound-imap:${createHash('sha256')
      .update(
        JSON.stringify([config.host, config.port, config.security, config.user, config.mailbox]),
      )
      .digest('hex')}`;
  }
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.pollNow();
    }, this.config.everySeconds * 1000);
    void this.pollNow();
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client?.close();
    await this.inFlight;
  }
  pollNow(): Promise<ImapPollResult> {
    if (this.inFlight) return this.inFlight;
    if (this.stopped) return Promise.resolve({ processed: 0, rejected: 0 });
    const job = this.run().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = job;
    return job;
  }
  private save(cursor: ImapCursor): void {
    this.database.sqlite
      .prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(this.cursorKey, JSON.stringify(cursor));
  }
  private async run(): Promise<ImapPollResult> {
    const result: ImapPollResult = { processed: 0, rejected: 0 };
    let lock: { release(): void } | undefined;
    let processing = false;
    let client: ImapClient | null = null;
    try {
      client = this.factory(this.config);
      this.client = client;
      client.on('error', () => {
        /* The pending command rejects; never emit credentials/server responses. */
      });
      await client.connect();
      if (this.stopped) return result;
      lock = await client.getMailboxLock(this.config.mailbox, { readOnly: true });
      const mailbox = client.mailbox;
      if (!mailbox || !mailbox.uidValidity || !Number.isSafeInteger(mailbox.uidNext))
        throw new Error('Invalid mailbox UID state.');
      const stored = this.database.sqlite
        .prepare('SELECT value FROM settings WHERE key=?')
        .get(this.cursorKey) as { value: string } | undefined;
      let cursor: ImapCursor = stored
        ? (JSON.parse(stored.value) as ImapCursor)
        : { uidValidity: String(mailbox.uidValidity), uid: 0 };
      if (cursor.uidValidity !== String(mailbox.uidValidity))
        cursor = { uidValidity: String(mailbox.uidValidity), uid: 0 };
      if (!Number.isSafeInteger(cursor.uid) || cursor.uid < 0)
        throw new Error('Invalid persisted cursor.');
      // Bound SEARCH memory even on a mailbox with a huge or sparse UID space.
      const end = Math.min(mailbox.uidNext - 1, cursor.uid + 10_000);
      if (end <= cursor.uid || !mailbox.exists) {
        this.save(cursor);
        return result;
      }
      const found = await client.search({ uid: `${cursor.uid + 1}:${end}` }, { uid: true });
      const uids = [...new Set(found || [])]
        .filter((uid) => Number.isSafeInteger(uid) && uid > cursor.uid && uid <= end)
        .sort((a, b) => a - b);
      for (const uid of uids.slice(0, 50)) {
        if (this.stopped) break;
        const metadata = await client.fetchOne(uid, { uid: true, size: true }, { uid: true });
        if (!metadata) {
          cursor.uid = uid;
          this.save(cursor);
          continue;
        } // Expunged between SEARCH and FETCH.
        processing = true;
        try {
          if (metadata.size === undefined || metadata.size > MAX_NEWSLETTER_BYTES)
            throw new NewsletterInputError('Message size exceeds inbound limits.');
          const message = await client.fetchOne(
            uid,
            { uid: true, source: { start: 0, maxLength: MAX_NEWSLETTER_BYTES + 1 } },
            { uid: true },
          );
          if (!message) {
            cursor.uid = uid;
            this.save(cursor);
            processing = false;
            continue;
          }
          if (!message.source) throw new Error('Missing MIME source.');
          const letter = await this.ingest(message.source);
          if (letter.outcome === 'inserted') this.inserted(letter);
          result.processed++;
        } catch (error) {
          if (!(error instanceof NewsletterInputError)) throw error;
          // Keep the original in its dedicated mailbox for inspection, and do not
          // let one malformed letter permanently block later deliveries.
          cursor.lastRejectedUid = uid;
          result.rejected++;
        }
        cursor.uid = uid;
        this.save(cursor); // Commit each successful/rejected UID, never an unprocessed UID.
        processing = false;
      }
      if (!this.stopped && uids.length <= 50) {
        cursor.uid = end;
        this.save(cursor);
      }
    } catch {
      result.error = processing ? 'processing' : 'connection';
    } finally {
      lock?.release();
      if (client) {
        try {
          if (!this.stopped) await client.logout();
        } catch {
          /* Close below, even after a broken socket. */
        }
        client.close();
      }
      this.client = null;
      this.report(result);
    }
    return result;
  }
}
