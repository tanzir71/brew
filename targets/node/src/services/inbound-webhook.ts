import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { InboundEmailError, type InboundEmailPort } from '../../../../packages/api/src/inbound.js';
import { decodeInboundEmail } from '../../../../packages/core/src/inbound-email.js';
import {
  MAX_NEWSLETTER_BYTES,
  NewsletterInputError,
} from '../../../../packages/core/src/newsletter-mime.js';
import type { ClockPort } from '../../../../packages/core/src/ports.js';
import type { NewsletterIngestResult } from '../../../../packages/core/src/types/newsletters.js';
import type { BrewDatabase } from '../db/database.js';
import type { NodeInboundConfig } from '../inbound-config.js';
import type { NewsletterService } from './newsletter-service.js';
import { nodeClock } from '../ports/runtime.js';

export const MAX_INBOUND_REQUEST_BYTES = MAX_NEWSLETTER_BYTES;
const digest = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');
const equal = (left: string, right: string): boolean =>
  timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right)));
type WebhookConfig = Exclude<NodeInboundConfig, { kind: 'imap' }>;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

async function limitedBody(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_INBOUND_REQUEST_BYTES) {
        await reader.cancel();
        throw new InboundEmailError('Inbound request exceeds 10 MiB.', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

export class InboundWebhook implements InboundEmailPort {
  private readonly pending = new Map<string, Promise<NewsletterIngestResult>>();
  constructor(
    private readonly database: BrewDatabase,
    private readonly config: WebhookConfig,
    private readonly newsletters: Pick<NewsletterService, 'ingest' | 'ingestMessage'>,
    private readonly inserted: (result: NewsletterIngestResult) => void = () => undefined,
    private readonly clock: ClockPort = nodeClock,
  ) {}

  async receive(request: Request): Promise<NewsletterIngestResult> {
    if (this.config.kind === 'postmark') {
      const expected = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`;
      if (!equal(request.headers.get('authorization') ?? '', expected))
        throw new InboundEmailError('Invalid webhook authentication.', 401);
    }
    const contentType = request.headers.get('content-type') ?? '';
    const type = contentType.split(';')[0]?.trim().toLowerCase();
    if (
      this.config.kind === 'postmark'
        ? type !== 'application/json'
        : ![
            'application/json',
            'application/x-www-form-urlencoded',
            'multipart/form-data',
          ].includes(type ?? '')
    )
      throw new InboundEmailError('Unsupported inbound content type.', 415);
    const raw = await limitedBody(request);
    let receiptKey: string | undefined;
    if (this.config.kind === 'mailgun' && request.headers.has('x-mailgun-signature')) {
      const timestamp = request.headers.get('x-mailgun-timestamp') ?? '';
      this.verifySignature(timestamp, request.headers.get('x-mailgun-signature') ?? '', raw);
      receiptKey = `mailgun-json:${digest(request.headers.get('x-mailgun-signature')!)}`;
    }
    let payload: unknown;
    try {
      if (type === 'application/json') payload = JSON.parse(new TextDecoder().decode(raw));
      else {
        const form = await new Request('http://brew.internal', {
          method: 'POST',
          headers: { 'content-type': contentType },
          body: Buffer.from(raw),
        }).formData();
        const fields: Record<string, string | string[]> = {};
        for (const [key, value] of form) {
          if (typeof value !== 'string') continue; // Attachments never enter the article pipeline.
          if (fields[key] !== undefined) fields[key] = [...[fields[key]].flat(), value];
          else fields[key] = value;
        }
        payload = fields;
      }
    } catch {
      throw new InboundEmailError('Malformed inbound payload.', 400);
    }
    if (this.config.kind === 'mailgun' && !receiptKey) {
      if (
        !record(payload) ||
        typeof payload.token !== 'string' ||
        payload.token.length < 16 ||
        payload.token.length > 256
      )
        throw new InboundEmailError('Invalid webhook signature.', 401);
      this.verifySignature(
        String(payload.timestamp ?? ''),
        typeof payload.signature === 'string' ? payload.signature : '',
        payload.token,
      );
      receiptKey = `mailgun-form:${digest(payload.token)}`;
    }
    try {
      const delivery = decodeInboundEmail(this.config.kind, payload);
      if (delivery.recipient !== this.config.address)
        throw new InboundEmailError('This mailbox does not accept that recipient.', 403);
      if (delivery.rawMime && Buffer.byteLength(delivery.rawMime) > MAX_NEWSLETTER_BYTES)
        throw new InboundEmailError('Inbound MIME exceeds 10 MiB.', 413);
      if (!receiptKey && delivery.providerId)
        receiptKey = `postmark:${digest(delivery.providerId)}`;
      const hash = digest(JSON.stringify(delivery));
      const process = async (): Promise<NewsletterIngestResult> => {
        const now = this.clock.now().getTime();
        this.database.sqlite.prepare('DELETE FROM inbound_receipts WHERE expires_at <= ?').run(now);
        if (receiptKey) {
          const receipt = this.database.sqlite
            .prepare('SELECT request_hash,result_json FROM inbound_receipts WHERE key=?')
            .get(receiptKey) as { request_hash: string; result_json: string } | undefined;
          if (receipt) {
            if (receipt.request_hash !== hash)
              throw new InboundEmailError(
                'Delivery identity was reused with different content.',
                409,
              );
            return JSON.parse(receipt.result_json) as NewsletterIngestResult;
          }
        }
        const result = delivery.rawMime
          ? await this.newsletters.ingest(delivery.rawMime)
          : await this.newsletters.ingestMessage(delivery.message);
        if (receiptKey)
          this.database.sqlite
            .prepare(
              'INSERT INTO inbound_receipts(key,request_hash,result_json,expires_at) VALUES(?,?,?,?) ON CONFLICT(key) DO NOTHING',
            )
            .run(receiptKey, hash, JSON.stringify(result), now + 86_400_000);
        if (result.outcome === 'inserted') this.inserted(result);
        return result;
      };
      if (!receiptKey) return await process();
      // Serialize the same delivery identity through rule evaluation and receipt
      // persistence, so two concurrent token replays cannot both pass the ledger.
      const key = receiptKey;
      const prior = this.pending.get(key);
      const job = (prior ? prior.catch(() => undefined) : Promise.resolve()).then(process);
      this.pending.set(key, job);
      const cleanup = () => {
        if (this.pending.get(key) === job) this.pending.delete(key);
      };
      void job.then(cleanup, cleanup);
      return await job;
    } catch (error) {
      if (error instanceof NewsletterInputError) throw new InboundEmailError(error.message, 400);
      throw error;
    }
  }

  private verifySignature(
    timestamp: string,
    signature: string,
    tokenOrBody: string | Uint8Array,
  ): void {
    if (this.config.kind !== 'mailgun')
      throw new InboundEmailError('Webhook provider is not configured.', 401);
    const seconds = /^\d{1,12}$/.test(timestamp) ? Number(timestamp) : NaN;
    const age = this.clock.now().getTime() / 1000 - seconds;
    if (!Number.isFinite(age) || age > 86_400 || age < -300 || !/^[a-f\d]{64}$/i.test(signature))
      throw new InboundEmailError('Invalid or expired webhook signature.', 401);
    const expected = createHmac('sha256', this.config.signingKey)
      .update(timestamp)
      .update(tokenOrBody)
      .digest('hex');
    if (!equal(signature.toLowerCase(), expected))
      throw new InboundEmailError('Invalid webhook signature.', 401);
  }
}
