import type { AsyncSqlStorage } from '../../../packages/db/src/async-storage.js';
import type { Query, QueryResult } from './protocol.js';

export class BrowserSqlStorage implements AsyncSqlStorage<Query> {
  constructor(private execute: (queries: Query[]) => Promise<QueryResult[]>) {}
  statement(sql: string, values: unknown[] = []): Query {
    return {
      sql,
      params: values.map((value) => {
        if (
          value === null ||
          typeof value === 'string' ||
          typeof value === 'number' ||
          value instanceof Uint8Array
        )
          return value;
        throw new TypeError('Invalid SQL binding.');
      }),
    };
  }
  async batch<T = Record<string, unknown>>(queries: Query[]) {
    return (await this.execute(queries)).map((result) => ({
      results: result.rows.map(
        (row) => Object.fromEntries(result.columns.map((key, index) => [key, row[index]])) as T,
      ),
      meta: { changes: result.changes },
    }));
  }
  async all<T>(sql: string, values: unknown[] = []) {
    return (await this.batch<T>([this.statement(sql, values)]))[0]!.results;
  }
  async first<T>(sql: string, values: unknown[] = []) {
    return (await this.all<T>(sql, values))[0] ?? null;
  }
  async run(sql: string, values: unknown[] = []) {
    return (await this.batch([this.statement(sql, values)]))[0]!;
  }
}
