import type { SqlQuery } from './reader-queries.js';

const duplicateFilter =
  "EXISTS(SELECT 1 FROM settings WHERE key='duplicate_filter_enabled' AND value='true')";
/** Keep duplicate selection identical in synchronous SQLite and asynchronous D1. */
export function duplicateTitleQueries(
  ids: number[],
  since: number,
): {
  enabled: SqlQuery;
  subjects: SqlQuery;
  recent: SqlQuery;
} {
  return {
    enabled: { sql: `SELECT ${duplicateFilter} AS enabled`, values: [] },
    subjects: {
      sql: `SELECT id,title FROM articles WHERE id IN (SELECT value FROM json_each(?)) AND ${duplicateFilter}`,
      values: [JSON.stringify(ids)],
    },
    recent: {
      sql: `SELECT id,title FROM articles WHERE published_at>=? AND ${duplicateFilter}`,
      values: [since],
    },
  };
}
