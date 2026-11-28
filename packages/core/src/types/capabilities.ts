export interface Capabilities {
  mode: 'browser' | 'node' | 'cloudflare' | 'php-lite' | 'static';
  fetch: 'direct' | 'relay' | 'extension' | 'build-time';
  fetchConfigured?: boolean;
  backgroundFetch: {
    kind: 'always' | 'while-open' | 'cron' | 'build-time';
    everyMinutes?: number;
  };
  inboundMail: 'cloudflare-email' | 'imap' | 'webhook' | 'email-to-feed' | null;
  emailDelivery: 'smtp' | 'cloudflare-email' | 'resend' | 'php-mail' | null;
  readerApi: boolean;
  mcp: 'stdio+http' | 'http' | null;
  agentAccess?: boolean;
  webmcp: boolean;
  ai: {
    available: Array<'byo' | 'ollama' | 'workers-ai' | 'chrome-builtin'>;
    configured: boolean;
  };
  readState: 'server' | 'local';
  publicCopy: boolean;
  outputs?: { twins?: boolean; feed: boolean; webhook: boolean };
  actions?: { undo: boolean };
  limits?: { maxFetchesPerRun?: number };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const oneOf = (value: unknown, options: readonly string[]): boolean =>
  typeof value === 'string' && options.includes(value);
const positive = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

// Capability data controls feature gates. Reject incomplete or mistyped replies
// instead of filling missing fields with optimistic defaults.
export function isCapabilities(value: unknown): value is Capabilities {
  if (!record(value)) return false;
  const background = value.backgroundFetch;
  const ai = value.ai;
  const limits = value.limits;
  const outputs = value.outputs;
  return (
    oneOf(value.mode, ['browser', 'node', 'cloudflare', 'php-lite', 'static']) &&
    oneOf(value.fetch, ['direct', 'relay', 'extension', 'build-time']) &&
    (value.fetchConfigured === undefined || typeof value.fetchConfigured === 'boolean') &&
    record(background) &&
    oneOf(background.kind, ['always', 'while-open', 'cron', 'build-time']) &&
    (background.everyMinutes === undefined || positive(background.everyMinutes)) &&
    (value.inboundMail === null ||
      oneOf(value.inboundMail, ['cloudflare-email', 'imap', 'webhook', 'email-to-feed'])) &&
    (value.emailDelivery === null ||
      oneOf(value.emailDelivery, ['smtp', 'cloudflare-email', 'resend', 'php-mail'])) &&
    typeof value.readerApi === 'boolean' &&
    (value.mcp === null || oneOf(value.mcp, ['stdio+http', 'http'])) &&
    (value.agentAccess === undefined || typeof value.agentAccess === 'boolean') &&
    typeof value.webmcp === 'boolean' &&
    record(ai) &&
    Array.isArray(ai.available) &&
    ai.available.every((provider) =>
      oneOf(provider, ['byo', 'ollama', 'workers-ai', 'chrome-builtin']),
    ) &&
    typeof ai.configured === 'boolean' &&
    oneOf(value.readState, ['server', 'local']) &&
    typeof value.publicCopy === 'boolean' &&
    (value.actions === undefined ||
      (record(value.actions) && typeof value.actions.undo === 'boolean')) &&
    (outputs === undefined ||
      (record(outputs) &&
        (outputs.twins === undefined || typeof outputs.twins === 'boolean') &&
        typeof outputs.feed === 'boolean' &&
        typeof outputs.webhook === 'boolean')) &&
    (limits === undefined ||
      (record(limits) &&
        (limits.maxFetchesPerRun === undefined ||
          (positive(limits.maxFetchesPerRun) && Number.isInteger(limits.maxFetchesPerRun)))))
  );
}
