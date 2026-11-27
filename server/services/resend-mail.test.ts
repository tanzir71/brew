import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp } from '../../targets/node/src/app.js';
import { openDatabase } from '../../targets/node/src/db/database.js';
import { NodeBrewStorage } from '../../targets/node/src/ports/brew-storage.js';
import { ResendMail, resendMailFromEnv } from '../../packages/core/src/resend-mail.js';
import { BrewDeliveryRunner } from '../../packages/core/src/brew-delivery.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';

let server: Server,
  endpoint: string,
  reject = false;
const requests: {
  key: string | undefined;
  body: Record<string, unknown>;
  authorization: string | undefined;
  agent: string | undefined;
}[] = [];
beforeAll(async () => {
  server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    requests.push({
      key: request.headers['idempotency-key'] as string | undefined,
      body: JSON.parse(body),
      authorization: request.headers.authorization,
      agent: request.headers['user-agent'],
    });
    response.writeHead(reject ? 429 : 200, { 'content-type': 'application/json' });
    response.end(
      reject
        ? 'sensitive upstream failure'
        : JSON.stringify({ id: `node-provider-${requests.length}` }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local mail fixture.');
  endpoint = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, error) =>
    server.close((value) => (value ? error(value) : resolve())),
  );
});
beforeEach(() => {
  requests.length = 0;
  reject = false;
});
const clock = { now: () => new Date('2026-11-27T12:00:00Z'), monotonic: () => performance.now() };

it('runs Resend through the real Node capabilities, unsaved preview, generation and durable receipt replay', async () => {
  const db = openDatabase(':memory:');
  const mail = resendMailFromEnv(
    { BREW_RESEND_API_KEY: 're_node_fixture', BREW_RESEND_FROM: 'brew@example.test' },
    async (input, init) => {
      expect(String(input)).toBe('https://api.resend.com/emails');
      return fetch(endpoint + '/emails', init);
    },
  )!;
  const app = await createApp({
    database: db,
    clock,
    publicUrl: 'https://brew.example.test',
    outboundMail: mail,
  });
  try {
    expect((await app.inject('/api/capabilities')).json().emailDelivery).toBe('resend');
    const draft = {
      name: 'Resend Node',
      enabled: true,
      timezone: 'UTC',
      schedule: { kind: 'daily' as const, time: '12:00' },
      delivery: { ...defaultDelivery(), email: { to: 'owner@example.test' } },
      sections: [{ ...newBrewSection('note', 'note'), note: 'A private **note**. [Read](/all)' }],
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/brew-configs/composition',
      payload: draft,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;
    const test = await app.inject({
      method: 'POST',
      url: `/api/brew-configs/${id}/test-email`,
      payload: { draft: { ...draft, name: 'Unsaved preview' } },
    });
    expect(test.statusCode).toBe(200);
    expect(test.json()).toMatchObject({ sent: true, messageId: 'node-provider-1' });
    expect((db.sqlite.prepare('SELECT count(*) AS n FROM brews').get() as { n: number }).n).toBe(0);
    expect(requests[0]!.key).toBeUndefined();
    expect(requests[0]!.body.subject).toBe('Test · Unsaved preview');
    expect(requests[0]!.body.html).toContain('https://brew.example.test/');
    expect(requests[0]!.body.text).toContain('A private note.');
    const generated = await app.inject({ method: 'POST', url: `/api/brew-configs/${id}/generate` });
    expect(generated.statusCode).toBe(200);
    const issueId = generated.json().id as number;
    expect((await app.inject(`/api/brews/${issueId}/delivery`)).json().results.email).toMatchObject(
      { status: 'sent', attempts: 1, messageId: 'node-provider-2' },
    );
    expect(requests[1]!.key).toMatch(/^brew\/[a-f\d]{64}$/);
    expect(requests[1]!.body.to).toEqual(['owner@example.test']);
    expect(requests[1]!.authorization).toBe('Bearer re_node_fixture');
    expect(requests[1]!.agent).toBe('Brew/0.1');
    const storage = new NodeBrewStorage(db),
      issue = storage.snapshot(issueId)!;
    if (!('version' in issue)) throw new Error('Missing composition.');
    await new BrewDeliveryRunner(storage, clock, {
      mail,
      baseUrl: 'https://brew.example.test',
    }).deliver(issue, draft.delivery);
    expect(requests).toHaveLength(2);
    reject = true;
    const failed = await app.inject({
      method: 'POST',
      url: `/api/brew-configs/${id}/test-email`,
      payload: { draft },
    });
    expect(failed.statusCode).toBe(422);
    expect(failed.body).not.toMatch(/sensitive upstream|re_node_fixture/);
    const next = await app.inject({ method: 'POST', url: `/api/brew-configs/${id}/generate` });
    expect(next.statusCode).toBe(200);
    expect(
      (await app.inject(`/api/brews/${next.json().id}/delivery`)).json().results.email,
    ).toMatchObject({ status: 'failed', attempts: 1, error: 'email' });
    expect(requests).toHaveLength(4);
  } finally {
    await app.close();
  }
});

it('requires a configured public origin before enabling Resend in Node', async () => {
  const db = openDatabase(':memory:');
  try {
    await expect(
      createApp({
        database: db,
        outboundMail: new ResendMail({ apiKey: 're_node_fixture', from: 'brew@example.test' }),
      }),
    ).rejects.toThrow('BREW_PUBLIC_URL');
  } finally {
    db.close();
  }
});
