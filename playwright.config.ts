import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './web/e2e', timeout: 30_000, use: { baseURL: 'http://127.0.0.1:4401' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4401/api/health', reuseExistingServer: !process.env.CI }
});
