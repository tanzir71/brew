import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('bundles the HTTP API without Node, SQLite, Fastify or target imports', async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'api-boundary',
        resolveId(id) {
          if (
            id.startsWith('node:') ||
            /^(fastify|better-sqlite3|drizzle-orm)(\/|$)/.test(id) ||
            id.includes('/targets/')
          )
            throw new Error(`Platform dependency in portable API: ${id}`);
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./src/app.ts', import.meta.url)),
        formats: ['es'],
        fileName: 'api',
      },
    },
  });
  const bundles = Array.isArray(result) ? result : [result];
  const chunks = bundles
    .flatMap((bundle) => ('output' in bundle ? bundle.output : []))
    .filter((chunk) => chunk.type === 'chunk');
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks.some((chunk) => chunk.code.includes('__vite-browser-external'))).toBe(false);
});
