import { isDeliveryAddress } from '../../../packages/core/src/delivery-validation.js';
import { isIP } from 'node:net';

export interface NodeSmtpConfig {
  host: string;
  port: number;
  security: 'tls' | 'starttls';
  from: string;
  username?: string;
  password?: string;
  servername?: string;
}
export function validateSmtpConfig(config: NodeSmtpConfig): void {
  if (
    !config.host ||
    (!isIP(config.host) &&
      !config.host.split('.').every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)))
  )
    throw new Error('BREW_SMTP_HOST needs a hostname or IP address.');
  if (!isDeliveryAddress(config.from))
    throw new Error('BREW_SMTP_FROM needs one bare email address.');
  if (!['tls', 'starttls'].includes(config.security))
    throw new Error('BREW_SMTP_SECURITY must be tls or starttls.');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error('BREW_SMTP_PORT must be 1–65535.');
  if (Boolean(config.username) !== Boolean(config.password))
    throw new Error(
      'Set both BREW_SMTP_USER and BREW_SMTP_PASSWORD, or neither for a trusted relay.',
    );
  if (config.servername && !/^[a-z\d.-]+$/i.test(config.servername))
    throw new Error('BREW_SMTP_SERVERNAME needs a TLS hostname.');
}
export function smtpConfigFromEnv(env: Record<string, string | undefined>): NodeSmtpConfig | null {
  if (!Object.keys(env).some((key) => key.startsWith('BREW_SMTP_') && env[key])) return null;
  const security = env.BREW_SMTP_SECURITY ?? 'starttls';
  const config: NodeSmtpConfig = {
    host: env.BREW_SMTP_HOST?.trim() ?? '',
    from: env.BREW_SMTP_FROM?.trim() ?? '',
    port: Number(env.BREW_SMTP_PORT ?? (security === 'tls' ? 465 : 587)),
    security: security as NodeSmtpConfig['security'],
    username: env.BREW_SMTP_USER || undefined,
    password: env.BREW_SMTP_PASSWORD || undefined,
    servername: env.BREW_SMTP_SERVERNAME?.trim() || undefined,
  };
  validateSmtpConfig(config);
  return config;
}
