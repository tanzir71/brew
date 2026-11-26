import { isBrewOutputPath } from '../core/src/brew-output-paths.js';
import { isArticleOutputPath } from '../core/src/article-outputs.js';
import { isReaderPageOutputPath } from '../core/src/reader-pages.js';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 4401,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4400' },
      '^/(all|today|starred|search)\\.(md|json)(\\?|$)': { target: 'http://127.0.0.1:4400' },
      '^/(f|feed)/': {
        target: 'http://127.0.0.1:4400',
        bypass(req) { if (!isReaderPageOutputPath(req.url?.split('?')[0] ?? '')) return req.url; },
      },
      '/b/': {
        target: 'http://127.0.0.1:4400',
        bypass(req) {
          if (!isBrewOutputPath(req.url?.split('?')[0] ?? '')) return req.url;
        },
      },
      '/a/': {
        target: 'http://127.0.0.1:4400',
        bypass(req) {
          if (!isArticleOutputPath(req.url?.split('?')[0] ?? '')) return req.url;
        },
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
