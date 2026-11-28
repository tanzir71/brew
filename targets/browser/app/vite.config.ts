import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  sampleGroups,
  sampleFeed,
  sampleDocument,
} from '../../../packages/core/src/sample-library.js';

const worker = fileURLToPath(new URL('bridge-sw.js', import.meta.url));
const publicBase =
  process.env.BREW_BROWSER_PUBLIC_URL ?? 'https://tanzir71.github.io/brew/browser/';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: fileURLToPath(new URL('../../../packages/web/public', import.meta.url)),
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  resolve: {
    alias: {
      '@brew/browser-jsx/jsx-runtime': fileURLToPath(new URL('jsx-runtime.ts', import.meta.url)),
      '@brew/browser-jsx': fileURLToPath(new URL('jsx-runtime.ts', import.meta.url)),
    },
  },
  plugins: [
    {
      name: 'browser-app-adapters',
      enforce: 'pre',
      async transform(code, id) {
        if (!/packages[\\/]web[\\/]src[\\/].*\.[jt]sx?$/.test(id)) return;
        const source = code
          .replaceAll("'/figma/", "'./figma/")
          .replaceAll('"/figma/', '"./figma/')
          .replaceAll('`/figma/', '`./figma/');
        const transformed = await transform(source, {
          loader: id.endsWith('x') ? 'tsx' : 'ts',
          jsx: 'automatic',
          jsxImportSource: '@brew/browser-jsx',
          sourcemap: true,
          sourcefile: id,
          define: {
            location: 'globalThis.__brewBrowserLocation',
            'window.location': 'globalThis.__brewBrowserLocation',
            history: 'globalThis.__brewBrowserHistory',
            'window.history': 'globalThis.__brewBrowserHistory',
            EventSource: 'globalThis.__brewBrowserEvents',
            URL: 'globalThis.__brewBrowserURL',
          },
        });
        return { code: transformed.code, map: transformed.map };
      },
    },
    react(),
    tailwindcss(),
    {
      name: 'browser-shell-and-samples',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split('?')[0] !== '/sw.js') return next();
          response.setHeader('Content-Type', 'application/javascript');
          response.end(readFileSync(worker));
        });
      },
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: readFileSync(worker, 'utf8') });
        const fonts = readFileSync(
          fileURLToPath(new URL('../../../packages/web/src/styles/fonts.css', import.meta.url)),
          'utf8',
        ).replaceAll('url(/fonts/', 'url(../fonts/');
        const tokens = readFileSync(
          fileURLToPath(new URL('../../../packages/web/src/styles/tokens.css', import.meta.url)),
          'utf8',
        );
        this.emitFile({
          type: 'asset',
          fileName: 'samples/sample.css',
          source:
            fonts +
            tokens +
            '\n*{font-style:normal!important}body{margin:0;background:var(--brew-bg-canvas);color:var(--brew-text-primary);font:19px/31px var(--brew-font-reading)}main{max-width:42rem;margin:3rem auto;padding:0 1.5rem}h1{font:400 44px/48px var(--brew-font-reading)}p{margin:1rem 0}img{max-width:100%;height:auto}a{color:var(--brew-accent-default)}',
        });
        for (const group of sampleGroups) {
          this.emitFile({
            type: 'asset',
            fileName: `samples/${group.id}.json`,
            source: JSON.stringify(sampleFeed(group.id, publicBase)),
          });
          for (const [index, article] of sampleDocument(group.id, publicBase)!.articles.entries())
            this.emitFile({
              type: 'asset',
              fileName: `samples/${group.id}-${index}.html`,
              source: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="stylesheet" href="./sample.css"><title>${article.title} · Brew sample</title><body><main><p>Brew sample article</p><h1>${article.title}</h1>${article.contentHtml!.replaceAll(publicBase, '../')}<p><a href="../">Back to Brew</a></p></main></body></html>`,
            });
        }
      },
    },
  ],
  build: {
    outDir: fileURLToPath(new URL('../../../docs/browser', import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
