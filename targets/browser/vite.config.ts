import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: false,
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rolldownOptions: {
      input: fileURLToPath(new URL('src/index.ts', import.meta.url)),
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: 'index.js' },
    },
  },
});
