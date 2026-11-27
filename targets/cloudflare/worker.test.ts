import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { ProductEnv } from './test/product-worker.js';
import type { Capabilities } from '../../packages/core/src/types/capabilities.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';

const now = Date.parse('2026-11-27T12:00:00Z'),
  seconds = now / 1000;
const base = 'https://brew.example.test',
  issuer = 'https://brew-test.cloudflareaccess.com';
const pair = await generateKeyPair('RS256', { extractable: true });
const other = await generateKeyPair('RS256', { extractable: true });
const jwks = {
  keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'primary', alg: 'RS256', use: 'sig' }],
};
const token = (
  claims: Record<string, unknown> = {},
  key = pair.privateKey,
  header = { alg: 'RS256', kid: 'primary' },
) =>
  new SignJWT({
    sub: 'owner',
    iss: issuer,
    aud: 'owner-audience',
    exp: seconds + 3600,
    iat: seconds - 60,
    ...claims,
  })
    .setProtectedHeader(header)
    .sign(key);
const server = createTestHarness({
  workers: [
    {
      config: {
        name: 'brew-product-test',
        main: fileURLToPath(new URL('./test/product-worker.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        compatibility_flags: ['nodejs_compat'],
        workers_dev: false,
        rules: [{ type: 'CompiledWasm', globs: ['**/*.wasm', '**/wasm'], fallthrough: true }],
        assets: {
          directory: fileURLToPath(new URL('./test/assets', import.meta.url)),
          binding: 'ASSETS',
          run_worker_first: true,
          not_found_handling: 'single-page-application',
        },
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'product-test',
            database_id: '00000000-0000-0000-0000-000000000001',
            migrations_dir: fileURLToPath(
              new URL('../../packages/db/migrations/', import.meta.url),
            ),
          },
        ],
        r2_buckets: [{ binding: 'IMAGES', bucket_name: 'product-images-test' }],
        services: [
          { binding: 'UPSTREAM', service: 'brew-product-upstream' },
          { binding: 'PUBLIC_ASSETS', service: 'brew-product-public' },
        ],
        vars: {
          BREW_PUBLIC_URL: base,
          BREW_ACCESS_TEAM_DOMAIN: issuer,
          BREW_ACCESS_AUD: 'owner-audience',
          BREW_INBOUND_ADDRESS: 'brew@letters.example.test',
          BREW_MAX_FETCHES_PER_RUN: '40',
        },
      },
    },
    {
      config: {
        name: 'brew-product-upstream',
        main: fileURLToPath(new URL('./test/product-upstream.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        workers_dev: false,
        vars: { JWKS: JSON.stringify(jwks) },
      },
    },
    {
      config: {
        name: 'brew-product-public',
        main: fileURLToPath(new URL('./test/public-worker.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        workers_dev: false,
        assets: {
          directory: fileURLToPath(new URL('./test/public-assets', import.meta.url)),
          binding: 'ASSETS',
          run_worker_first: true,
        },
      },
    },
  ],
});
const worker = server.getWorker<ProductEnv>('brew-product-test');
let env: ProductEnv, owner: string;
beforeAll(async () => {
  await server.listen();
  await worker.applyD1Migrations('DB');
  env = await worker.getEnv();
  owner = await token();
}, 30_000);
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await env.DB.batch(
    [
      'DELETE FROM feeds',
      'DELETE FROM rules',
      'DELETE FROM brew_configs',
      'DELETE FROM settings',
      'DELETE FROM inbound_addresses',
      'DELETE FROM reader_sessions',
      'DELETE FROM reader_access',
      'DELETE FROM api_tokens',
      'DELETE FROM agent_actions',
    ].map((sql) => env.DB.prepare(sql)),
  );
  await env.UPSTREAM.fetch('https://source.test/__review/reset');
});
function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  credential: string | null = owner,
) {
  const headers = new Headers(init.headers);
  if (headers.has('host')) headers.set('x-review-host', headers.get('host')!);
  if (credential) headers.set('cf-access-jwt-assertion', credential);
  return worker.fetch(`${base}${path}`, { ...init, headers: Object.fromEntries(headers) });
}
async function stats(): Promise<string[]> {
  return (await env.UPSTREAM.fetch('https://source.test/__review/stats')).json() as Promise<
    string[]
  >;
}
const mime = (id = 'native-product') =>
  `From: Publisher <publisher@example.test>\r\nSubject: Native product letter\r\nMessage-ID: <${id}@example.test>\r\nContent-Type: text/html\r\n\r\n<p>Clean product letter.</p><script>unsafe()</script>`;

it('protects real owner HTML/assets and APIs before D1 writes; cookie/email headers do not substitute for a signed assertion', async () => {
  for (const path of ['/', '/owner.css', '/api/capabilities', '/settings/apps.json', '/llms.txt']) {
    const response = await request(
      path,
      {
        headers: {
          cookie: `CF_Authorization=${owner}`,
          'cf-access-authenticated-user-email': 'owner@example.test',
        },
      },
      null,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).not.toContain('Private Brew shell');
  }
  expect(await env.DB.prepare('SELECT count(*) AS n FROM settings').first()).toEqual({ n: 0 });
  expect(await stats()).toEqual([]);
  const [html, css] = await Promise.all([request('/'), request('/owner.css')]);
  expect(html.status, await html.clone().text()).toBe(200);
  expect(await html.text()).toContain('Private Brew shell');
  expect(css.status).toBe(200);
  const page = await request('/settings/apps', {
    headers: { accept: 'text/html', 'sec-fetch-mode': 'navigate' },
  });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('Private Brew shell');
  expect((await stats()).filter((path) => path === '/cdn-cgi/access/certs')).toHaveLength(1);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM settings').first()).toEqual({ n: 0 });
});

it.each([
  ['wrong issuer', { iss: 'https://attacker.cloudflareaccess.com' }],
  ['wrong audience', { aud: 'different-application' }],
  ['expired', { exp: seconds }],
  ['not active', { nbf: seconds + 1 }],
  ['future issue time', { iat: seconds + 1 }],
  ['missing expiration', { exp: undefined }],
  ['malformed expiration', { exp: 'future' }],
])('rejects a genuinely signed Access JWT with %s', async (_name, claims) => {
  const credential = await token(claims);
  const response = await request('/api/capabilities', {}, credential);
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain(credential);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM settings').first()).toEqual({ n: 0 });
});

it('rejects wrong signatures, unknown keys, unsigned/algorithm-confused and oversized assertions', async () => {
  const claims = Buffer.from(
    JSON.stringify({ iss: issuer, aud: 'owner-audience', exp: seconds + 3600 }),
  ).toString('base64url');
  for (const value of [
    await token({}, other.privateKey),
    await token({}, pair.privateKey, { alg: 'RS256', kid: 'unknown' }),
    `${Buffer.from('{"alg":"none","kid":"primary"}').toString('base64url')}.${claims}.invalid`,
    'a'.repeat(17000),
  ]) {
    expect((await request('/api/capabilities', {}, value)).status).toBe(401);
  }
  expect((await stats()).length).toBeLessThanOrEqual(1);
});

it('serves canonical private REST/twins/HEAD and real capabilities, while unknown APIs never fall back to the SPA', async () => {
  await worker.scheduled({ scheduledTime: new Date(now) });
  const response = await request('/api/capabilities');
  expect(response.status).toBe(200);
  const capabilities = (await response.json()) as Capabilities;
  expect(capabilities).toMatchObject({
    mode: 'cloudflare',
    inboundMail: 'cloudflare-email',
    emailDelivery: null,
    readerApi: false,
    mcp: 'http',
    agentAccess: true,
    publicCopy: false,
    limits: { maxFetchesPerRun: 40 },
  });
  const twin = await request('/settings/apps.json');
  expect(twin.status).toBe(200);
  expect(await twin.text()).not.toContain('Private Brew shell');
  const head = await request('/settings/apps.json', { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  expect(head.headers.get('cache-control')).toBe('private, no-store');
  expect(head.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  const missing = await request('/api/unknown');
  expect(missing.status).toBe(404);
  expect(await missing.text()).not.toContain('Private Brew shell');
  expect(
    (
      await worker.fetch('https://attacker.test/api/capabilities', {
        headers: { 'cf-access-jwt-assertion': owner },
      })
    ).status,
  ).toBe(421);
  expect((await request('/api/capabilities', { headers: { host: 'attacker.test' } })).status).toBe(
    421,
  );
});

it('requires same-origin owner changes and keeps shared scoped-token isolation behind Access', async () => {
  const origins: Array<Record<string, string>> = [
    {},
    { origin: 'https://attacker.test' },
    { origin: base, 'sec-fetch-site': 'cross-site' },
  ];
  for (const headers of origins) {
    expect(
      (
        await request('/api/reader-access', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: '{"username":"owner"}',
        })
      ).status,
    ).toBe(403);
  }
  expect(await env.DB.prepare('SELECT count(*) AS n FROM reader_access').first()).toEqual({ n: 0 });
  expect(
    (await request('/api/capabilities', { headers: { authorization: 'Bearer brew_r_private' } }))
      .status,
  ).toBe(403);
});

it('keeps authenticated saved metadata and HEAD reads pure on a database that has not bootstrapped background state', async () => {
  await request('/');
  const queries = ['settings', 'inbound_addresses', 'feeds', 'articles', 'agent_actions'].map(
    (table) => env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`),
  );
  const before = (await env.DB.batch(queries)).map((result) => result.results);
  const network = await stats();
  for (const path of [
    '/settings/apps.json',
    '/settings/agents.json',
    '/feeds.json',
    '/api/capabilities',
  ]) {
    const read = await request(path);
    expect(read.status).toBe(200);
    expect(await read.text()).not.toContain(owner);
    const head = await request(path, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  }
  expect((await env.DB.batch(queries)).map((result) => result.results)).toEqual(before);
  expect(await stats()).toEqual(network);
});

it('keeps Reader and MCP on their real credentials without accepting Access as their app password', async () => {
  const configured = await request('/api/reader-access', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: '{"username":"owner"}',
  });
  expect(configured.status).toBe(200);
  const credentials = (await configured.json()) as { username: string; password: string };
  const login = await request(
    '/api/greader/accounts/ClientLogin',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        Email: credentials.username,
        Passwd: credentials.password,
      }).toString(),
    },
    null,
  );
  expect(login.status).toBe(200);
  const auth = (await login.text()).match(/^Auth=(.+)$/m)![1]!;
  const subscriptions = await request(
    '/api/greader/reader/api/0/subscription/list?output=json',
    { headers: { authorization: `GoogleLogin auth=${auth}` } },
    null,
  );
  expect(subscriptions.status).toBe(200);
  expect((await request('/api/greader/reader/api/0/subscription/list?output=json')).status).toBe(
    401,
  );
  const mcp = await request(
    '/mcp',
    {
      method: 'POST',
      headers: { authorization: 'Bearer brew_r_missing', 'content-type': 'application/json' },
      body: '{}',
    },
    null,
  );
  expect([401, 403]).toContain(mcp.status);
  expect(await mcp.text()).not.toContain('Cloudflare Access');
  expect((await request('/api/capabilities')).status).toBe(200);
}, 15_000);

it('keeps independent published static artifacts public and read-only without forwarding owner credentials or queries', async () => {
  const response = await request('/share/issue.json?private=secret', {
    headers: { authorization: 'Bearer private', cookie: 'private=secret' },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ title: 'Published static Brew', items: [] });
  expect(response.headers.get('cache-control')).toBe('public, max-age=60');
  expect((await request('/share/issue.json', {}, null)).status).toBe(200);
  expect((await request('/share/issue.json', { method: 'POST' }, null)).status).toBe(405);
  expect((await request('/share/missing.json', {}, null)).status).toBe(404);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM settings').first()).toEqual({ n: 0 });
});

it('uses the actual R2 image cache through the authenticated product API', async () => {
  const path = '/api/img?src=' + encodeURIComponent('https://source.test/image.png');
  for (let index = 0; index < 2; index++) {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  }
  expect((await stats()).filter((path) => path === '/image.png')).toHaveLength(1);
  expect((await env.IMAGES.list()).objects.length).toBeGreaterThan(0);
});

it('polls 200 feeds via the real product scheduled handler with the shared external allowance', async () => {
  await env.DB.batch(
    Array.from({ length: 200 }, (_, index) =>
      env.DB.prepare("INSERT INTO feeds(url,title) VALUES(?,'Pending')").bind(
        `https://source.test/feed/${index}`,
      ),
    ),
  );
  for (let index = 0; index < 5; index++) {
    await env.UPSTREAM.fetch('https://source.test/__review/reset');
    await worker.scheduled({ cron: '* * * * *', scheduledTime: new Date(now + index * 60_000) });
    expect(await stats()).toHaveLength(40);
  }
  expect(await env.DB.prepare('SELECT count(*) AS n FROM articles').first()).toEqual({ n: 200 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM feed_poll_leases').first()).toEqual({
    n: 0,
  });
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM feeds WHERE last_status=200').first(),
  ).toEqual({ n: 200 });
}, 30_000);

