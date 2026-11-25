import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './src/db/database.js';
import { createApp } from './src/app.js';
import { inboundConfigFromEnv, type NodeInboundConfig } from './src/inbound-config.js';
import { InboundWebhook } from './src/services/inbound-webhook.js';
import { NewsletterService } from './src/services/newsletter-service.js';

const now = new Date('2026-11-26T12:00:00Z');
const clock = { now: () => now, monotonic: () => 0 };
const address = 'letters@in.example.test';
const postmark = {
  kind: 'postmark',
  address,
  username: 'brew',
  password: 'test-only-password-32-characters',
} as const;
const mailgun = { kind: 'mailgun', address, signingKey: 'test-only-mailgun-signing-key' } as const;
const basic = `Basic ${Buffer.from(`${postmark.username}:${postmark.password}`).toString('base64')}`;
const timestamp = String(now.getTime() / 1000);
const token = 'a'.repeat(50);
const sign = (text: string | Uint8Array, at = timestamp) =>
  createHmac('sha256', mailgun.signingKey).update(at).update(text).digest('hex');
const postmarkMessage = () => ({
  From: 'news@journal.test',
  FromName: 'Field Notes',
  OriginalRecipient: address,
  MessageID: 'provider-one',
  Subject: 'Forest dispatch',
  Date: now.toUTCString(),
  HtmlBody:
    '<p>Forest story.</p><img width="1" src="https://metrics.test/open"><div class="sponsor">secretadtoken</div>',
  TextBody: 'Forest story.',
  Headers: [{ Name: 'Message-ID', Value: '<one@journal.test>' }],
  Attachments: [{ Name: 'ignored.html', Content: 'c2VjcmV0YWR0b2tlbg==' }],
});
const mailgunMessage = () => ({
  from: 'Field Notes <news@journal.test>',
  sender: 'bounces@mailer.test',
  recipient: address,
  subject: 'Forest dispatch',
  'body-html': ['<p>Forest story.</p>', '<img width="1" src="https://metrics.test/open">'],
  'body-plain': 'Forest story.',
  'message-headers': [
    ['Date', now.toUTCString()],
    ['Message-Id', '<one@journal.test>'],
  ],
});
const closers: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
async function setup(inbound?: NodeInboundConfig) {
  const database = openDatabase(':memory:');
  const app = await createApp({ database, inbound, clock });
  closers.push(() => app.close());
  const rows = () =>
    database.sqlite.prepare('SELECT * FROM articles').all() as Array<Record<string, unknown>>;
  return { database, app, rows };
}

describe('inbound configuration and capabilities', () => {
  it('is off by default, validates complete settings and never echoes secret values in errors', () => {
    expect(inboundConfigFromEnv({})).toBeNull();
    expect(() => inboundConfigFromEnv({ BREW_IMAP_PASSWORD: 'PRIVATE-VALUE' })).toThrow(
      'BREW_INBOUND_MODE',
    );
    expect(() =>
      inboundConfigFromEnv({
        BREW_INBOUND_MODE: 'postmark',
        BREW_INBOUND_ADDRESS: address,
        BREW_POSTMARK_USERNAME: 'brew',
        BREW_POSTMARK_PASSWORD: 'SHORTSECRET',
      }),
    ).toThrow('at least 16');
    const env = {
      BREW_INBOUND_MODE: 'imap',
      BREW_INBOUND_ADDRESS: ' LETTERS@IN.EXAMPLE.TEST ',
      BREW_IMAP_HOST: 'imap.example.test',
      BREW_IMAP_USER: 'letters',
      BREW_IMAP_PASSWORD: 'PASSWORD',
    };
    expect(inboundConfigFromEnv(env)).toMatchObject({
      kind: 'imap',
      address,
      imap: { security: 'tls', port: 993, mailbox: 'INBOX', everySeconds: 60 },
    });
    expect(inboundConfigFromEnv({ ...env, BREW_IMAP_SECURITY: 'starttls' })).toMatchObject({
      imap: { security: 'starttls', port: 143 },
    });
    for (const invalid of [
      { BREW_IMAP_PORT: '0' },
      { BREW_IMAP_PORT: '993x' },
      { BREW_IMAP_SECURITY: 'plain' },
      { BREW_IMAP_EVERY_SECONDS: '1' },
      { BREW_IMAP_HOST: 'https://USER:PRIVATE-VALUE@host' },
    ]) {
      try {
        inboundConfigFromEnv({ ...env, ...invalid });
        throw new Error('Expected config failure');
      } catch (error) {
        expect(String(error)).not.toContain('PRIVATE-VALUE');
        expect(String(error)).not.toContain('Expected config failure');
      }
    }
  });
  it('exposes only a configured address/mechanism, deactivates stale addresses and keeps credentials private', async () => {
    const { app, database } = await setup(postmark);
    expect((await app.inject('/api/capabilities')).json().inboundMail).toBe('webhook');
    expect((await app.inject('/api/sources/mailbox')).json()).toEqual({ address });
    const metadata = JSON.stringify(
      database.sqlite.prepare('SELECT * FROM inbound_addresses').all(),
    );
    expect(metadata).not.toMatch(/password|username|signingKey/);
    const previous = openDatabase(':memory:');
    previous.sqlite
      .prepare('INSERT INTO inbound_addresses(address,mechanism,active) VALUES(?,?,1)')
      .run(address, 'webhook');
    const other = await createApp({ database: previous, inbound: null });
    closers.push(() => other.close());
    expect((await other.inject('/api/capabilities')).json().inboundMail).toBeNull();
    expect((await other.inject('/api/sources/mailbox')).json()).toEqual({ address: null });
    expect(previous.sqlite.prepare('SELECT active FROM inbound_addresses').get()).toEqual({
      active: 0,
    });
  });
});

