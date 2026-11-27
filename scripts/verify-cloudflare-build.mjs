import { CloudflareActionJournal } from '../dist/targets/cloudflare/src/action-journal.js';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { URL } from 'node:url';
import { Miniflare } from 'miniflare';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import quickJsVariant from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import { CloudflareRegex, regexWasmMemory } from '../dist/targets/cloudflare/src/regex.js';
import { unstable_splitSqlQuery } from 'wrangler';
import { CloudflareStorage } from '../dist/targets/cloudflare/src/storage.js';
import { CloudflareNewsletterStorage } from '../dist/targets/cloudflare/src/newsletter-storage.js';
import { maintainCloudflareNewsletters } from '../dist/targets/cloudflare/src/newsletter-maintenance.js';
import { R2ImageCache } from '../dist/targets/cloudflare/src/image-cache.js';
import { NewsletterPipeline } from '../dist/packages/core/src/newsletter-pipeline.js';
import { proxyImage } from '../dist/packages/api/src/image-proxy.js';
import {
  cloudflareLibraryServices,
  createCloudflareLibraryApi,
} from '../dist/targets/cloudflare/src/library-api.js';
import { cloudflareIngestion } from '../dist/targets/cloudflare/src/ingestion.js';
import {
  cloudflarePollingServices,
  createCloudflarePollingApi,
} from '../dist/targets/cloudflare/src/polling-api.js';
import { CloudflareFetchBudget } from '../dist/targets/cloudflare/src/fetch-budget.js';
import {
  CloudflareAccessVerifier,
  accessConfiguration,
} from '../dist/targets/cloudflare/src/access.js';
import {
  initializeInboundAddress,
  receiveCloudflareMail,
} from '../dist/targets/cloudflare/src/inbound-mail.js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { newBrewSection } from '../dist/packages/core/src/composition-model.js';
import { renderBrewMarkdown } from '../dist/packages/core/src/brew-outputs.js';

