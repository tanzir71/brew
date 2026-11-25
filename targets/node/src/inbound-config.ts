import { normalizeNewsletterSender } from '../../../packages/core/src/newsletter-mime.js';

export interface ImapConfig {
  host: string;
  port: number;
  security: 'tls' | 'starttls';
  user: string;
  password: string;
  mailbox: string;
  everySeconds: number;
}
export type NodeInboundConfig = { address: string } & (
  | { kind: 'imap'; imap: ImapConfig }
  | { kind: 'postmark'; username: string; password: string }
  | { kind: 'mailgun'; signingKey: string }
);
const required = (env: Record<string, string | undefined>, name: string): string => {
  const value = env[name];
  if (!value?.trim()) throw new Error(`${name} is required for inbound email.`);
  return value;
};
function integer(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
    throw new Error(`${name} is out of range.`);
  return parsed;
}
export function inboundConfigFromEnv(
  env: Record<string, string | undefined>,
): NodeInboundConfig | null {
  const kind = env.BREW_INBOUND_MODE;
  if (
    !kind &&
    !Object.keys(env).some(
      (key) => /^(BREW_INBOUND_|BREW_IMAP_|BREW_POSTMARK_|BREW_MAILGUN_)/.test(key) && env[key],
    )
  )
    return null;
  if (!['imap', 'postmark', 'mailgun'].includes(kind ?? ''))
    throw new Error('BREW_INBOUND_MODE must be imap, postmark or mailgun.');
  let address: string;
  try {
    address = normalizeNewsletterSender(required(env, 'BREW_INBOUND_ADDRESS'));
  } catch {
    throw new Error('BREW_INBOUND_ADDRESS needs a valid mailbox address.');
  }
  if (kind === 'postmark') {
    const username = required(env, 'BREW_POSTMARK_USERNAME');
    const password = required(env, 'BREW_POSTMARK_PASSWORD');
    if (username.includes(':') || password.length < 16)
      throw new Error(
        'Postmark requires a username without colon and a webhook password of at least 16 characters.',
      );
    return { kind, address, username, password };
  }
  if (kind === 'mailgun')
    return { kind, address, signingKey: required(env, 'BREW_MAILGUN_SIGNING_KEY') };
  const security = env.BREW_IMAP_SECURITY ?? 'tls';
  if (security !== 'tls' && security !== 'starttls')
    throw new Error('BREW_IMAP_SECURITY must be tls or starttls.');
  const host = required(env, 'BREW_IMAP_HOST').trim();
  if (!/^[a-z\d.:_-]+$/i.test(host))
    throw new Error('BREW_IMAP_HOST needs a hostname without a URL or credentials.');
  return {
    kind: 'imap',
    address,
    imap: {
      host,
      security,
      port: integer(env.BREW_IMAP_PORT, security === 'tls' ? 993 : 143, 1, 65535, 'BREW_IMAP_PORT'),
      user: required(env, 'BREW_IMAP_USER'),
      password: required(env, 'BREW_IMAP_PASSWORD'),
      mailbox: env.BREW_IMAP_MAILBOX?.trim() || 'INBOX',
      everySeconds: integer(env.BREW_IMAP_EVERY_SECONDS, 60, 10, 3600, 'BREW_IMAP_EVERY_SECONDS'),
    },
  };
}
