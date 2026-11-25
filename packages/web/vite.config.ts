import { isBrewOutputPath } from '../core/src/brew-output-paths.js';
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
      '/b/': {
        target: 'http://127.0.0.1:4400',
        bypass(req) {
          if (!isBrewOutputPath(req.url?.split('?')[0] ?? '')) return req.url;
        },
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
