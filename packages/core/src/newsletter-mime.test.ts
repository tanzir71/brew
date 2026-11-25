import { describe, expect, it } from 'vitest';
import {
  MAX_NEWSLETTER_BYTES,
  normalizeNewsletterSender,
  parseNewsletterMime,
} from './newsletter-mime.js';

const mime = (body: string, headers = 'Content-Type: text/html; charset=utf-8') =>
  `From: =?UTF-8?B?Sm8gUGFyaw==?= <News+design@Journal.test>\r\nSubject: =?UTF-8?Q?Quiet_=E2=98=95?=\r\nMessage-ID: <one@journal.test>\r\nDate: Thu, 26 Nov 2026 06:00:00 +0000\r\n${headers}\r\n\r\n${body}`;

describe('portable newsletter MIME decoding', () => {
  it('decodes names, subjects, quoted-printable charset and folded headers', async () => {
    const message = await parseNewsletterMime(
      mime(
        '<p>Caf=E9 =26 a story</p>',
        'Content-Type: text/html;\r\n charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\nList-Archive: <https://journal.test/archive>',
      ),
    );
    expect(message).toMatchObject({
      from: { address: 'news+design@journal.test', name: 'Jo Park' },
      subject: 'Quiet ☕',
      archiveUrl: 'https://journal.test/archive',
      messageId: '<one@journal.test>',
    });
    expect(message.html?.trim()).toBe('<p>Café & a story</p>');
  });
  it('selects HTML alternative, decodes base64, and excludes attached HTML and forwarded messages', async () => {
    const body =
      '--mixed\r\nContent-Type: multipart/alternative; boundary=alt\r\n\r\n--alt\r\nContent-Type: text/plain\r\n\r\nPlain story\r\n--alt\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: base64\r\n\r\nPHA+SFRNTCBzdG9yeTwvcD4=\r\n--alt--\r\n--mixed\r\nContent-Type: text/html\r\nContent-Disposition: attachment; filename=evil.html\r\n\r\n<script>attachment</script>\r\n--mixed\r\nContent-Type: message/rfc822\r\n\r\nFrom: other@journal.test\r\nContent-Type: text/html\r\n\r\n<p>Forwarded body</p>\r\n--mixed--';
    const message = await parseNewsletterMime(
      new TextEncoder().encode(mime(body, 'Content-Type: multipart/mixed; boundary=mixed')),
    );
    expect(message.html).toBe('<p>HTML story</p>');
    expect(message.text).toContain('Plain story');
    expect(JSON.stringify(message)).not.toMatch(/attachment|Forwarded body|evil.html/);
  });
  it('keeps plain text and accepts missing optional headers', async () => {
    const message = await parseNewsletterMime(
      'From: news@journal.test\nContent-Type: text/plain\n\nA < B & C',
    );
    expect(message.text?.trim()).toBe('A < B & C');
    expect(message.html).toBeUndefined();
    expect(normalizeNewsletterSender(' NEWS+one@Journal.TEST ')).toBe('news+one@journal.test');
  });
  it.each([
    'Subject: No sender',
    'From: bad',
    'From: a@journal.test, b@journal.test',
    'From: Group: a@journal.test;',
    'From: a@journal.test\r\nFrom: b@journal.test',
  ])('rejects ambiguous or missing From: %s', async (headers) => {
    await expect(parseNewsletterMime(`${headers}\r\n\r\nBody`)).rejects.toThrow('one valid From');
  });
  it('enforces raw, decoded body, header and MIME part bounds', async () => {
    await expect(parseNewsletterMime(new Uint8Array(MAX_NEWSLETTER_BYTES + 1))).rejects.toThrow(
      '10 MiB',
    );
    await expect(parseNewsletterMime(mime('x'.repeat(2 * 1024 * 1024 + 1)))).rejects.toThrow(
      '2 MiB',
    );
    await expect(
      parseNewsletterMime(mime('Body', `X-Large: ${'x'.repeat(256 * 1024)}`)),
    ).rejects.toThrow();
    const parts = Array.from(
      { length: 201 },
      () => '--many\r\nContent-Type: text/plain\r\n\r\nx',
    ).join('\r\n');
    await expect(
      parseNewsletterMime(
        mime(`${parts}\r\n--many--`, 'Content-Type: multipart/mixed; boundary=many'),
      ),
    ).rejects.toThrow();
  });
});
