import { isDeliveryAddress } from './delivery-validation.js';
import type { OutboundMailPort } from './types/delivery.js';

export const RESEND_TIMEOUT_MS = 5_000;
export const RESEND_RECEIPT_BYTES = 8_192;
export interface ResendConfig {
  apiKey: string;
  from: string;
}
const validConfig = (config: ResendConfig) =>
  config.apiKey.length <= 512 &&
  /^re_[a-z\d_-]+$/i.test(config.apiKey) &&
  isDeliveryAddress(config.from);

/** The same optional HTTP mail port runs on Node and Workers. No provider SDK. */
export class ResendMail implements OutboundMailPort {
  readonly kind = 'resend' as const;
  private readonly config: ResendConfig;
  constructor(
    config: ResendConfig,
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {
    if (!validConfig(config))
      throw new Error('Configure one valid Resend API key and sender address.');
    this.config = { ...config };
  }
  async send(message: Parameters<OutboundMailPort['send']>[0]): Promise<{ messageId: string }> {
    if (!isDeliveryAddress(message.to)) throw new Error('Choose one valid recipient address.');
    if (!message.subject || /[\r\n]/.test(message.subject))
      throw new Error('Choose a single-line email subject.');
    const controller = new AbortController();
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const perform = async () => {
      const headers = new Headers({
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Brew/0.1',
      });
      if (message.idempotencyKey) {
        const hash = await globalThis.crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(message.idempotencyKey),
        );
        headers.set(
          'Idempotency-Key',
          `brew/${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
        );
      }
      if (controller.signal.aborted) throw new Error('Aborted');
      const upstream = this.fetcher;
      const response = await upstream('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
        body: JSON.stringify({
          from: this.config.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (
        controller.signal.aborted ||
        !response.ok ||
        Number(response.headers.get('content-length')) > RESEND_RECEIPT_BYTES
      ) {
        await response.body?.cancel();
        throw new Error('Provider did not acknowledge');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing receipt');
      activeReader = reader;
      let size = 0,
        text = '';
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (controller.signal.aborted || size > RESEND_RECEIPT_BYTES)
            throw new Error('Invalid receipt');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const receipt: unknown = JSON.parse(text);
      if (
        !receipt ||
        typeof receipt !== 'object' ||
        !('id' in receipt) ||
        typeof receipt.id !== 'string' ||
        !/^[a-z\d_-]{1,255}$/i.test(receipt.id)
      )
        throw new Error('Invalid receipt');
      return { messageId: receipt.id };
    };
    try {
      return await Promise.race([
        perform(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            void activeReader?.cancel().catch(() => {});
            reject(new Error('Timeout'));
          }, RESEND_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Provider bodies, transport errors and credentials never enter API replies or receipts.
      throw new Error('Resend delivery failed. Check the provider, sender and recipient.');
    } finally {
      clearTimeout(timer);
    }
  }
}
/** Invalid/partial optional configuration keeps email unavailable; it never sends. */
export function resendMailFromEnv(
  env: { BREW_RESEND_API_KEY?: string; BREW_RESEND_FROM?: string },
  fetcher: typeof fetch = globalThis.fetch,
): ResendMail | undefined {
  const config = {
    apiKey: env.BREW_RESEND_API_KEY?.trim() ?? '',
    from: env.BREW_RESEND_FROM?.trim() ?? '',
  };
  return validConfig(config) ? new ResendMail(config, fetcher) : undefined;
}
