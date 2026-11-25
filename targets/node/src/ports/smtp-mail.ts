import nodemailer from 'nodemailer';
import { createHash } from 'node:crypto';
import type { ConnectionOptions } from 'node:tls';
import { isDeliveryAddress } from '../../../../packages/core/src/delivery-validation.js';
import type { OutboundMailPort } from '../../../../packages/core/src/types/delivery.js';
import { validateSmtpConfig, type NodeSmtpConfig } from '../outbound-config.js';

export class SmtpMail implements OutboundMailPort {
  readonly kind = 'smtp' as const;
  private transport;
  constructor(
    private config: NodeSmtpConfig,
    tls: Pick<ConnectionOptions, 'ca'> = {},
  ) {
    validateSmtpConfig(config);
    this.config = { ...config };
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.security === 'tls',
      requireTLS: true,
      ...(config.username ? { auth: { user: config.username, pass: config.password } } : {}),
      tls: {
        ...tls,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        ...(config.servername ? { servername: config.servername } : {}),
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  async send(message: Parameters<OutboundMailPort['send']>[0]): Promise<{ messageId?: string }> {
    if (!isDeliveryAddress(message.to)) throw new Error('Choose one valid recipient address.');
    try {
      const receipt = await this.transport.sendMail({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.idempotencyKey
          ? {
              messageId: `<brew.${createHash('sha256').update(message.idempotencyKey).digest('hex')}@${this.config.from.split('@')[1]}>`,
            }
          : {}),
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (receipt.rejected.length || receipt.accepted.length !== 1)
        throw new Error('Recipient rejected');
      return { messageId: receipt.messageId };
    } catch {
      // SMTP errors may contain AUTH values, recipient data or arbitrary server replies.
      throw new Error('SMTP delivery failed. Check the connection, sender and recipient.');
    }
  }
  close(): void {
    this.transport.close();
  }
}
