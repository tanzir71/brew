import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import { schema } from '../../../packages/db/src/schema.js';
import type { CloudflareQueryBudget } from './query-budget.js';

/** One primary session per invocation: read-after-write must not hit a stale replica. */
export class CloudflareStorage {
  readonly session;
  readonly db;
  constructor(
    readonly database: D1Database,
    readonly queryBudget?: CloudflareQueryBudget,
  ) {
    this.session = database.withSession('first-primary');
    this.db = drizzle(database, { schema });
  }
  statement(sql: string, values: unknown[] = []): D1PreparedStatement {
    return this.session.prepare(sql).bind(...values);
  }
  async first<T>(sql: string, values: unknown[] = []): Promise<T | null> {
    this.queryBudget?.record();
    return this.statement(sql, values).first<T>();
  }
  async all<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    this.queryBudget?.record();
    return (await this.statement(sql, values).all<T>()).results;
  }
  async run(sql: string, values: unknown[] = []) {
    this.queryBudget?.record();
    return this.statement(sql, values).run();
  }
  async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
    if (!statements.length) return [];
    this.queryBudget?.record();
    // D1 batch is an atomic SQL transaction, unlike awaiting separate writes.
    return this.session.batch<T>(statements);
  }
}
