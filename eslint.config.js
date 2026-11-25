import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', '**/dist', 'node_modules', 'data/**', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: { ...reactHooks.configs.recommended.rules, 'react-refresh/only-export-components': ['warn', { allowConstantExport: true }] }
  },
  {
    files: ['packages/core/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['node:*', 'fs', 'path', 'crypto', 'worker_threads', 'http', 'https', 'net', 'os', 'perf_hooks'], message: 'Core uses ports for platform operations.' },
          { group: ['better-sqlite3', 'drizzle-orm', 'drizzle-orm/*', 'fastify', 'node-cron', 'rss-parser', '@brew/node', '@brew/db', '**/targets/**', '**/server/**'], message: 'Platform and persistence adapters belong in a target.' }
        ]
      }]
    }
  }
);
