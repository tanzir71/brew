import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// Only the demo build adapts native browser globals to hash navigation and tab memory.
// The application source, its components and its CSS are shared without a second UI.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: fileURLToPath(new URL('../../packages/web/public', import.meta.url)),
  plugins: [
    {
      name: 'demo-relative-artwork',
      enforce: 'pre',
      transform(code, id) {
        return /packages[\\/]web[\\/]src[\\/].*\.[jt]sx?$/.test(id)
          ? code
              .replaceAll("'/figma/", "'./figma/")
              .replaceAll('"/figma/', '"./figma/')
              .replaceAll('`/figma/', '`./figma/')
          : undefined;
      },
    },
    react(),
    tailwindcss(),
  ],
  define: {
    location: 'globalThis.__brewDemoLocation',
    'window.location': 'globalThis.__brewDemoLocation',
    history: 'globalThis.__brewDemoHistory',
    'window.history': 'globalThis.__brewDemoHistory',
    localStorage: 'globalThis.__brewDemoStorage',
    EventSource: 'globalThis.__brewDemoEvents',
  },
  build: { outDir: fileURLToPath(new URL('../../docs/demo', import.meta.url)), emptyOutDir: true },
});
