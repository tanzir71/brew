import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import PostalMime from 'postal-mime';
import { openDatabase } from './src/db/database.js';
import { BrewService } from './src/services/brew-service.js';
import { NodeBrewStorage } from './src/ports/brew-storage.js';
import { SmtpMail } from './src/ports/smtp-mail.js';
import { smtpConfigFromEnv } from './src/outbound-config.js';
import { createApp } from './src/app.js';
import { smtpServer } from './test/smtp-server.js';
import { outputFixtures, outputOrigin } from '../../packages/core/test/output-fixtures.js';
import { renderBrewEmail } from '../../packages/core/src/brew-outputs.js';
import {
  defaultDelivery,
  newBrewSection,
  validateComposition,
} from '../../packages/core/src/composition-model.js';
import { BrewDeliveryRunner } from '../../packages/core/src/brew-delivery.js';
import type { BrewSnapshot, BrewConfigDraft } from '../../packages/core/src/types/brew.js';
import type { BrewDeliveryOptions } from '../../packages/core/src/types/delivery.js';

const now = new Date('2026-11-25T01:00:00Z');
const clock = { now: () => now };
const closes: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of closes.splice(0).reverse()) await close();
});
const draft = (): BrewConfigDraft => ({
  name: 'Weekend & reading',
  enabled: true,
  timezone: 'UTC',
  schedule: { kind: 'daily', time: '01:00' },
  delivery: { ...defaultDelivery(), email: { to: 'reader@example.test' } },
  sections: [
    {
      ...newBrewSection('note', 'note'),
      title: 'A note',
      note: 'Read **slowly**. [Library](/a/7)',
    },
  ],
});
function setup(options: BrewDeliveryOptions = {}) {
  const database = openDatabase(':memory:');
  const releaseDatabase = () => database.close();
  closes.push(releaseDatabase);
  const service = new BrewService(database, clock, options);
  const config = service.createComposition(draft());
  return { database, service, config, storage: new NodeBrewStorage(database), releaseDatabase };
}
async function localSmtp(
  security: 'tls' | 'starttls',
  options: { reject?: boolean; noStarttls?: boolean } = {},
) {
  const server = await smtpServer({ security, ...options });
  closes.push(server.close);
  const config = {
    host: '127.0.0.1',
    port: server.port,
    security,
    from: 'brew@example.test',
    username: 'test-user',
    password: 'test-password',
    servername: 'localhost',
  };
  const mail = new SmtpMail(config, { ca: server.ca });
  closes.push(() => mail.close());
  return { server, mail, config };
}
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closes.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('actual SMTP and frozen issue delivery', () => {
  it('preserves every exit fixture HTML/plain-text pair through actual SMTP MIME encoding', async () => {
    const { server, mail } = await localSmtp('tls');
    const normalize = (value: string | undefined) => value?.replace(/\r\n/g, '\n').trimEnd();
    for (const fixture of outputFixtures) {
      const issue = fixture.make();
      const rendered = renderBrewEmail(issue, { baseUrl: outputOrigin });
      const subject = `${issue.configName} · No. ${issue.issueNumber}`;
      await mail.send({ to: 'reader@example.test', subject, ...rendered });
      const captured = await new PostalMime().parse(server.messages.at(-1)!);
      expect(captured.subject).toBe(subject);
      expect(normalize(captured.html)).toBe(normalize(rendered.html));
      expect(normalize(captured.text)).toBe(normalize(rendered.text));
      expect(captured.attachments).toEqual([]);
    }
    expect(server.messages).toHaveLength(outputFixtures.length);
  });

  it.each(['tls', 'starttls'] as const)(
    'sends authenticated multipart HTML/plain text over %s with one recipient and a stable message ID',
    async (security) => {
      const { server, mail } = await localSmtp(security);
      const f = setup({ mail, baseUrl: 'https://brew.example.test' });
      const issue = (await f.service.generateComposition(f.config.id)) as BrewSnapshot;
      expect(server.messages).toHaveLength(1);
      expect(server.auth).toEqual([{ encrypted: true, value: '\0test-user\0test-password' }]);
      expect(server.recipients).toEqual(['RCPT TO:<reader@example.test>']);
      const mime = await new PostalMime().parse(server.messages[0]!);
      expect(mime.subject).toBe('Weekend & reading · No. 1');
      expect(mime.html).toContain('width="600"');
      expect(mime.html).toContain('https://brew.example.test/a/7');
      expect(mime.text).toContain('Read slowly. Library (https://brew.example.test/a/7)');
      const report = f.storage.deliveryResults(issue.id)!;
      expect(report.email).toMatchObject({
        status: 'sent',
        attempts: 1,
        messageId: mime.messageId,
      });
      expect(report.webhook.status).toBe('disabled');
      const payload = f.database.sqlite
        .prepare('SELECT payload_json FROM brews WHERE id=?')
        .get(issue.id);
      await Promise.all([
        new BrewDeliveryRunner(f.storage, clock, {
          mail,
          baseUrl: 'https://brew.example.test',
        }).deliver(issue, f.config.delivery),
        new BrewDeliveryRunner(f.storage, clock, { mail }).deliver(issue, f.config.delivery),
      ]);
      expect(server.messages).toHaveLength(1);
      expect(
        f.database.sqlite.prepare('SELECT payload_json FROM brews WHERE id=?').get(issue.id),
      ).toEqual(payload);
    },
  );

  it('records SMTP rejection without losing the issue or persisting server replies/secrets', async () => {
    const { server, mail } = await localSmtp('tls', { reject: true });
    const f = setup({ mail, baseUrl: 'https://brew.example.test' });
    const issue = await f.service.generateComposition(f.config.id);
    expect(f.service.snapshot(issue.id)).not.toBeNull();
    expect(f.storage.deliveryResults(issue.id)!.email).toMatchObject({
      status: 'failed',
      error: 'email',
      attempts: 1,
    });
    expect(JSON.stringify(f.storage.deliveryResults(issue.id))).not.toMatch(
      /test-password|server-private-detail|reader@example/,
    );
    expect(server.messages).toEqual([]);
  });

  it('refuses untrusted certificates and STARTTLS downgrade without authenticating or delivering', async () => {
    const tls = await localSmtp('tls');
    const untrusted = new SmtpMail(tls.config);
    closes.push(() => untrusted.close());
    const message = {
      to: 'reader@example.test',
      subject: 'Test',
      html: '<p>Test</p>',
      text: 'Test',
    };
    await expect(untrusted.send(message)).rejects.toThrow('SMTP delivery failed');
    expect(tls.server.auth).toEqual([]);
    const plain = await localSmtp('starttls', { noStarttls: true });
    await expect(plain.mail.send(message)).rejects.toThrow('SMTP delivery failed');
    expect(plain.server.auth).toEqual([]);
    expect(plain.server.messages).toEqual([]);
  });

  it('test-sends the unsaved multipart preview through the real Node SMTP adapter without writes', async () => {
    const { server, config } = await localSmtp('tls');
    const database = openDatabase(':memory:');
    const app = await createApp({
      database,
      smtp: config,
      smtpTls: { ca: server.ca },
      publicUrl: 'https://brew.example.test',
      clock,
    });
    closes.push(() => app.close());
    const service = new BrewService(database, clock);
    const saved = service.createComposition(draft());
    const before = database.sqlite.prepare('SELECT total_changes() AS n').get();
    const response = await app.inject({
      method: 'POST',
      url: `/api/brew-configs/${saved.id}/test-email`,
      payload: { draft: { ...draft(), name: 'Unsaved test' } },
    });
    expect(response.statusCode).toBe(200);
    const mime = await new PostalMime().parse(server.messages[0]!);
    expect(mime.subject).toBe('Test · Unsaved test');
    expect(mime.text).toContain('Library (https://brew.example.test/a/7)');
    expect(database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(service.history(saved.id)).toEqual([]);
    expect((await app.inject('/api/capabilities')).json().emailDelivery).toBe('smtp');
    const generated = await app.inject({
      method: 'POST',
      url: `/api/brew-configs/${saved.id}/generate`,
    });
    expect(generated.statusCode).toBe(200);
    expect(server.messages).toHaveLength(2);
    expect((await new PostalMime().parse(server.messages[1]!)).subject).toBe(
      'Weekend & reading · No. 1',
    );
    expect(
      (await app.inject(`/api/brews/${generated.json().id}/delivery`)).json().results.email.status,
    ).toBe('sent');
  });
});

describe('bounded JSON webhooks and durable results', () => {
  it('keeps webhook success independent of a configured mail failure', async () => {
    const f = setup({
      baseUrl: 'https://brew.example.test',
      mail: {
        kind: 'smtp',
        send: async () => {
          throw new Error('private-provider-reply');
        },
      },
      fetcher: async () => new Response(null, { status: 204 }),
    });
    f.service.updateComposition(f.config.id, {
      ...f.config,
      delivery: { ...f.config.delivery, webhook: { url: 'https://receiver.test/hook' } },
    });
    const issue = await f.service.generateComposition(f.config.id);
    expect(f.storage.deliveryResults(issue.id)).toMatchObject({
      email: { status: 'failed', error: 'email', attempts: 1 },
      webhook: { status: 'sent', attempts: 1 },
    });
    expect(JSON.stringify(f.storage.deliveryResults(issue.id))).not.toContain(
      'private-provider-reply',
    );
  });
  it('POSTs frozen content with one retry, a stable idempotency key and no mail/configuration metadata', async () => {
    const received: Array<{ body: string; key: string | undefined }> = [];
    const origin = await listen(
      createServer((req, res) => {
        let body = '';
        req.on('data', (bytes) => {
          body += String(bytes);
        });
        req.on('end', () => {
          received.push({ body, key: req.headers['idempotency-key'] as string | undefined });
          res.writeHead(received.length === 1 ? 503 : 204).end();
        });
      }),
    );
    const f = setup({ baseUrl: 'https://brew.example.test', fetcher: globalThis.fetch });
    const value = {
      ...f.config,
      delivery: { ...f.config.delivery, webhook: { url: `${origin}/receive` } },
    };
    f.service.updateComposition(f.config.id, value);
    const issue = await f.service.generateComposition(f.config.id);
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(received[1]);
    expect(received[0]!.key).toBe(`https://brew.example.test/b/${f.config.id}/${issue.id}`);
    expect(JSON.parse(received[0]!.body)).toMatchObject({
      id: issue.id,
      configName: f.config.name,
    });
    expect(received[0]!.body).not.toMatch(/delivery|webhook|reader@example|sources|readAt/);
    expect(f.storage.deliveryResults(issue.id)).toMatchObject({
      email: { status: 'unavailable' },
      webhook: { status: 'sent', attempts: 2, httpStatus: 204 },
    });
    const app = await createApp({ database: f.database, clock });
    // This app now owns the database; remove the earlier independent close.
    closes.splice(closes.indexOf(f.releaseDatabase), 1);
    closes.push(() => app.close());
    const response = await app.inject(`/api/brews/${issue.id}/delivery`);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toEqual({
      issueId: issue.id,
      results: f.storage.deliveryResults(issue.id),
    });
    expect((await app.inject('/api/brews/999999/delivery')).statusCode).toBe(404);
  });

  it('does not follow redirects and stops after exactly two failed attempts', async () => {
    const paths: string[] = [];
    const origin = await listen(
      createServer((req, res) => {
        paths.push(req.url!);
        req.resume();
        res.writeHead(302, { Location: '/unexpected' }).end();
      }),
    );
    const f = setup({ fetcher: globalThis.fetch });
    f.service.updateComposition(f.config.id, {
      ...f.config,
      delivery: { ...defaultDelivery(), webhook: { url: `${origin}/receive` } },
    });
    const issue = await f.service.generateComposition(f.config.id);
    expect(paths).toEqual(['/receive', '/receive']);
    expect(f.storage.deliveryResults(issue.id)!.webhook).toMatchObject({
      status: 'failed',
      attempts: 2,
      error: 'network',
    });
  });

  it('bounds each attempt to five seconds even when a fetch port ignores cancellation', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const f = setup({
      fetcher: async (_url, init) => {
        signals.push(init!.signal as AbortSignal);
        return new Promise<Response>(() => {});
      },
    });
    f.service.updateComposition(f.config.id, {
      ...f.config,
      delivery: { ...defaultDelivery(), webhook: { url: 'https://receiver.test/hook' } },
    });
    const pending = f.service.generateComposition(f.config.id);
    await vi.advanceTimersByTimeAsync(10_001);
    const issue = await pending;
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(f.storage.deliveryResults(issue.id)!.webhook).toMatchObject({
      status: 'failed',
      error: 'timeout',
      attempts: 2,
    });
  });

  it('coalesces scheduled generation while mail is pending and records the schedule before external completion', async () => {
    let finish!: () => void;
    let sends = 0;
    const mail = {
      kind: 'smtp' as const,
      send: async () => {
        sends++;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { messageId: 'test-id' };
      },
    };
    const f = setup({ mail, baseUrl: 'https://brew.example.test' });
    const pending = f.service.runCompositionScheduled(now);
    await vi.waitFor(() => expect(sends).toBe(1));
    expect(await f.service.runCompositionScheduled(now)).toBe(0);
    const key = `brew_composed_${f.config.id}_${now.toISOString()}`;
    expect(f.storage.setting(key)).toBe(now.toISOString());
    expect(f.storage.deliveryResults(f.service.history(f.config.id)[0]!.id)!.email.status).toBe(
      'pending',
    );
    finish();
    expect(await pending).toBe(1);
    expect(await f.service.runCompositionScheduled(now)).toBe(0);
    expect(sends).toBe(1);
  });
});

