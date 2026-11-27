import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

/** Count the actual native boundary independently of the product admission counter. */
export function countD1(database: D1Database) {
  let calls = 0;
  const statements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const wrap = <T extends object>(value: T): T =>
    new Proxy(value, {
      get(target, key) {
        const member: unknown = Reflect.get(target, key, target);
        if (typeof member !== 'function') return member;
        return (...args: unknown[]) => {
          if (key === 'batch') {
            calls++;
            args[0] = (args[0] as D1PreparedStatement[]).map(
              (statement) => statements.get(statement) ?? statement,
            );
          } else if (['first', 'all', 'run', 'raw', 'exec'].includes(String(key))) calls++;
          const result: unknown = Reflect.apply(member, target, args);
          if (key === 'prepare' || key === 'bind') {
            const native = result as D1PreparedStatement;
            const proxy = wrap(native);
            statements.set(proxy, native);
            return proxy;
          }
          return key === 'withSession' ? wrap(result as object) : result;
        };
      },
    });
  return {
    database: wrap(database),
    get calls() {
      return calls;
    },
  };
}
