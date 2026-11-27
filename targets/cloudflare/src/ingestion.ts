import { IngestPipeline } from '../../../packages/core/src/ingest-pipeline.js';
import { NewsletterPipeline } from '../../../packages/core/src/newsletter-pipeline.js';
import {
  MAX_NEWSLETTER_BYTES,
  NewsletterInputError,
} from '../../../packages/core/src/newsletter-mime.js';
import type { AsyncHashPort, ClockPort } from '../../../packages/core/src/ports.js';
import type { D1Database } from '@cloudflare/workers-types';
import { CloudflareStorage } from './storage.js';
import { CloudflareIngestStorage } from './ingest-storage.js';
import { CloudflareNewsletterStorage } from './newsletter-storage.js';

export const cloudflareHash: AsyncHashPort = {
  async sha1(value) {
    const hash = new Uint8Array(
      await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value)),
    );
    return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
  },
};
export function cloudflareIngestion(
  database: D1Database,
  clock: ClockPort,
  rules: { evaluateArticle(id: number): Promise<number> },
) {
  const storage = new CloudflareStorage(database);
  return {
    articles: new IngestPipeline(
      new CloudflareIngestStorage(storage),
      cloudflareHash,
      clock,
      rules,
    ),
    newsletters: new NewsletterPipeline(
      new CloudflareNewsletterStorage(storage),
      cloudflareHash,
      clock,
      rules,
    ),
  };
}
/** Enforce the shared MIME limit before accumulating an Email Routing stream. */
export async function readNewsletterStream(stream: ReadableStream<Uint8Array>, size?: number) {
  if (size !== undefined && size > MAX_NEWSLETTER_BYTES) {
    await stream.cancel();
    throw new NewsletterInputError('Newsletter message exceeds the 10 MiB limit.');
  }
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_NEWSLETTER_BYTES) {
        await reader.cancel();
        throw new NewsletterInputError('Newsletter message exceeds the 10 MiB limit.');
      }
      chunks.push(value);
    }
    const result = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    reader.releaseLock();
  }
}
