import type { ApiServices } from '../../../packages/api/src/ports.js';
import type {
  ClockPort,
  SearchScope,
  SearchOptions,
  SearchRow,
} from '../../../packages/core/src/ports.js';
import { prepareSearch, finishSearch } from '../../../packages/core/src/search-service.js';
import { searchQueries } from '../../../packages/db/src/reader-queries.js';
import { CloudflareStorage } from './storage.js';

type SearchPort = ApiServices['search'];
export class CloudflareSearch implements SearchPort {
  constructor(
    private storage: CloudflareStorage,
    private clock: ClockPort = { now: () => new Date(), monotonic: () => performance.now() },
  ) {}
  async search(input: string, scope: SearchScope, options: SearchOptions = {}) {
    const start = this.clock.monotonic(),
      { query, limit, offset } = prepareSearch(input, scope, options);
    if (!query)
      return finishSearch(
        [],
        limit,
        offset,
        this.clock.monotonic() - start,
        options.includeTotal ? 0 : undefined,
      );
    const plan = searchQueries(query, scope, { ...options, limit: limit + 1, offset });
    const result = await this.storage.batch([
      this.storage.statement(plan.page.sql, plan.page.values),
      ...(options.includeTotal ? [this.storage.statement(plan.count.sql, plan.count.values)] : []),
    ]);
    const total = options.includeTotal ? Number(result[1]!.results[0]!.count) : undefined;
    return finishSearch(
      result[0]!.results as SearchRow[],
      limit,
      offset,
      this.clock.monotonic() - start,
      total,
    );
  }
}