it('receives a real Email Routing envelope, deduplicates it and serves the cleaned letter in Newsletters', async () => {
  await worker.email({
    from: 'bounce@sender.example.test',
    to: 'brew@letters.example.test',
    raw: mime(),
  });
  await worker.email({
    from: 'bounce@sender.example.test',
    to: 'brew@letters.example.test',
    raw: mime(),
  });
  const row = await env.DB.prepare('SELECT id,feed_id,content_html FROM articles').first<{
    id: number;
    feed_id: number;
    content_html: string;
  }>();
  expect(row!.content_html).toBe('<p>Clean product letter.</p>');
  expect(await env.DB.prepare('SELECT count(*) AS n FROM articles').first()).toEqual({ n: 1 });
  const letter = await request(`/api/newsletters/letters/${row!.id}`);
  expect(letter.status).toBe(200);
  expect(await letter.text()).toContain('Clean product letter.');
  const twin = await request(`/letters/${row!.feed_id}/${row!.id}.json`);
  expect(twin.status).toBe(200);
});

it('ingests 120 articles in five native D1 calls with inactive policy, then runs a bulk feed through the actual product scheduler', async () => {
  await env.DB.prepare(
    "INSERT INTO feeds(id,url,title) VALUES(1,'https://source.test/quiet','Batch fixture')",
  ).run();
  const response = await worker.fetch(`${base}/__review/ingest-batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      Array.from({ length: 120 }, (_, id) => ({
        guid: `new-${id}`,
        url: `https://one.test/new/${id}`,
        title: `New story ${id}`,
        author: null,
        summaryHtml: null,
        contentHtml: '<p>Clean story.</p><script>unsafe()</script>',
        publishedAt: new Date(now).toISOString(),
      })),
    ),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    inserted: 120,
    calls: { first: 0, all: 2, run: 0, batch: 3 },
  });
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS count FROM articles WHERE feed_id=1 AND content_html='<p>Clean story.</p>' AND hidden=0",
    ).first(),
  ).toEqual({ count: 120 });
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO feeds(id,url,title) VALUES(2,'https://source.test/bulk','Bulk feed')",
    ),
    env.DB.prepare(`INSERT INTO rules(name,match_type,scope_json,conditions_json,actions_json)
      VALUES('Nonmatching batch rule','all','{}','[{"field":"title","operator":"contains","value":"no match here"}]','[{"type":"star"}]')`),
  ]);
  await worker.scheduled({ scheduledTime: new Date(now) });
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS count FROM articles WHERE feed_id=2 AND content_html='<p>Keep this.</p>' AND hidden=0",
    ).first(),
  ).toEqual({ count: 120 });
  expect(await env.DB.prepare('SELECT count(*) AS count FROM rule_logs').first()).toEqual({
    count: 0,
  });
  expect((await stats()).sort()).toEqual(['/bulk', '/quiet']);
});

