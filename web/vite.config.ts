import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ root: 'web', plugins: [react(), tailwindcss()], server: { host: '127.0.0.1', port: 4401, proxy: { '/api': { target: 'http://127.0.0.1:4400' } } }, build: { outDir: 'dist', emptyOutDir: true } });
