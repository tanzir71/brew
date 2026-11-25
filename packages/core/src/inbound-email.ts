import { addressParser } from 'postal-mime';
import {
  NewsletterInputError,
  normalizeNewsletterSender,
  validateNewsletterBody,
} from './newsletter-mime.js';
import type { NewsletterMessage } from './types/newsletters.js';

export type InboundEmailProvider = 'postmark' | 'mailgun';
export interface InboundDelivery {
  recipient: string;
  message: NewsletterMessage;
  rawMime?: string;
  providerId?: string;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new NewsletterInputError('Invalid inbound text field.');
  return value;
};
const mailbox = (value: unknown): { address: string; name: string } => {
  const addresses = addressParser(optionalText(value) ?? '');
  if (addresses.length !== 1 || !addresses[0]?.address)
    throw new NewsletterInputError('Inbound mail needs one From mailbox.');
  return { address: normalizeNewsletterSender(addresses[0].address), name: addresses[0].name };
};

/** Normalize provider payloads; authentication is the ingress adapter's responsibility. */
export function decodeInboundEmail(
  provider: InboundEmailProvider,
  input: unknown,
): InboundDelivery {
  if (!record(input)) throw new NewsletterInputError('Expected an inbound email object.');
  const headers: Array<[string, string]> = [];
  const addHeader = (name: unknown, value: unknown) => {
    if (typeof name !== 'string' || typeof value !== 'string')
      throw new NewsletterInputError('Invalid inbound headers.');
    headers.push([name.toLowerCase(), value]);
  };
  if (provider === 'postmark' && input.Headers !== undefined) {
    if (!Array.isArray(input.Headers) || input.Headers.length > 1000)
      throw new NewsletterInputError('Invalid inbound headers.');
    for (const header of input.Headers) {
      if (!record(header)) throw new NewsletterInputError('Invalid inbound headers.');
      addHeader(header.Name, header.Value);
    }
  }
  if (provider === 'mailgun' && input['message-headers'] !== undefined) {
    let rawHeaders = input['message-headers'];
    if (typeof rawHeaders === 'string') {
      try {
        rawHeaders = JSON.parse(rawHeaders);
      } catch {
        throw new NewsletterInputError('Invalid inbound headers.');
      }
    }
    if (!Array.isArray(rawHeaders) || rawHeaders.length > 1000)
      throw new NewsletterInputError('Invalid inbound headers.');
    for (const header of rawHeaders) {
      if (!Array.isArray(header) || header.length !== 2)
        throw new NewsletterInputError('Invalid inbound headers.');
      addHeader(header[0], header[1]);
    }
  }
  const header = (name: string): string | undefined => headers.find(([key]) => key === name)?.[1];
  const postmark = provider === 'postmark';
  const from = mailbox(postmark ? input.From : input.from);
  if (postmark && !from.name)
    from.name =
      optionalText(input.FromName) ??
      (record(input.FromFull) ? optionalText(input.FromFull.Name) : undefined) ??
      '';
  const recipient = normalizeNewsletterSender(
    optionalText(postmark ? input.OriginalRecipient : input.recipient) ?? '',
  );
  let html = postmark ? input.HtmlBody : input['body-html'];
  if (!postmark && Array.isArray(html)) {
    if (html.length > 20 || html.some((part) => typeof part !== 'string'))
      throw new NewsletterInputError('Invalid HTML body parts.');
    html = html.join('\n');
  }
  const rawMime = optionalText(postmark ? input.RawEmail : input['body-mime']);
  const message: NewsletterMessage = {
    from,
    subject: optionalText(postmark ? input.Subject : input.subject),
    messageId:
      header('message-id') ?? optionalText(postmark ? input.MessageID : input['Message-Id']),
    date: header('date') ?? optionalText(postmark ? input.Date : (input.Date ?? input.date)),
    html: optionalText(html),
    text: optionalText(postmark ? input.TextBody : input['body-plain']),
  };
  if (message.html === undefined && message.text === undefined && !rawMime)
    throw new NewsletterInputError('Inbound payload has no email body.');
  validateNewsletterBody(message);
  const providerId = postmark ? optionalText(input.MessageID) : undefined;
  return { recipient, message, rawMime, providerId };
}
