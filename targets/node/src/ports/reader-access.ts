import {
  readerUsername,
  readerSessionCredential,
  readerWriteMessage,
} from '../../../../packages/core/src/reader-access.js';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { BrewDatabase } from '../db/database.js';
import {
  ReaderSyncError,
  type ReaderAccessPort,
  type ReaderSession,
} from '../../../../packages/core/src/reader-sync.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (left: string, right: string) =>
  left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
type Credentials = {
  username: string;
  salt: string;
  password_hash: string;
  fever_hash: string;
  generation: string;
};
export class NodeReaderAccess implements ReaderAccessPort {
  private failures = 0;
  private window = 0;
  constructor(
    private database: BrewDatabase,
    private now: () => number = Date.now,
  ) {}
  status() {
    const row = this.database.sqlite
      .prepare('SELECT username FROM reader_access WHERE id=1')
      .get() as { username: string } | undefined;
    return { enabled: Boolean(row), username: row?.username ?? null };
  }
  configure(value: unknown) {
    const username = readerUsername(value),
      password = randomBytes(24).toString('base64url'),
      salt = randomBytes(16).toString('hex');
    // This is a generated 192-bit app key; custom/human passwords are never accepted.
    const passwordHash = hash(`${salt}:${password}`);
    // Fever's MD5 credential is a protocol requirement; retain only its SHA-256 verifier.
    const feverHash = hash(createHash('md5').update(`${username}:${password}`).digest('hex'));
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('DELETE FROM reader_sessions').run();
      this.database.sqlite
        .prepare(
          'INSERT OR REPLACE INTO reader_access(id,username,salt,password_hash,fever_hash,generation,created_at) VALUES(1,?,?,?,?,?,?)',
        )
        .run(username, salt, passwordHash, feverHash, randomBytes(16).toString('hex'), this.now());
    })();
    this.failures = 0;
    return { username, password };
  }
  disable() {
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('DELETE FROM reader_sessions').run();
      this.database.sqlite.prepare('DELETE FROM reader_access').run();
    })();
  }
  private credentials() {
    return this.database.sqlite
      .prepare(
        'SELECT username,salt,password_hash,fever_hash,generation FROM reader_access WHERE id=1',
      )
      .get() as Credentials | undefined;
  }
  private throttle() {
    if (this.now() - this.window >= 60_000) {
      this.window = this.now();
      this.failures = 0;
    }
    if (this.failures >= 30)
      throw new ReaderSyncError(429, 'Wait a minute before trying reader credentials again.');
  }
  login(username: string, password: string) {
    this.throttle();
    const row = this.credentials();
    if (password.length > 256 || username.length > 100) {
      this.failures++;
      return null;
    }
    const computed = hash(`${row?.salt ?? 'brew-unconfigured-reader'}:${password}`);
    if (!row || !equal(computed, row.password_hash) || !equal(hash(username), hash(row.username))) {
      this.failures++;
      return null;
    }
    const token = `brs_${randomBytes(32).toString('base64url')}`;
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare('DELETE FROM reader_sessions WHERE expires_at>0 AND expires_at<=?')
        .run(this.now());
      this.database.sqlite
        .prepare(
          'DELETE FROM reader_sessions WHERE token_hash IN (SELECT token_hash FROM reader_sessions ORDER BY created_at DESC LIMIT -1 OFFSET 99)',
        )
        .run();
      this.database.sqlite
        .prepare(
          'INSERT INTO reader_sessions(token_hash,write_hash,generation,expires_at,created_at) VALUES(?,?,?,?,?)',
        )
        .run(
          hash(token),
          hash(this.writeToken({ token, username, generation: row.generation })),
          row.generation,
          0,
          this.now(),
        );
    })();
    this.failures = 0;
    return token;
  }
  session(authorization: string | null, writeToken?: string) {
    const credential = readerSessionCredential(authorization, writeToken);
    if (!credential) return null;
    const { token, writeOnly } = credential;
    const row = this.database.sqlite
      .prepare(
        `SELECT a.username,a.generation FROM reader_sessions s JOIN reader_access a ON a.generation=s.generation WHERE s.${writeOnly ? 'write_hash' : 'token_hash'}=? AND (s.expires_at=0 OR s.expires_at>?)`,
      )
      .get(hash(token), this.now()) as { username: string; generation: string } | undefined;
    return row ? { token, username: row.username, generation: row.generation, writeOnly } : null;
  }
  writeToken(session: ReaderSession) {
    return session.writeOnly
      ? session.token
      : createHmac('sha256', session.token).update(readerWriteMessage).digest('hex');
  }
  checkWrite(session: ReaderSession, token: string) {
    return equal(hash(token), hash(this.writeToken(session)));
  }
  fever(key: string) {
    this.throttle();
    const row = this.credentials();
    if (!row || !/^[a-f\d]{32}$/i.test(key) || !equal(hash(key.toLowerCase()), row.fever_hash)) {
      this.failures++;
      return null;
    }
    this.failures = 0;
    return { token: key, username: row.username, generation: row.generation };
  }
}
