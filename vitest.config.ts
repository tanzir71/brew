import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', setupFiles: ['./server/test/clock.ts'], include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'packages/**/*.test.ts', 'targets/**/*.test.ts'] } });
