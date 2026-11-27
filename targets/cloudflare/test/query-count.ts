import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

/** Count the actual native boundary independently of the product admission counter. */
export function countD1(database: D1Database) {
  let calls = 0;
  const statements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const sql = new WeakMap<object, string>();
  const candidatePages = { reads: 0, maxRows: 0, maxBytes: 0 };
  const configPages = { reads: 0, maxRows: 0, maxBytes: 0 };
  const wrap = <T extends object>(value: T): T =>
    new Proxy(value, {
      get(target, key) {
        const member: unknown = Reflect.get(target, key, target);
        if (typeof member !== 'function') return member;
        return (...args: unknown[]) => {
          let queries: string[] = [];
          if (key === 'batch') {
            calls++;
            queries = (args[0] as D1PreparedStatement[]).map(
              (statement) => sql.get(statement) ?? '',
            );
            args[0] = (args[0] as D1PreparedStatement[]).map(
              (statement) => statements.get(statement) ?? statement,
            );
          } else if (['first', 'all', 'run', 'raw', 'exec'].includes(String(key))) calls++;
          const result: unknown = Reflect.apply(member, target, args);
          if (key === 'prepare' || key === 'bind') {
            const native = result as D1PreparedStatement;
            const proxy = wrap(native);
            statements.set(proxy, native);
            sql.set(proxy, key === 'prepare' ? String(args[0]) : (sql.get(target) ?? ''));
            sql.set(native, sql.get(proxy)!);
            return proxy;
          }
          if (key === 'batch')
            return Promise.resolve(result).then((results) => {
              (results as { results: unknown[] }[]).forEach((value, index) => {
                const query = queries[index] ?? '';
                const pages =
                  /SELECT format,snapshot_json FROM brew_schedule_candidates.* LIMIT /i.test(query)
                    ? candidatePages
                    : /SELECT snapshot_json FROM brew_schedule_configs.* LIMIT /i.test(query)
                      ? configPages
                      : null;
                if (!pages) return;
                pages.reads++;
                pages.maxRows = Math.max(pages.maxRows, value.results.length);
                pages.maxBytes = Math.max(
                  pages.maxBytes,
                  new TextEncoder().encode(JSON.stringify(value.results)).byteLength,
                );
              });
              return results;
            });
          return key === 'withSession' ? wrap(result as object) : result;
        };
      },
    });
  return {
    database: wrap(database),
    candidatePages,
    configPages,
    get calls() {
      return calls;
    },
  };
}
