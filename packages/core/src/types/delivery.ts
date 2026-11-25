export interface OutboundMailPort {
  kind: 'smtp' | 'cloudflare-email' | 'resend' | 'php-mail';
  send(message: { to: string; subject: string; html: string }): Promise<{ messageId?: string }>;
}
export interface ScheduleInfo {
  now: string;
  nextAt: string | null;
  timezone: string;
}
