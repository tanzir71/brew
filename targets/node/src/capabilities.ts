import type { Capabilities } from '../../../packages/core/src/types/capabilities.js';

export function nodeCapabilities(): Capabilities {
  return {
    mode: 'node',
    fetch: 'direct',
    // The scheduler checks adaptive per-feed due times once a minute.
    backgroundFetch: { kind: 'always', everyMinutes: 1 },
    inboundMail: null,
    emailDelivery: null,
    readerApi: false,
    mcp: null,
    webmcp: false,
    ai: { available: [], configured: false },
    readState: 'server',
    publicCopy: false,
    outputs: { twins: true, feed: true, webhook: true },
  };
}
