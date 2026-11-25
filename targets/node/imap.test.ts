import { ImapFlow } from 'imapflow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from './src/db/database.js';
import { NewsletterService } from './src/services/newsletter-service.js';
import { ImapPoller, createImapClient, type ImapClient } from './src/services/imap-poller.js';
import type { ImapConfig } from './src/inbound-config.js';
import { MAX_NEWSLETTER_BYTES } from '../../packages/core/src/newsletter-mime.js';
import { imapServer } from './test/imap-server.js';
import { createApp } from './src/app.js';

const now = new Date('2026-11-26T12:00:00Z');
const config: ImapConfig = {
  host: 'imap.example.test',
  port: 993,
  security: 'tls',
  user: 'letters',
  password: 'TEST-ONLY-PASSWORD',
  mailbox: 'INBOX',
  everySeconds: 60,
};
const mime = (id: string, from = 'news@journal.test') =>
  `From: Field Notes <${from}>\r\nSubject: Dispatch ${id}\r\nMessage-ID: <${id}@journal.test>\r\nDate: ${now.toUTCString()}\r\nContent-Type: text/html\r\n\r\n<p>Story ${id}</p><img width="1" src="https://metrics.test/open">`;
const closers: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
function setup() {
  const database = openDatabase(':memory:');
  closers.push(database.close);
  const service = new NewsletterService(database, { now: () => now, monotonic: () => 0 });
  return { database, service };
}
class FakeImap implements ImapClient {
  mailbox: ImapClient['mailbox'] = { uidValidity: 7n, uidNext: 4, exists: 3 };
  messages = new Map([
    [1, mime('one')],
    [2, mime('two')],
    [3, mime('three')],
  ]);
  oversized = new Set<number>();
  missing = new Set<number>();
  connect = vi.fn(async () => undefined);
  release = vi.fn();
  getMailboxLock = vi.fn(async () => ({ release: this.release }));
  search = vi.fn(async (query: { uid: string }) => {
    const [min, max] = query.uid.split(':').map(Number);
    return [...this.messages.keys()].filter((uid) => uid >= min! && uid <= max!);
  });
  fetchOne = vi.fn(async (uid: number, query: { source?: unknown }) => {
    const source = this.messages.get(uid);
    if (!source || this.missing.has(uid)) return false as const;
    return {
      uid,
      size: this.oversized.has(uid) ? MAX_NEWSLETTER_BYTES + 1 : Buffer.byteLength(source),
      source: query.source ? Buffer.from(source) : undefined,
    };
  });
  logout = vi.fn(async () => undefined);
  close = vi.fn();
  on = vi.fn();
}
const waitFor = async (condition: () => boolean) =>
  vi.waitFor(() => expect(condition()).toBe(true));