describe('delivery configuration boundaries', () => {
  it('keeps SMTP off by default and requires complete TLS/auth/sender settings without leaking values', async () => {
    expect(smtpConfigFromEnv({})).toBeNull();
    expect(
      smtpConfigFromEnv({
        BREW_SMTP_HOST: 'smtp.example.test',
        BREW_SMTP_FROM: 'brew@example.test',
      }),
    ).toMatchObject({ port: 587, security: 'starttls' });
    for (const extra of [
      { BREW_SMTP_USER: 'user' },
      { BREW_SMTP_PORT: '0' },
      { BREW_SMTP_SECURITY: 'none' },
      { BREW_SMTP_FROM: 'first@example.test,second@example.test' },
      { BREW_SMTP_HOST: 'smtp://secret@example.test' },
    ])
      expect(() =>
        smtpConfigFromEnv({
          BREW_SMTP_HOST: 'smtp.example.test',
          BREW_SMTP_FROM: 'brew@example.test',
          ...extra,
        }),
      ).toThrow();
    const config = smtpConfigFromEnv({
      BREW_SMTP_HOST: 'smtp.example.test',
      BREW_SMTP_FROM: 'brew@example.test',
    })!;
    await expect(createApp({ smtp: config })).rejects.toThrow('BREW_PUBLIC_URL');
  });
  it.each([
    'a@example.test,b@example.test',
    'a,b@example.test',
    'a@example.test\r\nBcc: other@example.test',
    '<a@example.test>',
    '.a@example.test',
    'a..b@example.test',
  ])('rejects recipient lists/header syntax: %s', (to) => {
    expect(() =>
      validateComposition({ ...draft(), delivery: { ...defaultDelivery(), email: { to } } }),
    ).toThrow('one valid delivery email');
  });
  it.each([
    'https://user:secret@receiver.test/hook',
    'file:///private',
    'https://receiver.test/hook#ignored',
  ])('rejects webhook URLs fetch cannot deliver safely: %s', (url) => {
    expect(() =>
      validateComposition({ ...draft(), delivery: { ...defaultDelivery(), webhook: { url } } }),
    ).toThrow('without credentials');
  });
});
