import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../../../packages/db/src/schema.js';

/** One primary session per invocation: read-after-write must not hit a stale replica. */
export class CloudflareStorage {
  readonly session;
  readonly db;
  constructor(database: D1Database) {
    this.session = database.withSession('first-primary');
    this.db = drizzle(database, { schema });
  }
  statement(sql: string, values: unknown[] = []): D1PreparedStatement {
    return this.session.prepare(sql).bind(...values);
  }
  async first<T>(sql: string, values: unknown[] = []): Promise<T | null> {
    return this.statement(sql, values).first<T>();
  }
  async all<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    return (await this.statement(sql, values).all<T>()).results;
  }
  async run(sql: string, values: unknown[] = []) {
    return this.statement(sql, values).run();
  }
  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
    if (!statements.length) return [];
    // D1 batch is an atomic SQL transaction, unlike awaiting separate writes.
    return this.session.batch<T>(statements);
  }
}