describe('Postmark inbound webhook → real core → SQLite → Reader', () => {
  it('acknowledges blocked senders without inserting their letters', async () => {
    const { app, database, rows } = await setup(postmark);
    const request = {
      method: 'POST' as const,
      url: '/api/inbound/email',
      headers: { authorization: basic },
      payload: postmarkMessage(),
    };
    expect((await app.inject(request)).statusCode).toBe(200);
    database.sqlite.prepare('UPDATE feeds SET settings_json=?').run('{"blocked":true}');
    const blocked = {
      ...request,
      payload: {
        ...postmarkMessage(),
        MessageID: 'blocked',
        Headers: [{ Name: 'Message-ID', Value: '<blocked@journal.test>' }],
      },
    };
    const accepted = await app.inject(blocked);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ outcome: 'blocked', articleId: null });
    expect((await app.inject(blocked)).json()).toEqual(accepted.json());
    expect(rows()).toHaveLength(1);
  });
  it('authenticates, checks the envelope recipient, cleans, applies rules and acknowledges replays once', async () => {
    const { app, database, rows } = await setup(postmark);
    const rules = await app.inject({
      method: 'POST',
      url: '/api/rules',
      payload: {
        name: 'Forest',
        enabled: true,
        matchType: 'all',
        scope: {},
        conditions: [{ field: 'content', operator: 'contains', value: 'Forest' }],
        actions: [{ type: 'add_tag', tag: 'Outdoors' }],
        stopProcessing: false,
      },
    });
    expect(rules.statusCode).toBe(201);
    const payload = postmarkMessage();
    expect(
      (await app.inject({ method: 'POST', url: '/api/inbound/email', payload })).statusCode,
    ).toBe(401);
    expect(rows()).toEqual([]);
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/inbound/email',
      headers: { authorization: basic },
      payload,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers['cache-control']).toBe('no-store');
    expect(accepted.json().outcome).toBe('inserted');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({
      author: 'Field Notes',
      content_html: '<p>Forest story.</p>',
      raw_html: payload.HtmlBody,
    });
    expect(
      (await app.inject(`/api/articles/${accepted.json().articleId}`)).json().tags[0].name,
    ).toBe('Outdoors');
    const repeat = await app.inject({
      method: 'POST',
      url: '/api/inbound/email',
      headers: { authorization: basic },
      payload,
    });
    expect(repeat.json()).toEqual(accepted.json());
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM rule_logs').get()).toEqual({ n: 1 });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/inbound/email',
          headers: { authorization: basic },
          payload: { ...payload, HtmlBody: 'Altered replay' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/inbound/email',
          headers: { authorization: basic },
          payload: { ...payload, OriginalRecipient: 'other@in.example.test' },
        })
      ).statusCode,
    ).toBe(403);
    expect(rows()).toHaveLength(1);
  });
  it('rejects event payloads and ambiguous From, supports RawEmail and does not cache failed writes', async () => {
    const { app, database, rows } = await setup(postmark);
    for (const payload of [
      { RecordType: 'Bounce' },
      { ...postmarkMessage(), From: 'a@journal.test,b@journal.test' },
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/inbound/email',
            headers: { authorization: basic },
            payload,
          })
        ).statusCode,
      ).toBe(400);
    database.sqlite.exec(
      "CREATE TRIGGER reject_letter BEFORE INSERT ON articles BEGIN SELECT RAISE(ABORT,'PRIVATE DATABASE ERROR'); END",
    );
    const request = {
      method: 'POST' as const,
      url: '/api/inbound/email',
      headers: { authorization: basic },
      payload: postmarkMessage(),
    };
    const failure = await app.inject(request);
    expect(failure.statusCode).toBe(503);
    expect(failure.body).not.toContain('PRIVATE DATABASE ERROR');
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM inbound_receipts').get()).toEqual({
      n: 0,
    });
    database.sqlite.exec('DROP TRIGGER reject_letter');
    expect((await app.inject(request)).statusCode).toBe(200);
    const raw =
      'From: raw@journal.test\r\nSubject: Raw source\r\nContent-Type: text/html\r\n\r\n<p>Original raw story.</p>';
    expect(
      (
        await app.inject({
          ...request,
          payload: { ...postmarkMessage(), MessageID: 'raw-two', RawEmail: raw },
        })
      ).statusCode,
    ).toBe(200);
    expect(rows().find((row) => row.title === 'Raw source')?.content_html).toBe(
      '<p>Original raw story.</p>',
    );
  });
});

