import type { SubtleCrypto as WorkerSubtleCrypto } from '@cloudflare/workers-types';
import type { ReaderAccessPort, ReaderSession } from '../../../packages/core/src/reader-sync.js';
import { ReaderSyncError } from '../../../packages/core/src/reader-sync.js';
import {
  readerUsername,
  readerSessionCredential,
  readerWriteMessage,
} from '../../../packages/core/src/reader-access.js';
import { CloudflareStorage } from './storage.js';

type Credentials = {
  username: string;
  salt: string;
  password_hash: string;
  fever_hash: string;
  generation: string;
};
const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
const digest = async (value: string, algorithm = 'SHA-256') =>
  hex(await crypto.subtle.digest(algorithm, new TextEncoder().encode(value)));
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const randomHex = (length: number) => hex(random(length).buffer);
const randomToken = (length: number) =>
  btoa(String.fromCharCode(...random(length)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
const equal = (left: string, right: string) =>
  left.length === right.length &&
  (crypto.subtle as unknown as WorkerSubtleCrypto).timingSafeEqual(
    new TextEncoder().encode(left),
    new TextEncoder().encode(right),
  );
const throttleKey = 'reader_login_window';
export class CloudflareReaderAccess implements ReaderAccessPort {
  constructor(
    private storage: CloudflareStorage,
    private now: () => number = Date.now,
  ) {}
  async status() {
    const row = await this.storage.first<{ username: string }>(
      'SELECT username FROM reader_access WHERE id=1',
    );
    return { enabled: Boolean(row), username: row?.username ?? null };
  }
  async configure(value: unknown) {
    const username = readerUsername(value),
      password = randomToken(24),
      salt = randomHex(16);
    const passwordHash = await digest(`${salt}:${password}`),
      feverHash = await digest(await digest(`${username}:${password}`, 'MD5'));
    await this.storage.batch([
      this.storage.statement('DELETE FROM reader_sessions'),
      this.storage.statement(
        'INSERT OR REPLACE INTO reader_access(id,username,salt,password_hash,fever_hash,generation,created_at) VALUES(1,?,?,?,?,?,?)',
        [username, salt, passwordHash, feverHash, randomHex(16), this.now()],
      ),
      this.storage.statement('DELETE FROM settings WHERE key=?', [throttleKey]),
    ]);
    return { username, password };
  }
  async disable() {
    await this.storage.batch([
      this.storage.statement('DELETE FROM reader_sessions'),
      this.storage.statement('DELETE FROM reader_access'),
      this.storage.statement('DELETE FROM settings WHERE key=?', [throttleKey]),
    ]);
  }
  private credentials() {
    return this.storage.first<Credentials>(
      'SELECT username,salt,password_hash,fever_hash,generation FROM reader_access WHERE id=1',
    );
  }
  private async throttle() {
    // Reserve the attempt atomically: a fresh invocation must not reset the limit.
    const at = this.now();
    const row = await this.storage.first<{ value: string }>(
      `INSERT INTO settings(key,value) VALUES(?,json_object('at',?,'count',1)) ON CONFLICT(key) DO UPDATE SET value=CASE WHEN ?-json_extract(value,'$.at')>=60000 THEN json_object('at',?,'count',1) ELSE json_set(value,'$.count',min(31,json_extract(value,'$.count')+1)) END RETURNING value`,
      [throttleKey, at, at, at],
    );
    if ((JSON.parse(row!.value) as { count: number }).count > 30)
      throw new ReaderSyncError(429, 'Wait a minute before trying reader credentials again.');
  }
  private reset(generation: string) {
    return this.storage.statement(
      'DELETE FROM settings WHERE key=? AND EXISTS(SELECT 1 FROM reader_access WHERE id=1 AND generation=?)',
      [throttleKey, generation],
    );
  }
  async login(username: string, password: string) {
    await this.throttle();
    const row = await this.credentials();
    if (password.length > 256 || username.length > 100) return null;
    const computed = await digest(`${row?.salt ?? 'brew-unconfigured-reader'}:${password}`);
    if (
      !row ||
      !equal(computed, row.password_hash) ||
      !equal(await digest(username), await digest(row.username))
    )
      return null;
    const token = `brs_${randomToken(32)}`,
      tokenHash = await digest(token),
      writeHash = await digest(
        await this.writeToken({ token, username, generation: row.generation }),
      );
    const result = await this.storage.batch([
      this.storage.statement(
        'DELETE FROM reader_sessions WHERE expires_at>0 AND expires_at<=? AND EXISTS(SELECT 1 FROM reader_access WHERE id=1 AND generation=?)',
        [this.now(), row.generation],
      ),
      this.storage.statement(
        'DELETE FROM reader_sessions WHERE token_hash IN (SELECT token_hash FROM reader_sessions ORDER BY created_at DESC LIMIT -1 OFFSET 99) AND EXISTS(SELECT 1 FROM reader_access WHERE id=1 AND generation=?)',
        [row.generation],
      ),
      this.storage.statement(
        'INSERT INTO reader_sessions(token_hash,write_hash,generation,expires_at,created_at) SELECT ?,?,?,0,? WHERE EXISTS(SELECT 1 FROM reader_access WHERE id=1 AND generation=?) RETURNING token_hash',
        [tokenHash, writeHash, row.generation, this.now(), row.generation],
      ),
      this.reset(row.generation),
    ]);
    return result[2]!.results.length ? token : null;
  }
  async session(authorization: string | null, writeToken?: string) {
    const credential = readerSessionCredential(authorization, writeToken);
    if (!credential) return null;
    const row = await this.storage.first<{ username: string; generation: string }>(
      `SELECT a.username,a.generation FROM reader_sessions s JOIN reader_access a ON a.generation=s.generation WHERE s.${credential.writeOnly ? 'write_hash' : 'token_hash'}=? AND (s.expires_at=0 OR s.expires_at>?)`,
      [await digest(credential.token), this.now()],
    );
    return row ? { ...credential, ...row } : null;
  }
  async writeToken(session: ReaderSession) {
    if (session.writeOnly) return session.token;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(session.token),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(readerWriteMessage)));
  }
  async checkWrite(session: ReaderSession, token: string) {
    return equal(await digest(token), await digest(await this.writeToken(session)));
  }
  async fever(key: string) {
    await this.throttle();
    const row = await this.credentials();
    if (
      !row ||
      !/^[a-f\d]{32}$/i.test(key) ||
      !equal(await digest(key.toLowerCase()), row.fever_hash)
    )
      return null;
    const result = await this.storage.batch([
      this.storage.statement(
        'SELECT username,generation FROM reader_access WHERE id=1 AND generation=?',
        [row.generation],
      ),
      this.reset(row.generation),
    ]);
    return result[0]!.results.length
      ? { token: key, username: row.username, generation: row.generation }
      : null;
  }
}
