import { expect, it } from 'vitest';
import { isCapabilities, type Capabilities } from './src/types/capabilities.js';

const browser: Capabilities = {
  mode: 'browser',
  fetch: 'relay',
  backgroundFetch: { kind: 'while-open' },
  inboundMail: 'email-to-feed',
  emailDelivery: null,
  readerApi: false,
  mcp: null,
  webmcp: false,
  ai: { available: ['byo', 'chrome-builtin'], configured: false },
  readState: 'local',
  publicCopy: false,
};

it('accepts the shared contract with nullable capabilities and optional limits', () => {
  expect(isCapabilities(browser)).toBe(true);
  expect(
    isCapabilities({
      ...browser,
      mode: 'cloudflare',
      fetch: 'direct',
      backgroundFetch: { kind: 'cron', everyMinutes: 15 },
      inboundMail: 'cloudflare-email',
      emailDelivery: 'resend',
      readerApi: true,
      mcp: 'http',
      webmcp: true,
      ai: { available: ['workers-ai'], configured: true },
      readState: 'server',
      publicCopy: true,
      limits: { maxFetchesPerRun: 40 },
    }),
  ).toBe(true);
});

it.each([
  null,
  {},
  { ...browser, readerApi: 'false' },
  { ...browser, outputs: { twins: 'yes', feed: true, webhook: false } },
  { ...browser, emailDelivery: undefined },
  { ...browser, mode: 'unknown' },
  { ...browser, backgroundFetch: { kind: 'cron', everyMinutes: 0 } },
  { ...browser, ai: { available: ['unknown'], configured: false } },
  { ...browser, limits: { maxFetchesPerRun: -1 } },
])('rejects untrusted or incomplete capability data: %j', (value) => {
  expect(isCapabilities(value)).toBe(false);
});
