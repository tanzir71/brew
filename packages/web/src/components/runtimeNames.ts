import type { Capabilities } from '@brew/core/types/capabilities';

// Names are presentation metadata; feature behavior comes from capability fields.
export const runtimeNames: Record<Capabilities['mode'], { short: string; full: string }> = {
  node: { short: 'Node', full: 'Node / Docker' },
  browser: { short: 'Browser', full: 'This browser' },
  cloudflare: { short: 'Cloudflare', full: 'Cloudflare Workers' },
  'php-lite': { short: 'Lite', full: 'Shared hosting (Lite)' },
  static: { short: 'Static', full: 'GitHub Pages' },
};
