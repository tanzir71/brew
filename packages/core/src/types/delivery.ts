export interface OutboundMailPort {
  kind: 'smtp' | 'cloudflare-email' | 'resend' | 'php-mail';
  send(message: {
    to: string;
    subject: string;
    html: string;
    text: string;
    /** Stable for a frozen issue; omitted for an unsaved test send. */
    idempotencyKey?: string;
  }): Promise<{ messageId?: string }>;
}
export interface BrewDeliveryResult {
  status: 'disabled' | 'unavailable' | 'pending' | 'sent' | 'failed';
  attempts: number;
  attemptedAt?: string;
  completedAt?: string;
  messageId?: string;
  httpStatus?: number;
  error?: 'unavailable' | 'configuration' | 'email' | 'http' | 'network' | 'timeout';
}
export interface BrewDeliveryResults {
  version: 1;
  email: BrewDeliveryResult;
  webhook: BrewDeliveryResult;
}
export interface BrewDeliveryOptions {
  mail?: OutboundMailPort;
  fetcher?: typeof fetch;
  baseUrl?: string;
}
export interface ScheduleInfo {
  now: string;
  nextAt: string | null;
  timezone: string;
}
