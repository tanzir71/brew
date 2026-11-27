import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ResendMail,
  resendMailFromEnv,
  RESEND_RECEIPT_BYTES,
  RESEND_TIMEOUT_MS,
} from './resend-mail.js';

const config = { apiKey: 're_test_private_key', from: 'brew@example.test' };
const message = {
  to: 'owner@example.test',
  subject: 'A Brew · No. 1',
  html: '<p>Private &amp; useful.</p>',
  text: 'Private & useful.',
};
afterEach(() => vi.useRealTimers());

it('uses the official wire contract and a stable bounded digest only for frozen sends', async () => {
  const requests: Request[] = [];
  const mail = new ResendMail(config, async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({ id: 'real-provider-id' });
  });
  const key = `https://brew.example.test/${'long-origin/'.repeat(100)}b/3/7`;
  for (const idempotencyKey of [key, key, key + 'different', undefined])
    expect(await mail.send({ ...message, idempotencyKey })).toEqual({
      messageId: 'real-provider-id',
    });
  expect(requests).toHaveLength(4);
  const first = requests[0]!;
  expect(first.url).toBe('https://api.resend.com/emails');
  expect(first.method).toBe('POST');
  expect(first.redirect).toBe('manual');
  expect(first.headers.get('authorization')).toBe(`Bearer ${config.apiKey}`);
  expect(first.headers.get('user-agent')).toBe('Brew/0.1');
  expect(await first.json()).toEqual({
    from: config.from,
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  const expected = `brew/${createHash('sha256').update(key).digest('hex')}`;
  expect(first.headers.get('idempotency-key')).toBe(expected);
  expect(requests[1]!.headers.get('idempotency-key')).toBe(expected);
  expect(requests[2]!.headers.get('idempotency-key')).not.toBe(expected);
  expect(requests[3]!.headers.has('idempotency-key')).toBe(false);
});

it.each([302, 307, 400, 403, 429, 500])(
  'rejects HTTP %i without retrying, following redirects or exposing provider details',
  async (status) => {
    const cancel = vi.fn(),
      fetcher = vi.fn(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            status,
            headers: { location: 'https://elsewhere.test/steal' },
          }),
      );
    await expect(new ResendMail(config, fetcher).send(message)).rejects.toThrow(
      /^Resend delivery failed\./,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);

it.each([
  '{}',
  'null',
  'not-json',
  '{"id":""}',
  '{"id":"line\\r\\nbreak"}',
  JSON.stringify({ id: 'x'.repeat(256) }),
])('requires a real provider receipt: %s', async (receipt) => {
  await expect(
    new ResendMail(config, async () => new Response(receipt)).send(message),
  ).rejects.toThrow(/^Resend delivery failed\./);
});

it('bounds advertised and streamed receipts and releases both bodies', async () => {
  for (const advertised of [true, false]) {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(RESEND_RECEIPT_BYTES + 1));
        },
        cancel,
      }),
      { headers: advertised ? { 'content-length': String(RESEND_RECEIPT_BYTES + 1) } : {} },
    );
    await expect(new ResendMail(config, async () => response).send(message)).rejects.toThrow(
      /^Resend delivery failed\./,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  }
});

it('times out an uncooperative fetch and cancels a response that arrives after the deadline', async () => {
  vi.useFakeTimers();
  let finish!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  const pending = new ResendMail(config, async (_input, init) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  }).send(message);
  const rejected = expect(pending).rejects.toThrow(/^Resend delivery failed\./);
  await vi.advanceTimersByTimeAsync(RESEND_TIMEOUT_MS);
  await rejected;
  expect(signal!.aborted).toBe(true);
  const cancel = vi.fn();
  finish(new Response(new ReadableStream({ cancel })));
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
});

it('times out and cancels a stalled receipt stream', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const pending = new ResendMail(
    config,
    async () => new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel })),
  ).send(message);
  const rejected = expect(pending).rejects.toThrow(/^Resend delivery failed\./);
  await vi.advanceTimersByTimeAsync(RESEND_TIMEOUT_MS);
  await rejected;
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('keeps partial or malformed optional configuration unavailable and rejects header fragments before I/O', async () => {
  for (const env of [
    {},
    { BREW_RESEND_API_KEY: config.apiKey },
    { BREW_RESEND_FROM: config.from },
    { BREW_RESEND_API_KEY: 're_secret\r\nx', BREW_RESEND_FROM: config.from },
    { BREW_RESEND_API_KEY: config.apiKey, BREW_RESEND_FROM: 'Name <brew@example.test>' },
  ])
    expect(resendMailFromEnv(env)).toBeUndefined();
  const fetcher = vi.fn();
  const mail = resendMailFromEnv(
    { BREW_RESEND_API_KEY: config.apiKey, BREW_RESEND_FROM: config.from },
    fetcher,
  )!;
  await expect(mail.send({ ...message, to: 'one@example.test,two@example.test' })).rejects.toThrow(
    'one valid',
  );
  await expect(
    mail.send({ ...message, subject: 'Subject\r\nBcc: third@example.test' }),
  ).rejects.toThrow('single-line');
  expect(fetcher).not.toHaveBeenCalled();
});
