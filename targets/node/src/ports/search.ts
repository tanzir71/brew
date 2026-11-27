import type { BrewDatabase } from '../db/database.js';
import type {
  SearchPort,
  SearchScope,
  SearchOptions,
  SearchRow,
} from '../../../../packages/core/src/ports.js';
import { searchQueries } from '../../../../packages/db/src/reader-queries.js';
export class NodeSearch implements SearchPort {
  constructor(private readonly database: BrewDatabase) {}
  count(query: string, scope: SearchScope, options: SearchOptions) {
    const plan = searchQueries(query, scope, { ...options, limit: 1, offset: 0 }).count;
    return (this.database.sqlite.prepare(plan.sql).get(...plan.values) as { count: number }).count;
  }
  search(
    query: string,
    scope: SearchScope,
    options: SearchOptions & { limit: number; offset: number },
  ): SearchRow[] {
    const plan = searchQueries(query, scope, options).page;
    return this.database.sqlite.prepare(plan.sql).all(...plan.values) as SearchRow[];
  }
}
