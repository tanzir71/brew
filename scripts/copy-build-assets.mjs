import { cp, mkdir } from 'node:fs/promises';

// Keep the built Node target independent of the source tree and working directory.
await mkdir('dist/packages/db', { recursive: true });
await cp('packages/db/migrations', 'dist/packages/db/migrations', { recursive: true });
await cp('packages/web/dist', 'dist/packages/web/dist', { recursive: true });