const originalDirectory = process.cwd();
process.chdir(tmpdir());
const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("compiled port verification"); } };',
  compatibilityDate: '2026-07-01',
  d1Databases: ['DB'],
  r2Buckets: ['IMAGES'],
});
try {
  const engine = await newQuickJSWASMModuleFromVariant(
    newVariant(quickJsVariant, {
      wasmMemory: regexWasmMemory(),
    }),
  );
  const regex = new CloudflareRegex(
    async () => engine,
    () => 0,
  );
  assert.deepEqual(await regex.test('(?<=Brew )(?<word>read)\\k<word>', 'Brew READread'), {
    matched: true,
    timedOut: false,
  });
  assert.deepEqual(await regex.test('^(a+)+$', 'a'.repeat(100000) + '!', 20), {
    matched: false,
    timedOut: true,
    error: 'Regular expression timed out.',
  });
  assert.deepEqual(await regex.test('ready', 'READY'), { matched: true, timedOut: false });
  const database = await runtime.getD1Database('DB');
  const directory = new URL('../dist/packages/db/migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(file, directory), 'utf8');
    await database.batch(unstable_splitSqlQuery(sql).map((query) => database.prepare(query)));
  }
  const storage = new CloudflareStorage(database);
  const pipeline = new NewsletterPipeline(
    new CloudflareNewsletterStorage(storage),
    { sha1: (value) => createHash('sha1').update(value).digest('hex') },
    { now: () => new Date(), monotonic: () => globalThis.performance.now() },
  );
  const result = await pipeline.ingest(
    'From: Publisher <publisher@example.test>\r\nSubject: Compiled D1 letter\r\nMessage-ID: <compiled-d1@example.test>\r\nContent-Type: text/html\r\n\r\n<p>Compiled migration proof.</p><script>unsafe()</script>',
  );
  assert.equal(result.outcome, 'inserted');
  assert.equal(
    (await storage.first('SELECT content_html FROM articles WHERE id=?', [result.articleId]))
      .content_html,
    '<p>Compiled migration proof.</p>',
  );
  const cache = new R2ImageCache(await runtime.getR2Bucket('IMAGES'));
  const url = new URL('https://images.example.test/compiled.png');
  let requests = 0;
  const fetcher = async () => {
    requests++;
    return new globalThis.Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { 'content-type': 'image/png' },
    });
  };
  await (await proxyImage(url, fetcher, cache)).arrayBuffer();
  assert.deepEqual(
    new Uint8Array(await (await proxyImage(url, fetcher, cache)).arrayBuffer()),
    new Uint8Array([137, 80, 78, 71]),
  );
  assert.equal(requests, 1);
  const services = cloudflareLibraryServices(
    { DB: database, IMAGES: await runtime.getR2Bucket('IMAGES') },
    {
      regex,
      capabilities: () => ({
        mode: 'cloudflare',
        fetch: 'direct',
        backgroundFetch: { kind: 'cron' },
        inboundMail: null,
        emailDelivery: null,
        readerApi: false,
        mcp: 'http',
        agentAccess: true,
        webmcp: false,
        ai: { available: [], configured: false },
        readState: 'server',
        publicCopy: false,
        outputs: { twins: true, feed: false, webhook: false },
      }),
    },
  );
  const reader = createCloudflareLibraryApi(services);
  const page = await reader.request('https://build.example.test/api/articles?includeTotal=true');
  assert.equal(page.status, 200);
  assert.equal((await page.json()).total, 1);
  const marked = await reader.request(
    `https://build.example.test/api/articles/${result.articleId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ read: true }),
    },
  );
  assert.equal(marked.status, 200);
  assert.ok((await marked.json()).readAt);
  assert.equal(
    (await reader.request(`https://build.example.test/a/${result.articleId}.md`)).status,
    200,
  );
  const saved = await reader.request('https://build.example.test/api/brew-configs/composition', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Compiled issue',
      enabled: false,
      timezone: 'UTC',
      schedule: { kind: 'daily', time: '07:00' },
      delivery: { web: true, feed: false, publicCopy: false },
      sections: [
        { ...newBrewSection('letters'), sources: [{ kind: 'newsletters' }], onlyUnread: false },
      ],
    }),
  });
  assert.equal(saved.status, 201);
  const config = await saved.json();
  const generated = await reader.request(
    `https://build.example.test/api/brew-configs/${config.id}/generate`,
    { method: 'POST' },
  );
  assert.equal(generated.status, 200);
  const issue = await generated.json();
  assert.equal(issue.issueNumber, 1);
  assert.equal(issue.sections[0].items[0].id, result.articleId);
  assert.equal(
    (await storage.first('SELECT rendered_md FROM brews WHERE id=?', [issue.id])).rendered_md,
    renderBrewMarkdown(issue),
  );
  assert.equal(
    (await reader.request(`https://build.example.test/b/${config.id}/${issue.id}.json`)).status,
    200,
  );
  const source = await reader.request('https://build.example.test/api/sources/searches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: 'compiled', name: 'Compiled sources', query: 'compiled' }),
  });
  assert.equal(source.status, 200);
  const rule = await reader.request('https://build.example.test/api/rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Compiled triage',
      enabled: true,
      scope: {},
      matchType: 'all',
      conditions: [{ field: 'title', operator: 'matches_regex', value: '^Compiled(?= )' }],
      actions: [{ type: 'star' }],
      stopProcessing: false,
    }),
  });
  assert.equal(rule.status, 201);
  const imported = await cloudflareIngestion(
    database,
    { now: () => new Date(), monotonic: () => globalThis.performance.now() },
    services.rules,
  ).newsletters.ingest(
    'From: Publisher <publisher@example.test>\r\nSubject: Compiled async letter\r\nContent-Type: text/html\r\n\r\n<p>Native Web Crypto identity and shared rule execution.</p>',
  );
  assert.equal(imported.outcome, 'inserted');
  assert.ok(
    (await storage.first('SELECT starred_at FROM articles WHERE id=?', [imported.articleId]))
      .starred_at,
  );
  assert.equal(
    (
      await storage.first('SELECT count(*) AS n FROM rule_logs WHERE article_id=?', [
        imported.articleId,
      ])
    ).n,
    1,
  );
  const overview = await reader.request('https://build.example.test/api/newsletters/overview');
  assert.equal(overview.status, 200);
  assert.equal((await overview.json()).senders[0].letterCount, 2);
  const letter = await reader.request(
    `https://build.example.test/api/newsletters/letters/${imported.articleId}`,
  );
  assert.equal(letter.status, 200);
  assert.equal((await letter.json()).sender.id, imported.feedId);
  const review = await reader.request(
    `https://build.example.test/api/newsletters/senders/${imported.feedId}/preview`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    },
  );
  assert.equal(review.status, 200);
  assert.match((await review.json()).revision, /^[a-f0-9]{64}$/);
  const preferences = await reader.request(
    `https://build.example.test/api/newsletters/senders/${imported.feedId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ favorite: true }),
    },
  );
  assert.equal(preferences.status, 200);
  assert.equal((await preferences.json()).settings.favorite, true);
  const twin = await reader.request(
    `https://build.example.test/letters/${imported.feedId}/${imported.articleId}.json`,
  );
  assert.equal(twin.status, 200);
  assert.equal(twin.headers.get('cache-control'), 'private, no-store');
  const opmlXml =
    '<opml><body><outline text="Compiled subscriptions"><outline text="Compiled RSS" xmlUrl="https://compiled.example.test/rss"/></outline></body></opml>';
  const opmlReview = await reader.request('https://build.example.test/api/opml/preview', {
    method: 'POST',
    headers: { 'content-type': 'text/xml' },
    body: opmlXml,
  });
  assert.equal(opmlReview.status, 200);
  assert.equal((await opmlReview.json()).imported, 1);
  const subscriptions = await reader.request('https://build.example.test/api/opml/import', {
    method: 'POST',
    headers: { 'content-type': 'text/xml' },
    body: opmlXml,
  });
  assert.equal(subscriptions.status, 200);
  assert.deepEqual(await subscriptions.json(), { imported: 1, skipped: 0, foldersCreated: 1 });
  assert.match(
    await (await reader.request('https://build.example.test/api/opml/export')).text(),
    /Compiled RSS/,
  );
  assert.deepEqual(await services.readerSync.access.status(), { enabled: false, username: null });
  assert.equal(
    await services.readerSync.storage.change(
      { ids: [imported.articleId] },
      { starred: false, add: ['Compiled sync'] },
    ),
    1,
  );
  const synchronized = await services.readerSync.storage.items({ ids: [imported.articleId] });
  assert.equal(synchronized.items[0].starred, false);
  assert.deepEqual(synchronized.items[0].tags, ['Compiled sync']);
  assert.equal(
    (await storage.first("SELECT count(*) AS n FROM settings WHERE key LIKE 'reader_change:%'")).n,
    0,
  );
  const journal = new CloudflareActionJournal(storage);
  const journalKey = 'compiled-journal-proof';
  const priorRead = (
    await storage.first('SELECT read_at FROM articles WHERE id=?', [imported.articleId])
  ).read_at;
  await journal.transaction({
    actionId: { sql: '(SELECT id FROM agent_actions WHERE request_id=?)', values: [journalKey] },
    at: Date.now(),
    before: [
      {
        sql: 'INSERT INTO agent_actions(agent,request_id,tool,args_json,result_json,undo_json,created_at) VALUES(?,?,?,?,?,?,?)',
        values: [
          'web',
          journalKey,
          'mark_read',
          '{}',
          JSON.stringify({
            kind: 'mark_read',
            targetId: imported.articleId,
            summary: 'Compiled journal.',
            status: 'complete',
            externalEffects: false,
          }),
          JSON.stringify({ version: 1, expiresAt: Date.now() + 30000 }),
          Date.now(),
        ],
      },
    ],
    queries: [
      { sql: 'UPDATE articles SET read_at=? WHERE id=?', values: [123456, imported.articleId] },
    ],
  });
  const journalId = (
    await storage.first('SELECT id FROM agent_actions WHERE request_id=?', [journalKey])
  ).id;
  assert.equal(
    (
      await storage.first('SELECT count(*) AS n FROM agent_action_changes WHERE action_id=?', [
        journalId,
      ])
    ).n,
    1,
  );
  await storage.run('UPDATE articles SET author=? WHERE id=?', [
    'Later unrelated author',
    imported.articleId,
  ]);
  await journal.restore(journalId, Date.now(), {
    after: [
      {
        sql: 'UPDATE agent_actions SET undone_at=?,undo_json=NULL WHERE id=?',
        values: [Date.now(), journalId],
      },
      { sql: 'DELETE FROM agent_action_changes WHERE action_id=?', values: [journalId] },
    ],
  });
  const restored = await storage.first('SELECT read_at,author FROM articles WHERE id=?', [
    imported.articleId,
  ]);
  assert.equal(restored.read_at, priorRead);
  assert.equal(restored.author, 'Later unrelated author');
  assert.equal(
    await storage.first("SELECT value FROM settings WHERE key='brew_active_action'"),
    null,
  );
  const actionTarget = { kind: 'items', ids: [imported.articleId] };
  const actionReview = await reader.request(
    'https://build.example.test/api/actions/mark-read/preview',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(actionTarget),
    },
  );
  assert.equal(actionReview.status, 200);
  const actionInput = {
    kind: 'mark_read',
    target: actionTarget,
    revision: (await actionReview.json()).revision,
    confirm: true,
    requestId: 'compiled_action_123456',
  };
  const actionRequest = () =>
    reader.request('https://build.example.test/api/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(actionInput),
    });
  const actionResponse = await actionRequest();
  assert.equal(actionResponse.status, 200);
  const actionReceipt = await actionResponse.json();
  assert.equal(actionReceipt.updated, 1);
  assert.equal(actionReceipt.canUndo, true);
  assert.deepEqual(await (await actionRequest()).json(), actionReceipt);
  const actionUndo = await reader.request(
    `https://build.example.test/api/actions/${actionReceipt.id}/undo`,
    { method: 'POST' },
  );
  assert.equal(actionUndo.status, 200);
  assert.equal((await actionUndo.json()).status, 'undone');
  assert.equal((await (await actionRequest()).json()).status, 'undone');
  const recentActions = await reader.request('https://build.example.test/api/actions');
  assert.equal(recentActions.headers.get('cache-control'), 'private, no-store');
  assert.equal((await recentActions.json())[0].id, actionReceipt.id);
  const issued = await reader.request('http://localhost/api/agent-access/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ name: 'Compiled MCP', scopes: 'write' }),
  });
  assert.equal(issued.status, 201);
  const credential = await issued.json();
  assert.match(credential.token, /^brew_rw_[\w-]{43}$/);
  const client = new Client({ name: 'compiled-verifier', version: '1' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
        requestInit: { headers: { authorization: `Bearer ${credential.token}` } },
        fetch: (input, init) => reader.fetch(new globalThis.Request(input, init)),
      }),
    );
    assert.equal((await client.listTools()).tools.length, 12);
    const starred = await client.callTool({
      name: 'star',
      arguments: {
        id: imported.articleId,
        confirm: true,
        request_id: 'compiled_agent_star_001',
      },
    });
    assert.equal(starred.isError, undefined);
    assert.equal(starred.structuredContent.receipt.canUndo, true);
    const undone = await client.callTool({
      name: 'undo',
      arguments: {
        undo_id: starred.structuredContent.undo_id,
        confirm: true,
      },
    });
    assert.equal(undone.structuredContent.receipt.status, 'undone');
    const activity = await reader.request('http://localhost/api/agent-access/actions');
    assert.equal(activity.headers.get('cache-control'), 'private, no-store');
    const audit = await activity.text();
    assert.ok(audit.includes('Compiled MCP'));
    assert.ok(!audit.includes(credential.token));
    assert.ok(!audit.includes('args_json'));
    const revoked = await reader.request(
      `http://localhost/api/agent-access/tokens/${credential.entry.id}`,
      {
        method: 'DELETE',
        headers: { origin: 'http://localhost' },
      },
    );
    assert.equal(revoked.status, 200);
    await assert.rejects(client.listTools(), /Use a valid Brew token/);
  } finally {
    await client.close();
  }
  const pollSource = await storage.first(
    "INSERT INTO feeds(url,title) VALUES('https://compiled.example.test/poll','Pending poll') RETURNING id",
  );
  let pollCalls = 0;
  const pollBudget = new CloudflareFetchBudget(2, async () => {
    pollCalls++;
    if (pollCalls === 1)
      return new globalThis.Response('redirect', {
        status: 302,
        headers: { location: '/resolved' },
      });
    return globalThis.Response.json(
      {
        version: 'https://jsonfeed.org/version/1.1',
        title: 'Compiled polling',
        items: [
          {
            id: 'compiled-poll',
            url: 'https://compiled.example.test/article',
            title: 'Compiled poll article',
            content_html: '<p>Compiled polling content.</p><script>unsafe()</script>',
            date_published: new Date().toISOString(),
          },
        ],
      },
      { headers: { etag: '"compiled-poll"' } },
    );
  });
  const polling = createCloudflarePollingApi(
    cloudflarePollingServices(
      { DB: database, IMAGES: await runtime.getR2Bucket('IMAGES') },
      { budget: pollBudget, regex, capabilities: services.capabilities },
    ),
  );
  const fetched = await polling.request(
    `https://build.example.test/api/feeds/${pollSource.id}/fetch`,
    { method: 'POST' },
  );
  assert.equal(fetched.status, 200);
  assert.deepEqual(await fetched.json(), {
    feedId: pollSource.id,
    status: 200,
    newItems: 1,
    outcome: 'success',
  });
  assert.equal(pollBudget.used, 2);
  assert.equal(pollCalls, 2);
  assert.equal(
    (await storage.first('SELECT content_html FROM articles WHERE feed_id=?', [pollSource.id]))
      .content_html,
    '<p>Compiled polling content.</p>',
  );
  assert.equal(
    (await storage.first('SELECT etag FROM feeds WHERE id=?', [pollSource.id])).etag,
    '"compiled-poll"',
  );
  const noAllowance = await polling.request(
    `https://build.example.test/api/feeds/${pollSource.id}/fetch`,
    { method: 'POST' },
  );
  assert.equal((await noAllowance.json()).outcome, 'error');
  assert.equal(pollCalls, 2);
  assert.equal((await storage.first('SELECT count(*) AS count FROM feed_poll_leases')).count, 0);
  const ownerKeys = await generateKeyPair('RS256', { extractable: true });
  const ownerConfig = accessConfiguration('https://compiled.cloudflareaccess.com', 'compiled-app');
  const ownerToken = await new SignJWT({
    iss: ownerConfig.issuer,
    aud: ownerConfig.audience,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'compiled' })
    .sign(ownerKeys.privateKey);
  const ownerVerifier = new CloudflareAccessVerifier();
  await ownerVerifier.verify(ownerToken, ownerConfig, async (input) => {
    assert.equal(input, `${ownerConfig.issuer}/cdn-cgi/access/certs`);
    return globalThis.Response.json({
      keys: [
        { ...(await exportJWK(ownerKeys.publicKey)), kid: 'compiled', alg: 'RS256', use: 'sig' },
      ],
    });
  });
  await assert.rejects(
    ownerVerifier.verify(
      ownerToken,
      { ...ownerConfig, audience: 'different-app' },
      globalThis.fetch,
    ),
    /valid Cloudflare Access/,
  );
  await initializeInboundAddress(storage, 'compiled@letters.example.test');
  const mailClock = { now: () => new Date(), monotonic: () => globalThis.performance.now() };
  let rejected;
  const receive = () =>
    receiveCloudflareMail(
      {
        from: 'bounce@example.test',
        to: 'compiled@letters.example.test',
        raw: new globalThis.Response(
          'From: Native <native@example.test>\r\nSubject: Compiled envelope\r\nMessage-ID: <compiled-envelope@example.test>\r\nContent-Type: text/html\r\n\r\n<p>Compiled admission.</p><script>unsafe()</script>',
        ).body,
        rawSize: 300,
        setReject: (reason) => {
          rejected = reason;
        },
      },
      storage,
      mailClock,
      services.rules,
    );
  await receive();
  assert.equal(rejected, undefined);
  assert.equal(
    (await storage.first("SELECT content_html FROM articles WHERE title='Compiled envelope'"))
      .content_html,
    '<p>Compiled admission.</p>',
  );
  await storage.run('UPDATE inbound_addresses SET active=0');
  await initializeInboundAddress(storage, 'compiled@letters.example.test');
  await receive();
  assert.equal(rejected, 'This receiving address is not active.');
  assert.equal((await storage.first('SELECT active FROM inbound_addresses')).active, 0);
  await storage.run(
    "UPDATE articles SET published_at=0,starred_at=? WHERE title='Compiled envelope'",
    [Date.now()],
  );
  const maintenance = await maintainCloudflareNewsletters(storage, new Date());
  assert(maintenance.scanned >= 1 && maintenance.scanned <= 500);
  assert.equal(
    (await storage.first("SELECT raw_html FROM articles WHERE title='Compiled envelope'")).raw_html,
    null,
  );
  assert.equal(
    await storage.first(
      "SELECT key FROM settings WHERE key='maintenance:newsletter-retention:page'",
    ),
    null,
  );
  await storage.run("UPDATE articles SET starred_at=NULL WHERE title='Compiled envelope'");
  await maintainCloudflareNewsletters(new CloudflareStorage(database), new Date());
  assert.equal(
    await storage.first("SELECT id FROM articles WHERE title='Compiled envelope'"),
    null,
  );
  process.stdout.write(
    'Built Cloudflare ports: shared D1 migrations, MIME cleaning/storage, private R2 images, Reader/Brew/rules/source/newsletter HTTP, frozen caches, private page twins, native hashing/ingestion, atomic sender preferences, OPML, Reader-sync state, journal capture/restore, owner-action preview/commit/replay/Undo, scoped tokens with real MCP write/Undo/revocation, interruptible WASM regex, durable polling/redirect accounting, signed Access audience enforcement, active-address mail admission/revocation and bounded newsletter maintenance continuation passed outside the repository cwd. Free resource compliance and installer integration remain pending.\n',
  );
} finally {
  await runtime.dispose();
  process.chdir(originalDirectory);
}
