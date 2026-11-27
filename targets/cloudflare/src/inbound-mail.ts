import type { ForwardableEmailMessage } from '@cloudflare/workers-types';
import {
  normalizeNewsletterSender,
  NewsletterInputError,
} from '../../../packages/core/src/newsletter-mime.js';
import { NewsletterPipeline } from '../../../packages/core/src/newsletter-pipeline.js';
import type { ClockPort, IngestRulesPort } from '../../../packages/core/src/ports.js';
import { CloudflareStorage } from './storage.js';
import { CloudflareNewsletterStorage } from './newsletter-storage.js';
import { cloudflareHash, readNewsletterStream } from './ingestion.js';

export async function initializeInboundAddress(storage: CloudflareStorage, configured?: string) {
  if (!configured) return;
  const address = normalizeNewsletterSender(configured);
  // Persisted identities win after rotation. Old deployments cannot reactivate
  // revoked addresses by presenting their previous environment configuration.
  await storage.run(
    `INSERT INTO inbound_addresses(address,mechanism,active)
    SELECT ?,'cloudflare-email',1 WHERE NOT EXISTS(SELECT 1 FROM inbound_addresses)`,
    [address],
  );
}
export async function activeInboundAddress(storage: CloudflareStorage) {
  return storage.first<{ id: number; address: string }>(
    "SELECT id,address FROM inbound_addresses WHERE active=1 AND mechanism='cloudflare-email' ORDER BY id LIMIT 1",
  );
}
export async function receiveCloudflareMail(
  message: Pick<ForwardableEmailMessage, 'from' | 'to' | 'raw' | 'rawSize' | 'setReject'>,
  storage: CloudflareStorage,
  clock: ClockPort,
  rules: IngestRulesPort,
) {
  const stream = message.raw as unknown as ReadableStream<Uint8Array>;
  let consumed = false;
  try {
    normalizeNewsletterSender(message.from);
    const recipient = normalizeNewsletterSender(message.to);
    const address = await activeInboundAddress(storage);
    if (!address || recipient !== address.address)
      throw new NewsletterInputError('This receiving address is not active.');
    const pipeline = new NewsletterPipeline(
      new CloudflareNewsletterStorage(storage, () => ({
        predicate:
          "EXISTS(SELECT 1 FROM inbound_addresses WHERE id=? AND address=? AND active=1 AND mechanism='cloudflare-email')",
        values: [address.id, recipient],
        error: () => new NewsletterInputError('This receiving address is not active.'),
      })),
      cloudflareHash,
      clock,
      rules,
    );
    consumed = true;
    await pipeline.ingest(await readNewsletterStream(stream, message.rawSize));
  } catch (error) {
    if (!consumed) await stream.cancel();
    if (error instanceof NewsletterInputError) message.setReject(error.message);
    else throw new Error('Newsletter storage is temporarily unavailable.', { cause: error });
  }
}