describe('Mailgun native JSON and form webhook signatures', () => {
  it('accepts Route body-mime posts through the MIME alias', async () => {
    const { app, rows } = await setup(mailgun);
    const input = {
      from: 'news@journal.test',
      recipient: address,
      token,
      timestamp,
      signature: sign(token),
      'body-mime':
        'From: Field Notes <news@journal.test>\r\nSubject: Full MIME\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>Full =26 original</p>',
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/inbound/email/mime',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(input).toString(),
    });
    expect(response.statusCode).toBe(200);
    expect(rows()[0]).toMatchObject({
      title: 'Full MIME',
      content_html: '<p>Full &amp; original</p>',
    });
    expect(rows()[0]?.raw_html).toContain('<p>Full & original</p>');
  });
  it('verifies exact JSON bytes over the real HTTP transport, including whitespace and escaped Unicode', async () => {
    const { app, database, rows } = await setup(mailgun);
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    const abort = new AbortController();
    closers.push(() => abort.abort());
    const events = await fetch(`${base}/api/events`, { signal: abort.signal });
    const reader = events.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: heartbeat');
    const raw =
      JSON.stringify({ ...mailgunMessage(), subject: 'Quiet ☕' }, null, 2).replace(
        '☕',
        '\\u2615',
      ) + '\n';
    const headers = {
      'content-type': 'application/json',
      'x-mailgun-signature': sign(raw),
      'x-mailgun-timestamp': timestamp,
    };
    const response = await fetch(`${base}/api/inbound/email/json`, {
      method: 'POST',
      headers,
      body: raw,
    });
    expect(response.status).toBe(200);
    const inserted = (await response.json()) as { feedId: number };
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      `event: article:new\ndata: {"count":1,"feeds":[{"feedId":${inserted.feedId},"count":1}]}\n\n`,
    );
    expect(rows()[0]?.content_html).toBe('<p>Forest story.</p>');
    expect(rows()[0]?.title).toBe('Quiet ☕');
    expect(rows()[0]?.raw_html).toBe(
      '<p>Forest story.</p>\n<img width="1" src="https://metrics.test/open">',
    );
    expect(
      (await fetch(`${base}/api/inbound/email/json`, { method: 'POST', headers, body: raw + ' ' }))
        .status,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/inbound/email/json', headers, payload: raw }))
        .statusCode,
    ).toBe(200);
    expect(rows()).toHaveLength(1);
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM inbound_receipts').get()).toEqual({
      n: 1,
    });
    abort.abort();
  });
  it.each(['application/x-www-form-urlencoded', 'multipart/form-data', 'application/json'])(
    'handles signed legacy fields in %s and binds token replays to message content',
    async (type) => {
      const { app, rows } = await setup(mailgun);
      const input = {
        ...mailgunMessage(),
        'message-headers': JSON.stringify(mailgunMessage()['message-headers']),
        'body-html': '<p>Form story</p>',
        token,
        timestamp,
        signature: sign(token),
      };
      let request: Request;
      if (type === 'application/json')
        request = new Request('http://brew.test', {
          method: 'POST',
          headers: { 'content-type': type },
          body: JSON.stringify(input),
        });
      else {
        const form = new FormData();
        for (const [key, value] of Object.entries(input)) form.set(key, value);
        if (type === 'multipart/form-data')
          form.set('attachment-1', new Blob(['<script>attachment</script>']), 'ignored.html');
        request = new Request('http://brew.test', {
          method: 'POST',
          body: type === 'multipart/form-data' ? form : new URLSearchParams(input),
        });
      }
      const body = Buffer.from(await request.arrayBuffer());
      const headers = { 'content-type': request.headers.get('content-type')! };
      expect(
        (await app.inject({ method: 'POST', url: '/api/inbound/email', headers, payload: body }))
          .statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: 'POST', url: '/api/inbound/email', headers, payload: body }))
          .statusCode,
      ).toBe(200);
      expect(rows()).toHaveLength(1);
      expect(rows()[0]?.content_html).toBe('<p>Form story</p>');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/inbound/email',
            headers: { 'content-type': 'application/json' },
            payload: { ...input, 'body-html': '<p>Changed token payload</p>' },
          })
        ).statusCode,
      ).toBe(409);
    },
  );
  it('rejects bad/expired/future signatures, wrong recipients, unsupported types and malformed JSON without inserts', async () => {
    const { app, rows } = await setup(mailgun);
    const raw = JSON.stringify(mailgunMessage());
    for (const delta of [-86_401, 301]) {
      const at = String(Number(timestamp) + delta);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/inbound/email/json',
            headers: {
              'content-type': 'application/json',
              'x-mailgun-timestamp': at,
              'x-mailgun-signature': sign(raw, at),
            },
            payload: raw,
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (await app.inject({ method: 'POST', url: '/api/inbound/email', payload: mailgunMessage() }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/inbound/email',
          headers: { 'content-type': 'text/plain' },
          payload: 'x',
        })
      ).statusCode,
    ).toBe(415);
    const malformed = '{invalid';
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/inbound/email/json',
          headers: {
            'content-type': 'application/json',
            'x-mailgun-timestamp': timestamp,
            'x-mailgun-signature': sign(malformed),
          },
          payload: malformed,
        })
      ).statusCode,
    ).toBe(400);
    const wrong = JSON.stringify({ ...mailgunMessage(), recipient: 'other@in.example.test' });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/inbound/email/json',
          headers: {
            'content-type': 'application/json',
            'x-mailgun-timestamp': timestamp,
            'x-mailgun-signature': sign(wrong),
          },
          payload: wrong,
        })
      ).statusCode,
    ).toBe(403);
    expect(rows()).toEqual([]);
  });
  it('enforces request/body limits and leaves the default webhook gated', async () => {
    const { app, rows } = await setup(postmark);
    const request = {
      method: 'POST' as const,
      url: '/api/inbound/email',
      headers: { authorization: basic },
    };
    expect(
      (
        await app.inject({
          ...request,
          payload: { ...postmarkMessage(), HtmlBody: 'x'.repeat(2 * 1024 * 1024 + 1) },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          ...request,
          payload: { ...postmarkMessage(), TextBody: 'x'.repeat(10 * 1024 * 1024 + 1) },
        })
      ).statusCode,
    ).toBe(413);
    expect(rows()).toEqual([]);
    const disabled = await setup();
    expect(
      (
        await disabled.app.inject({
          method: 'POST',
          url: '/api/inbound/email',
          payload: postmarkMessage(),
        })
      ).statusCode,
    ).toBe(501);
    // Also bound direct Web Request streams, beyond Fastify's transport guard.
    const handler = new InboundWebhook(
      disabled.database,
      postmark,
      new NewsletterService(disabled.database),
    );
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
        controller.close();
      },
    });
    const streamed = new Request('http://brew.test', {
      method: 'POST',
      headers: { authorization: basic, 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    await expect(handler.receive(streamed)).rejects.toMatchObject({ status: 413 });
  });
  it('serializes concurrent token replays and persists the receipt across handler restarts', async () => {
    const { database, rows } = await setup(mailgun);
    const service = new NewsletterService(database, clock);
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = new InboundWebhook(
      database,
      mailgun,
      {
        ingest: (raw) => service.ingest(raw),
        ingestMessage: async (message) => {
          started();
          await gate;
          return service.ingestMessage(message);
        },
      },
      undefined,
      clock,
    );
    const input = { ...mailgunMessage(), token, timestamp, signature: sign(token) };
    const request = (value: unknown) =>
      new Request('http://brew.test/api/inbound/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
    const first = handler.receive(request(input));
    await waiting;
    const changed = handler.receive(
      request({
        ...input,
        'message-headers': [],
        'Message-Id': 'different-message',
        'body-html': '<p>Changed delivery</p>',
      }),
    );
    const rejection = expect(changed).rejects.toMatchObject({ status: 409 });
    release();
    const accepted = await first;
    await rejection;
    expect(rows()).toHaveLength(1);
    const restarted = new InboundWebhook(database, mailgun, service, undefined, clock);
    expect(await restarted.receive(request(input))).toEqual(accepted);
  });
});
