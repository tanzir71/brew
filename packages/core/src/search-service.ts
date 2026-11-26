import type { ArticleSummary, SearchPage } from './types/api.js';
import type { ClockPort, SearchPort, SearchScope, SearchOptions } from './ports.js';
export type { SearchScope } from './ports.js';

export function compileFtsQuery(input: string): string | null {
  const terms =
    input
      .normalize('NFKC')
      .match(/[\p{L}\p{N}_-]+/gu)
      ?.slice(0, 12) ?? [];
  return terms.length
    ? terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' AND ')
    : null;
}

export class SearchService {
  constructor(
    private readonly searchPort: SearchPort,
    private readonly clock: ClockPort,
  ) {}
  search(input: string, scope: SearchScope, options: SearchOptions = {}): SearchPage {
    const started = this.clock.monotonic();
    const query = compileFtsQuery(input);
    if (!query)
      return { items: [], nextOffset: null, durationMs: this.clock.monotonic() - started, ...(options.includeTotal ? { total: 0 } : {}) };
    if (scope === 'folder' && options.folderId === undefined)
      throw new Error('folderId is required for folder search');
    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);
    const rows = this.searchPort.search(query, scope, { ...options, limit: limit + 1, offset });
    const items = rows.slice(0, limit).map((row): ArticleSummary => ({
      ...row,
      publishedAt: new Date(row.publishedAt).toISOString(),
      readAt: row.readAt === null ? null : new Date(row.readAt).toISOString(),
      starredAt: row.starredAt === null ? null : new Date(row.starredAt).toISOString(),
    }));
    const total = options.includeTotal ? this.searchPort.count(query, scope, options) : undefined;
    return {
      items,
      nextOffset: rows.length > limit ? offset + limit : null,
      durationMs: this.clock.monotonic() - started,
      ...(total === undefined ? {} : { total }),
    };
  }
}
