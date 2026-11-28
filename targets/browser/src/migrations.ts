import type { Migration } from '../../../packages/db/src/migrate.js';

const files = import.meta.glob('../../../packages/db/migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

export const migrations: Migration[] = Object.entries(files).map(([filename, sql]) => ({
  name: filename.split('/').at(-1)!,
  sql,
}));
