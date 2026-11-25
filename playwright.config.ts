import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './web/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4401' },
  webServer: {
    env: {
      BREW_PUBLIC_URL: '',
      BREW_SMTP_HOST: '',
      BREW_SMTP_FROM: '',
      BREW_SMTP_PORT: '',
      BREW_SMTP_SECURITY: '',
      BREW_SMTP_USER: '',
      BREW_SMTP_PASSWORD: '',
      BREW_SMTP_SERVERNAME: '',
    },
    command: 'npm run dev',
    url: 'http://127.0.0.1:4401/api/health',
    reuseExistingServer: !process.env.CI,
  },
});