it('commits a matching rule with many tag actions in two native D1 write calls', async () => {
  const actions = [
    ...Array.from({ length: 24 }, (_, id) => ({ type: 'add_tag', tag: `Native ${id}` })),
    { type: 'remove_tag', tag: 'Native 0' },
    { type: 'star' },
    { type: 'mark_read' },
  ];
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO feeds(id,url,title) VALUES(1,'https://source.test/quiet','Batch fixture')",
    ),
    env.DB.prepare(
      `INSERT INTO rules(name,match_type,scope_json,conditions_json,actions_json)
      VALUES('Native local rule','all','{}','[]',?)`,
    ).bind(JSON.stringify(actions)),
  ]);
  const response = await worker.fetch(`${base}/__review/ingest-batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([
      {
        guid: 'native-effects',
        url: 'https://one.test/native-effects',
        title: 'Native effects',
        author: null,
        summaryHtml: null,
        contentHtml: '<p>Native rule.</p>',
        publishedAt: new Date(now).toISOString(),
      },
    ]),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    inserted: 1,
    calls: { first: 0, all: 3, run: 0, batch: 5 },
  });
  expect(await env.DB.prepare('SELECT starred_at,read_at FROM articles').first()).toEqual({
    starred_at: now,
    read_at: now,
  });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM article_tags').first()).toEqual({ n: 23 });
  const result = await env.DB.prepare('SELECT actions_taken_json FROM rule_logs').first<{
    actions_taken_json: string;
  }>();
  expect(JSON.parse(result!.actions_taken_json)).toEqual(
    actions.map(({ type }) => ({ type, ok: true })),
  );
});

it('continues bounded newsletter retention across real scheduled invocations while still polling RSS', async () => {
  await env.DB.batch([
    env.DB.prepare(`WITH RECURSIVE numbers(id) AS
      (SELECT 1 UNION ALL SELECT id+1 FROM numbers WHERE id<501)
      INSERT INTO feeds(id,url,title,kind,retention_days)
      SELECT id,'mailto:sender'||id||'@example.test','Sender','newsletter',7 FROM numbers`),
    env.DB.prepare(`INSERT INTO articles(id,feed_id,guid,title,url,published_at,raw_html,hash)
      SELECT id,id,'letter-'||id,'Expired letter','/a/'||id,0,'Original','letter-hash-'||id FROM feeds`),
    env.DB.prepare(
      "INSERT INTO feeds(id,url,title) VALUES(502,'https://source.test/feed/502','Pending')",
    ),
  ]);
  await worker.scheduled({ cron: '* * * * *', scheduledTime: new Date(now) });
  expect(
    await env.DB.prepare(
      'SELECT count(*) AS count FROM articles WHERE raw_html IS NOT NULL',
    ).first(),
  ).toEqual({ count: 1 });
  expect(
    await env.DB.prepare('SELECT count(*) AS count FROM articles WHERE feed_id=502').first(),
  ).toEqual({ count: 1 });
  expect(await stats()).toHaveLength(1);
  await worker.scheduled({ cron: '* * * * *', scheduledTime: new Date(now + 60_000) });
  expect(
    await env.DB.prepare(
      'SELECT count(*) AS count FROM articles WHERE raw_html IS NOT NULL',
    ).first(),
  ).toEqual({ count: 0 });
  expect(
    await env.DB.prepare('SELECT count(*) AS count FROM articles WHERE feed_id=502').first(),
  ).toEqual({ count: 1 });
  expect(
    await env.DB.prepare(
      "SELECT key FROM settings WHERE key='maintenance:newsletter-retention:page'",
    ).first(),
  ).toBeNull();
});

it('continues a long rule across product cron invocations without fetching again or replaying its external effects', async () => {
  const actions = [
    ...Array.from({ length: 24 }, (_, id) => ({ type: 'add_tag', tag: `Durable ${id}` })),
    { type: 'webhook', url: 'https://source.test/webhook' },
    { type: 'star' },
    { type: 'notify' },
  ];
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO feeds(id,url,title) VALUES(1,'https://source.test/durable','Durable feed')",
    ),
    env.DB.prepare(
      "INSERT INTO rules(name,match_type,scope_json,conditions_json,actions_json) VALUES('Durable rule','all','{}','[]',?)",
    ).bind(JSON.stringify(actions)),
  ]);
  await worker.scheduled({ scheduledTime: new Date(now) });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM ingest_jobs').first()).toEqual({ n: 1 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM article_tags').first()).toEqual({ n: 13 });
  expect(await env.DB.prepare('SELECT starred_at FROM articles').first()).toEqual({
    starred_at: null,
  });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM rule_logs').first()).toEqual({ n: 0 });
  for (let invocation = 0; invocation < 3; invocation++)
    await worker.scheduled({ scheduledTime: new Date(now) });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM ingest_jobs').first()).toEqual({ n: 0 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM article_tags').first()).toEqual({ n: 24 });
  expect(await env.DB.prepare('SELECT starred_at FROM articles').first()).toEqual({
    starred_at: now,
  });
  const logs = await env.DB.prepare('SELECT actions_taken_json FROM rule_logs').all<{
    actions_taken_json: string;
  }>();
  expect(logs.results).toHaveLength(1);
  expect(JSON.parse(logs.results[0]!.actions_taken_json)).toEqual(
    actions.map(({ type }) => ({ type, ok: true })),
  );
  expect(
    await env.DB.prepare(
      "SELECT count(*) AS n FROM instance_events WHERE type='notification'",
    ).first(),
  ).toEqual({ n: 1 });
  expect(await stats()).toEqual(['/durable', '/webhook']);
});

it('accepts a queued Email Routing letter and completes its long rule on a later cron without redelivery', async () => {
  const actions = [
    ...Array.from({ length: 24 }, (_, id) => ({ type: 'add_tag', tag: `Mail ${id}` })),
    { type: 'star' },
  ];
  await env.DB.prepare(
    "INSERT INTO rules(name,match_type,scope_json,conditions_json,actions_json) VALUES('Queued mail','all','{}','[]',?)",
  )
    .bind(JSON.stringify(actions))
    .run();
  await worker.email({
    from: 'bounce@sender.example.test',
    to: 'brew@letters.example.test',
    raw: mime(),
  });
  const continued = await worker.fetch(`${base}/__review/resume-mail`);
  expect(continued.status).toBe(200);
  expect(await continued.json()).toMatchObject({
    before: { jobs: 1, starred: 0, timestamps: [{ starred_at: null }] },
    after: { jobs: 0, articles: 1, starred: 1, logs: 1, timestamps: [{ starred_at: now }] },
  });
});

it.each([1, 30])(
  'restores %i pending articles through the real owner deletion and Undo API, then resumes cron processing',
  async (count) => {
    const response = await request('/__review/queued-undo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ count }),
    });
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      inserted: number;
      removed: number;
      restored: number;
      deleted: { jobs: number };
      recovered: { members: number; lease: { runner: string | null; expires_at: number } };
      after: { starred: number; logs: number };
    };
    expect(report).toMatchObject({
      inserted: 200,
      removed: 200,
      restored: 200,
      deleted: { jobs: 0 },
      recovered: { members: count, lease: { runner: null, expires_at: 0 } },
    });
    expect(report.after.starred).toBeGreaterThan(0);
    expect(report.after.logs).toBe(report.after.starred);
  },
);

it('freezes and delivers a scheduled composition before polling, and never sends its claimed minute twice', async () => {
  await env.DB.prepare(
    `WITH RECURSIVE numbers(id) AS
    (SELECT 1 UNION ALL SELECT id+1 FROM numbers WHERE id<100)
    INSERT INTO brew_configs(name,composition_version,schedule_json)
    SELECT 'Later '||id,2,'{"kind":"daily","time":"23:00"}' FROM numbers`,
  ).run();
  await env.DB.prepare(
    "INSERT INTO feeds(id,url,title,last_fetched_at) VALUES(1,'https://source.test/existing','Existing',?)",
  )
    .bind(now)
    .run();
  await env.DB.prepare(
    "INSERT INTO articles(feed_id,guid,hash,url,title,content_html,published_at) VALUES(1,'story','story','https://source.test/story','Scheduled story','<p>Existing story.</p>',?)",
  )
    .bind(now - 60_000)
    .run();
  const created = await request('/api/brew-configs/composition', {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Scheduled product',
      enabled: true,
      timezone: 'UTC',
      schedule: { kind: 'daily', time: '12:00' },
      delivery: { ...defaultDelivery(), webhook: { url: 'https://source.test/webhook' } },
      sections: [
        { ...newBrewSection('stories'), sources: [{ kind: 'feed', id: 1 }], onlyUnread: false },
      ],
    }),
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const config = (await created.json()) as { id: number };
  await env.DB.prepare(
    "INSERT INTO feeds(url,title) VALUES('https://source.test/fresh','Due source')",
  ).run();
  await env.UPSTREAM.fetch('https://source.test/__review/reset');
  await worker.scheduled({ cron: '* * * * *', scheduledTime: new Date(now) });
  expect(await stats()).toEqual(['/webhook', '/fresh']);
  const frozen = await env.DB.prepare('SELECT id FROM brews WHERE brew_config_id=?')
    .bind(config.id)
    .first<{ id: number }>();
  const issue = await request(`/api/brews/${frozen!.id}`);
  expect(issue.status).toBe(200);
  expect(await issue.text()).toContain('Scheduled story');
  const delivered = await request(`/api/brews/${frozen!.id}/delivery`);
  expect(delivered.status).toBe(200);
  expect(await delivered.json()).toMatchObject({ results: { webhook: { status: 'sent' } } });
  await worker.scheduled({ cron: '* * * * *', scheduledTime: new Date(now) });
  expect(await stats()).toEqual(['/webhook', '/fresh']);
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM brews WHERE brew_config_id=?')
      .bind(config.id)
      .first(),
  ).toEqual({ n: 1 });
});

it('restricts bounded Brew history maintenance to cron and continues across genuine scheduled invocations', async () => {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO brew_configs(id,name,enabled,composition_version) VALUES(1,'Paused archive',0,2)",
    ),
    env.DB.prepare(`WITH RECURSIVE numbers(id) AS
      (SELECT 1 UNION ALL SELECT id+1 FROM numbers WHERE id<501)
      INSERT INTO brews(brew_config_id,issue_number,generated_at,payload_json)
      SELECT 1,id,0,'{"configName":"Old","sections":[]}' FROM numbers`),
  ]);
  expect((await request('/api/brew-configs')).status).toBe(200);
  await worker.email({
    from: 'bounce@example.test',
    to: 'brew@letters.example.test',
    raw: mime('history-scope'),
  });
  expect(await env.DB.prepare('SELECT count(*) AS count FROM brews').first()).toEqual({
    count: 501,
  });
  await worker.scheduled({ scheduledTime: new Date(now) });
  expect(await env.DB.prepare('SELECT count(*) AS count FROM brews').first()).toEqual({ count: 1 });
  await worker.scheduled({ scheduledTime: new Date(now + 60_000) });
  expect(await env.DB.prepare('SELECT count(*) AS count FROM brews').first()).toEqual({ count: 0 });
  expect(
    await env.DB.prepare("SELECT value FROM settings WHERE key='brew_issue_number_1'").first(),
  ).toEqual({ value: '501' });
});

it('rejects ambiguous newsletter senders without creating a sender or storing letter content', async () => {
  await worker.email({
    from: 'bounce@example.test',
    to: 'brew@letters.example.test',
    raw: 'From: First <one@example.test>, Second <two@example.test>\r\nSender: one@example.test\r\nMessage-ID: <ambiguous@example.test>\r\nSubject: Ambiguous sender\r\n\r\nDo not admit this newsletter.',
  });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM feeds').first()).toEqual({ n: 0 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM articles').first()).toEqual({ n: 0 });
});

it('rejects wrong recipients and revoked addresses without reactivating old environment configuration', async () => {
  await worker.scheduled({ scheduledTime: new Date(now) });
  await request('/api/capabilities');
  await worker.email({
    from: 'bounce@example.test',
    to: 'other@letters.example.test',
    raw: mime('other'),
  });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM feeds').first()).toEqual({ n: 0 });
  await env.DB.prepare('UPDATE inbound_addresses SET active=0').run();
  await worker.email({
    from: 'bounce@example.test',
    to: 'brew@letters.example.test',
    raw: mime('revoked'),
  });
  expect(await env.DB.prepare('SELECT active FROM inbound_addresses').first()).toEqual({
    active: 0,
  });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM articles').first()).toEqual({ n: 0 });
  expect(
    ((await (await request('/api/capabilities')).json()) as Capabilities).inboundMail,
  ).toBeNull();
});

it.each(['read', 'hash'])(
  'rejects address revocation during MIME %s before admitting article content',
  async (phase) => {
    await worker.scheduled({ scheduledTime: new Date(now) });
    await request('/api/capabilities');
    const response = await worker.fetch(`${base}/__review/revoke-during-${phase}`, {
      method: 'POST',
      body: mime(`race-${phase}`),
    });
    expect(await response.json()).toEqual({ rejected: 'This receiving address is not active.' });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM articles').first()).toEqual({ n: 0 });
  },
);

it('exposes only generic health without owner admission and cannot turn it into a write', async () => {
  expect(await (await request('/api/health', {}, null)).json()).toEqual({ ok: true });
  expect((await request('/api/health', { method: 'POST' }, null)).status).toBe(405);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM settings').first()).toEqual({ n: 0 });
});