describe('dedicated mailbox IMAP poller', () => {
  it('rejects an untrusted TLS certificate before authenticating', async () => {
    const { database, service } = setup();
    const fixture = await imapServer(new Map([[1, mime('wire')]]));
    closers.push(fixture.close);
    const poller = new ImapPoller(
      database,
      { ...config, host: '127.0.0.1', port: fixture.port },
      (raw) => service.ingest(raw),
      undefined,
      createImapClient,
    );
    expect(await poller.pollNow()).toMatchObject({ error: 'connection', processed: 0 });
    expect(fixture.commands.join('\n')).not.toMatch(/LOGIN/);
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM articles').get()).toEqual({ n: 0 });
  });
  it('uses a real TLS/ImapFlow connection, read-only selection and bounded PEEK fetches without changing mail flags', async () => {
    const { database, service } = setup();
    const fixture = await imapServer(new Map([[1, mime('wire')]]));
    closers.push(fixture.close);
    const wireConfig = { ...config, host: '127.0.0.1', port: fixture.port };
    const poller = new ImapPoller(
      database,
      wireConfig,
      (raw) => service.ingest(raw),
      undefined,
      (options) =>
        new ImapFlow({
          host: options.host,
          port: options.port,
          secure: true,
          auth: { user: options.user, pass: options.password },
          tls: { ca: fixture.cert, rejectUnauthorized: true },
          logger: false,
          disableAutoIdle: true,
          connectionTimeout: 2000,
          greetingTimeout: 2000,
          socketTimeout: 2000,
        }),
    );
    closers.push(() => poller.stop());
    expect(await poller.pollNow(), fixture.commands.join('\n')).toEqual({
      processed: 1,
      rejected: 0,
    });
    expect(database.sqlite.prepare('SELECT content_html FROM articles').get()).toEqual({
      content_html: '<p>Story wire</p>',
    });
    expect(fixture.commands.some((line) => /EXAMINE "?INBOX/.test(line))).toBe(true);
    expect(fixture.commands.some((line) => /BODY\.PEEK\[\]<0\.10485761>/.test(line))).toBe(true);
    expect(fixture.commands.join('\n')).not.toMatch(/\bSTORE\b|\bEXPUNGE\b|\bDELETE\b/);
    expect((await poller.pollNow()).processed).toBe(0);
  });

  it('commits each UID, resumes after restart/password rotation and handles UIDVALIDITY changes idempotently', async () => {
    const { database, service } = setup();
    const first = new FakeImap();
    const notices = vi.fn();
    const one = new ImapPoller(
      database,
      config,
      (raw) => service.ingest(raw),
      notices,
      () => first,
    );
    expect(await one.pollNow()).toEqual({ processed: 3, rejected: 0 });
    expect(first.getMailboxLock).toHaveBeenCalledWith('INBOX', { readOnly: true });
    expect(notices).toHaveBeenCalledTimes(3);
    expect(first.release).toHaveBeenCalledOnce();
    expect(first.logout).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledOnce();
    const second = new FakeImap();
    const two = new ImapPoller(
      database,
      { ...config, password: 'ROTATED-SECRET' },
      (raw) => service.ingest(raw),
      notices,
      () => second,
    );
    expect(two.cursorKey).toBe(one.cursorKey);
    expect((await two.pollNow()).processed).toBe(0);
    expect(second.fetchOne).not.toHaveBeenCalled();
    second.mailbox = { uidValidity: 8n, uidNext: 4, exists: 3 };
    expect((await two.pollNow()).processed).toBe(3);
    expect(notices).toHaveBeenCalledTimes(3); // Replayed MIME dedupes across UID resets.
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM articles').get()).toEqual({ n: 3 });
    expect(JSON.stringify(database.sqlite.prepare('SELECT * FROM settings').all())).not.toMatch(
      /PASSWORD|ROTATED-SECRET/,
    );
  });

  it('rejects malformed/oversized messages, keeps originals in the mailbox and does not block later letters', async () => {
    const { database, service } = setup();
    const client = new FakeImap();
    client.messages.set(1, 'From: broken\r\n\r\nBad');
    client.oversized.add(2);
    const poller = new ImapPoller(
      database,
      config,
      (raw) => service.ingest(raw),
      undefined,
      () => client,
    );
    expect(await poller.pollNow()).toEqual({ processed: 1, rejected: 2 });
    expect(client.messages.size).toBe(3);
    expect(
      client.fetchOne.mock.calls.filter(([uid, query]) => uid === 2 && query.source),
    ).toHaveLength(0);
    const state = JSON.parse(
      (
        database.sqlite.prepare('SELECT value FROM settings WHERE key=?').get(poller.cursorKey) as {
          value: string;
        }
      ).value,
    );
    expect(state).toEqual({ uidValidity: '7', uid: 3, lastRejectedUid: 2 });
    expect(database.sqlite.prepare('SELECT title FROM articles').get()).toEqual({
      title: 'Dispatch three',
    });
  });

  it('retries transient writes from the failed UID and reconnects after network failures', async () => {
    const { database, service } = setup();
    const client = new FakeImap();
    let fail = true;
    const ingest = vi.fn(async (raw: Uint8Array) => {
      if (new TextDecoder().decode(raw).includes('Dispatch two') && fail)
        throw new Error('Temporary database failure');
      return service.ingest(raw);
    });
    const poller = new ImapPoller(database, config, ingest, undefined, () => client);
    expect(await poller.pollNow()).toEqual({ processed: 1, rejected: 0, error: 'processing' });
    expect(
      JSON.parse(
        (
          database.sqlite
            .prepare('SELECT value FROM settings WHERE key=?')
            .get(poller.cursorKey) as { value: string }
        ).value,
      ).uid,
    ).toBe(1);
    fail = false;
    expect((await poller.pollNow()).processed).toBe(2);
    client.connect.mockRejectedValueOnce(new Error('Network failure PRIVATE PASSWORD'));
    expect(await poller.pollNow()).toEqual({ processed: 0, rejected: 0, error: 'connection' });
    expect(await poller.pollNow()).toEqual({ processed: 0, rejected: 0 });
  });

  it('bounds message batches and sparse UID windows, and skips messages expunged during a poll', async () => {
    const { database, service } = setup();
    const client = new FakeImap();
    client.messages = new Map(Array.from({ length: 51 }, (_, i) => [i + 1, mime(String(i + 1))]));
    client.mailbox = { uidValidity: 7n, uidNext: 50_002, exists: 51 };
    client.missing.add(1);
    const poller = new ImapPoller(
      database,
      config,
      (raw) => service.ingest(raw),
      undefined,
      () => client,
    );
    expect((await poller.pollNow()).processed).toBe(49);
    expect((await poller.pollNow()).processed).toBe(1);
    expect(client.search).toHaveBeenNthCalledWith(1, { uid: '1:10000' }, { uid: true });
    expect(client.search).toHaveBeenNthCalledWith(2, { uid: '51:10050' }, { uid: true });
    expect((await poller.pollNow()).processed).toBe(0);
    expect(client.search).toHaveBeenNthCalledWith(3, { uid: '10051:20050' }, { uid: true });
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM articles').get()).toEqual({ n: 50 });
  });

  it('coalesces overlapping polls, starts immediately and closes a pending client on shutdown', async () => {
    const { database, service } = setup();
    const client = new FakeImap();
    let resolveConnect!: () => void;
    client.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = resolve;
        }),
    );
    client.close.mockImplementation(() => resolveConnect());
    const factory = vi.fn(() => client);
    const poller = new ImapPoller(
      database,
      config,
      (raw) => service.ingest(raw),
      undefined,
      factory,
    );
    poller.start();
    const first = poller.pollNow();
    const second = poller.pollNow();
    expect(first).toBe(second);
    expect(factory).toHaveBeenCalledTimes(1);
    await poller.stop();
    expect(client.close).toHaveBeenCalled();
    expect(client.getMailboxLock).not.toHaveBeenCalled();
    expect((await poller.pollNow()).processed).toBe(0);
  });
  it('checks again on the configured interval and stops scheduling after shutdown', async () => {
    vi.useFakeTimers();
    const { database, service } = setup();
    const client = new FakeImap();
    client.messages = new Map([[1, mime('one')]]);
    client.mailbox = { uidValidity: 7n, uidNext: 2, exists: 1 };
    const factory = vi.fn(() => client);
    const poller = new ImapPoller(
      database,
      config,
      (raw) => service.ingest(raw),
      undefined,
      factory,
    );
    try {
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(factory).toHaveBeenCalledTimes(1);
      client.messages.set(2, mime('two'));
      client.mailbox.uidNext = 3;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(factory).toHaveBeenCalledTimes(2);
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM articles').get()).toEqual({ n: 2 });
      await poller.stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(factory).toHaveBeenCalledTimes(2);
    } finally {
      await poller.stop();
      vi.useRealTimers();
    }
  });

  it('wires IMAP startup, capability/address reporting and shutdown through the real Node app', async () => {
    const database = openDatabase(':memory:');
    const client = new FakeImap();
    const app = await createApp({
      database,
      startPoller: true,
      clock: { now: () => now, monotonic: () => 0 },
      inbound: { kind: 'imap', address: 'letters@in.example.test', imap: config },
      imapClientFactory: () => client,
    });
    try {
      expect((await app.inject('/api/capabilities')).json().inboundMail).toBe('imap');
      expect((await app.inject('/api/sources/mailbox')).json()).toEqual({
        address: 'letters@in.example.test',
      });
      await waitFor(
        () =>
          (database.sqlite.prepare('SELECT count(*) AS n FROM articles').get() as { n: number })
            .n === 3,
      );
      expect(
        (await app.inject({ method: 'POST', url: '/api/inbound/email', payload: {} })).statusCode,
      ).toBe(501);
    } finally {
      await app.close();
    }
    expect(client.close).toHaveBeenCalled();
  });
});
