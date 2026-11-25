import PostalMime, { addressParser } from 'postal-mime';
import type { NewsletterMessage } from './types/newsletters.js';

export const MAX_NEWSLETTER_BYTES = 10 * 1024 * 1024;
export const MAX_NEWSLETTER_BODY_BYTES = 2 * 1024 * 1024;

export class NewsletterInputError extends Error {}

export function normalizeNewsletterSender(address: string): string {
  const normalized = address.trim().toLowerCase();
  if (
    normalized.length > 254 ||
    !/^[^\s<>(),;:"\\@\p{Cc}]+@[^\s<>(),;:"\\@\p{Cc}]+\.[^\s<>(),;:"\\@\p{Cc}]+$/u.test(normalized)
  )
    throw new NewsletterInputError('A newsletter needs one valid From address.');
  return normalized;
}

export function validateNewsletterBody(message: NewsletterMessage): void {
  for (const body of [message.html, message.text]) {
    if (body !== undefined && new TextEncoder().encode(body).byteLength > MAX_NEWSLETTER_BODY_BYTES)
      throw new NewsletterInputError('Newsletter body exceeds the 2 MiB limit.');
  }
}

export async function parseNewsletterMime(raw: string | Uint8Array): Promise<NewsletterMessage> {
  if (
    (typeof raw === 'string' ? new TextEncoder().encode(raw).byteLength : raw.byteLength) >
    MAX_NEWSLETTER_BYTES
  )
    throw new NewsletterInputError('Newsletter message exceeds the 10 MiB limit.');
  const email = await PostalMime.parse(raw, {
    maxNestingDepth: 30,
    maxHeadersSize: 256 * 1024,
    maxPartCount: 200,
    maxRfc822NestingDepth: 0,
    forceRfc822Attachments: true,
  }).catch(() => {
    throw new NewsletterInputError('Malformed MIME or MIME limits exceeded.');
  });
  // Postal Mime returns the first From mailbox. Reject ambiguous duplicate/list headers too.
  const fromHeaders = email.headers.filter((header) => header.key === 'from');
  const addresses = fromHeaders.length === 1 ? addressParser(fromHeaders[0]!.value) : [];
  if (addresses.length !== 1 || !email.from?.address || !addresses[0]?.address)
    throw new NewsletterInputError('A newsletter needs one valid From address.');
  const message: NewsletterMessage = {
    from: { address: normalizeNewsletterSender(email.from.address), name: email.from.name },
    subject: email.subject,
    messageId: email.messageId,
    date: email.date,
    html: email.html,
    text: email.text,
    archiveUrl: email.headers
      .find((header) => header.key === 'list-archive')
      ?.value.match(/<([^>]+)>/)?.[1],
  };
  validateNewsletterBody(message);
  return message;
}
