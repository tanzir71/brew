import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';
import { fileURLToPath } from 'node:url';
import type { ReaderTestEnv } from './test/reader-worker.js';
import type {
  BrewConfig,
  BrewConfigDraft,
  BrewPreview,
  BrewSnapshot,
} from '../../packages/core/src/types/brew.js';
import {
  newBrewSection,
  defaultDelivery,
  BREW_RETENTION_DAYS,
} from '../../packages/core/src/composition-model.js';
import { renderBrewJson, renderBrewMarkdown } from '../../packages/core/src/brew-outputs.js';
import { BrewService } from '../../packages/core/src/brew-service.js';
import { BrewDeliveryRunner } from '../../packages/core/src/brew-delivery.js';
import { NodeBrewStorage } from '../node/src/ports/brew-storage.js';
import { openDatabase } from '../node/src/db/database.js';
import { CloudflareStorage } from './src/storage.js';
import { CloudflareBrewStorage } from './src/brew-storage.js';

const now = Date.parse('2026-11-27T12:00:00Z');
const server = createTestHarness({
  workers: [
    {
      config: {
        name: 'brew-composition-test',
        main: fileURLToPath(new URL('./test/brew-worker.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        compatibility_flags: ['nodejs_compat'],
        workers_dev: false,
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'composition-test',
            database_id: '00000000-0000-0000-0000-000000000001',
            migrations_dir: fileURLToPath(
              new URL('../../packages/db/migrations/', import.meta.url),
            ),
          },
        ],
        r2_buckets: [{ binding: 'IMAGES', bucket_name: 'composition-images-test' }],
        services: [{ binding: 'UPSTREAM', service: 'brew-delivery-test' }],
      },
    },
    {
      config: {
        name: 'brew-delivery-test',
        main: fileURLToPath(new URL('./test/brew-upstream.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        workers_dev: false,
      },
    },
  ],
});
const worker = server.getWorker<ReaderTestEnv>('brew-composition-test');
let env: ReaderTestEnv;
const database = openDatabase(':memory:');
const nodeStorage = new NodeBrewStorage(database);
const node = new BrewService(nodeStorage, {
  now: () => new Date(now),
  monotonic: () => performance.now(),
});
const draft = (): BrewConfigDraft => ({
  name: 'Weekend',
  enabled: false,
  timezone: 'Asia/Dhaka',
  schedule: { kind: 'daily', time: '18:00' },
  delivery: { ...defaultDelivery(), feed: true },
  sections: [
    {
      ...newBrewSection('stories'),
      title: 'Design',
      sources: [
        { kind: 'folder', id: 1 },
        { kind: 'saved_search', id: 1 },
      ],
      onlyUnread: false,
      depth: 'full',
      maxItems: 3,
      filter: {
        match: 'all',
        conditions: [{ field: 'title', operator: 'contains', value: 'design' }],
      },
    },
    {
      ...newBrewSection('letters'),
      sources: [{ kind: 'newsletters', senderIds: [2] }],
      onlyUnread: false,
    },
    {
      ...newBrewSection('note', 'note'),
      note: '**Enjoy** [the archive](/all). No. 1 stays in the note. <script>unsafe()</script>',
    },
  ],
});
beforeAll(async () => {
  await server.listen();
  await worker.applyD1Migrations('DB');
  env = await worker.getEnv();
  const sql = [
    "INSERT INTO folders(id,title) VALUES(1,'Research')",
    `INSERT INTO feeds(id,url,title,folder_id,kind,settings_json) VALUES(1,'https://source.example.test/rss','Journal',1,'rss','{}'),(2,'mailto:letter@example.test','Letters',NULL,'newsletter','{"onlyInBrew":true}'),(3,'https://muted.example.test/rss','Muted',NULL,'rss','{}')`,
    "INSERT INTO saved_source_searches(id,client_id,name,query) VALUES(1,'design','Design','design')",
    "INSERT INTO tags(id,name,color) VALUES(1,'Design','#000000')",
  ];
  for (let id = 1; id <= 120; id++)
    sql.push(
      `INSERT INTO articles(id,feed_id,guid,hash,url,title,content_html,summary_html,published_at,read_at,hidden,excluded_from_brew) VALUES(${id},${id === 120 ? 2 : 1},'g-${id}','h-${id}','https://source.example.test/${id}','Design story ${id}','<p>Careful &amp; considered ${id}.</p>','<p>Excerpt ${id}.</p>',${now - id * 60000},${id % 4 === 0 ? now : 'NULL'},${id === 1 ? 1 : 0},${id === 2 ? 1 : 0})`,
    );
  sql.push('INSERT INTO article_tags(article_id,tag_id) VALUES(3,1)');
  database.sqlite.exec(sql.join(';'));
  await env.DB.batch(sql.map((query) => env.DB.prepare(query)));
}, 30_000);
afterEach(async () => {
  await env.DB.prepare('UPDATE brew_configs SET enabled=0 WHERE enabled=1').run();
});
afterAll(async () => {
  database.close();
  await server.close();
});
async function request(path: string, method = 'GET', body?: unknown, at = now) {
  return worker.fetch(`https://brew.example.test${path}`, {
    method,
    headers: {
      'x-review-now': String(at),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json<T>(path: string, method = 'GET', body?: unknown, at = now): Promise<T> {
  const response = await request(path, method, body, at);
  const value = await response.json();
  expect(response.status, JSON.stringify(value)).toBeGreaterThanOrEqual(200);
  expect(response.status, JSON.stringify(value)).toBeLessThan(300);
  return value as T;
}
async function config(value = draft()) {
  return json<BrewConfig>('/api/brew-configs/composition', 'POST', value);
}
async function state() {
  return (
    await env.DB.batch(
      ['brew_configs', 'brews', 'settings', 'articles', 'sqlite_sequence'].map((table) =>
        env.DB.prepare(`SELECT * FROM ${table} ORDER BY rowid`),
      ),
    )
  ).map((result) => result.results);
}

it('previews through shared workerd routes with Node-identical source/filter/output policy and no writes', async () => {
  const saved = await config();
  const expected = node.createComposition(draft());
  expect(saved.id).toBe(expected.id);
  expect({ ...saved, createdAt: '' }).toEqual({ ...expected, createdAt: '' });
  const before = await state();
  const preview = await json<BrewPreview>(`/api/brew-configs/${saved.id}/preview`, 'POST', {
    at: new Date(now).toISOString(),
  });
  expect(preview).toEqual(await node.previewBrew(expected.id, new Date(now).toISOString()));
  expect(preview.snapshot.sections[0]!.items.map((item) => item.id)).toEqual([3, 4, 5]);
  expect(preview.snapshot.sections[1]!.items.map((item) => item.id)).toEqual([120]);
  expect(preview.outputs.web).not.toContain('<script>');
  const selected = draft();
  selected.sections = [
    {
      ...newBrewSection('many'),
      sources: [{ kind: 'newsletters', senderIds: Array.from({ length: 120 }, (_, i) => i + 1) }],
      onlyUnread: false,
    },
  ];
  expect(await json(`/api/brew-configs/${saved.id}/preview`, 'POST', { draft: selected })).toEqual(
    await node.previewBrew(expected.id, undefined, selected),
  );
  expect(
    (await request(`/api/brew-configs/${saved.id}/preview`, 'POST', { at: '2026-11-27T12:00:00' }))
      .status,
  ).toBe(422);
  selected.sections[0]!.filter = {
    match: 'all',
    conditions: [{ field: 'title', operator: 'matches_regex', value: 'design' }],
  };
  const unavailable = await request(`/api/brew-configs/${saved.id}/preview`, 'POST', {
    draft: selected,
  });
  expect(unavailable.status).toBe(422);
  expect(await unavailable.text()).toContain('Regex is unavailable');
  expect(await state()).toEqual(before);
});

it('freezes and caches Node-identical issues, private twins and feeds while live read state remains separate', async () => {
  const saved = await config();
  const expected = node.createComposition(draft());
  const issue = await json<BrewSnapshot>(`/api/brew-configs/${saved.id}/generate`, 'POST');
  expect(issue).toEqual(await node.generateComposition(expected.id));
  const cached = await env.DB.prepare(
    'SELECT rendered_md AS md,rendered_json AS json FROM brews WHERE id=?',
  )
    .bind(issue.id)
    .first<{ md: string; json: string }>();
  expect(cached!.md).toBe(renderBrewMarkdown(issue));
  expect(JSON.parse(cached!.json)).toEqual(JSON.parse(renderBrewJson(issue)));
  const body = await (await request(`/b/${saved.id}/${issue.id}.md`)).text();
  expect(body).toBe(renderBrewMarkdown(issue, { baseUrl: 'https://brew.example.test' }));
  for (const path of [
    `/b/${saved.id}/${issue.id}.md`,
    `/b/${saved.id}/${issue.id}.json`,
    `/b/${saved.id}.atom`,
    `/b/${saved.id}.json`,
  ]) {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await response.text()).toContain('Weekend');
  }
  expect(await json(`/api/brews/${issue.id}/state`)).toEqual(node.readState(issue.id));
  await json('/api/articles/3', 'PATCH', { read: true, starred: true });
  await json(`/api/brew-configs/${saved.id}/composition`, 'PUT', { ...draft(), name: 'Changed' });
  expect(await json(`/api/brews/${issue.id}`)).toEqual(issue);
  const live = await json<{
    articles: Array<{ id: number; readAt: string | null; starredAt: string | null }>;
  }>(`/api/brews/${issue.id}/state`);
  expect(live.articles.find((item) => item.id === 3)).toMatchObject({
    readAt: new Date(now).toISOString(),
    starredAt: new Date(now).toISOString(),
  });
  await json(`/api/brews/${issue.id}/scroll`, 'PUT', { position: 123 });
  expect(await json(`/api/brews/${issue.id}`)).toEqual({ ...issue, scrollPosition: 123 });
  const before = await state();
  await request(`/b/${saved.id}/${issue.id}.json`);
  await json(`/api/brew-configs/${saved.id}/history`);
  expect(await state()).toEqual(before);
});

it('assigns distinct persistent numbers and matching frozen caches during concurrent Worker generation', async () => {
  const saved = await config();
  const issues = await Promise.all(
    Array.from({ length: 8 }, () =>
      json<BrewSnapshot>(`/api/brew-configs/${saved.id}/generate`, 'POST'),
    ),
  );
  expect(issues.map((issue) => issue.issueNumber).sort((a, b) => a - b)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8,
  ]);
  expect(new Set(issues.map((issue) => issue.id)).size).toBe(8);
  for (const issue of issues) {
    const cached = await env.DB.prepare(
      'SELECT rendered_md AS md,rendered_json AS json FROM brews WHERE id=?',
    )
      .bind(issue.id)
      .first<{ md: string; json: string }>();
    expect(cached!.md).toBe(renderBrewMarkdown(issue));
    expect(JSON.parse(cached!.json)).toEqual(JSON.parse(renderBrewJson(issue)));
  }
  expect(
    (await json<BrewSnapshot[]>(`/api/brew-configs/${saved.id}/history`)).map(
      (issue) => issue.issueNumber,
    ),
  ).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
});

it('claims a scheduled minute across independent invocations and persists both concurrent delivery channels', async () => {
  const value = {
    ...draft(),
    enabled: true,
    delivery: {
      ...defaultDelivery(),
      email: { to: 'reader@example.test' },
      webhook: { url: 'https://delivery.example.test/retry' },
    },
  };
  const saved = await config(value);
  await Promise.all(
    Array.from({ length: 5 }, () =>
      worker.scheduled({ cron: '* * * * *', scheduledTime: new Date(now) }),
    ),
  );
  const history = await json<BrewSnapshot[]>(`/api/brew-configs/${saved.id}/history`);
  expect(history).toHaveLength(1);
  const issue = history[0]!;
  expect(await json(`/api/brews/${issue.id}/delivery`)).toMatchObject({
    results: {
      email: { status: 'sent', attempts: 1, messageId: 'test-mail-id' },
      webhook: { status: 'sent', attempts: 2, httpStatus: 204 },
    },
  });
  await worker.scheduled({ cron: '* * * * *', scheduledTime: new Date(now) });
  const calls = (await (
    await env.UPSTREAM.fetch('https://delivery.example.test/stats')
  ).json()) as Array<{
    path: string;
    key: string | null;
    body: { idempotencyKey?: string; text?: string };
  }>;
  expect(calls.map((call) => call.path)).toEqual(
    expect.arrayContaining(['/mail', '/retry', '/retry']),
  );
  expect(calls).toHaveLength(3);
  const key = `https://brew.example.test/b/${saved.id}/${issue.id}`;
  expect(calls.filter((call) => call.path === '/retry').map((call) => call.key)).toEqual([
    key,
    key,
  ]);
  expect(calls.find((call) => call.path === '/mail')!.body).toMatchObject({ idempotencyKey: key });
  const fresh = new CloudflareBrewStorage(new CloudflareStorage(env.DB));
  let repeated = 0;
  await new BrewDeliveryRunner(
    fresh,
    { now: () => new Date(now), monotonic: () => performance.now() },
    {
      mail: {
        kind: 'resend',
        send: async () => {
          repeated++;
          return {};
        },
      },
      fetcher: async () => {
        repeated++;
        return new Response();
      },
    },
  ).deliver(issue, value.delivery);
  expect(repeated).toBe(0);
  expect(await fresh.setting(`brew_composed_${saved.id}_${new Date(now).toISOString()}`)).toBe(
    new Date(now).toISOString(),
  );
  await json(`/api/brew-configs/${saved.id}/composition`, 'PUT', { ...value, enabled: false });
});

it('refuses webhook redirects in workerd without forwarding the frozen body to another destination', async () => {
  const saved = await config({
    ...draft(),
    delivery: { ...defaultDelivery(), webhook: { url: 'https://delivery.example.test/redirect' } },
  });
  const issue = await json<BrewSnapshot>(`/api/brew-configs/${saved.id}/generate`, 'POST');
  expect(await json(`/api/brews/${issue.id}/delivery`)).toMatchObject({
    results: { webhook: { status: 'failed', attempts: 2, error: 'network' } },
  });
  const calls = (await (
    await env.UPSTREAM.fetch('https://delivery.example.test/stats')
  ).json()) as Array<{ path: string }>;
  expect(calls.filter((call) => call.path === '/redirect')).toHaveLength(2);
  expect(calls.filter((call) => call.path === '/unexpected')).toEqual([]);
});

it('records a skipped minute without freezing, delivering or retrying after new stories arrive', async () => {
  const saved = await config({
    ...draft(),
    enabled: true,
    schedule: { kind: 'daily', time: '18:00', skipIfFewerThan: 1000 },
  });
  await Promise.all([
    worker.scheduled({ scheduledTime: new Date(now) }),
    worker.scheduled({ scheduledTime: new Date(now) }),
  ]);
  expect(await json(`/api/brew-configs/${saved.id}/history`)).toEqual([]);
  await json(`/api/brew-configs/${saved.id}/composition`, 'PUT', { ...draft(), enabled: true });
  await worker.scheduled({ scheduledTime: new Date(now) });
  expect(await json(`/api/brew-configs/${saved.id}/history`)).toEqual([]);
  await json(`/api/brew-configs/${saved.id}/composition`, 'PUT', draft());
});

it('rolls back the issue, persistent counter, caches and schedule receipt on storage failure', async () => {
  const saved = await config();
  const preview = await json<BrewPreview>(`/api/brew-configs/${saved.id}/preview`, 'POST', {});
  const before = await state();
  await env.DB.prepare(
    "CREATE TRIGGER reject_brew_cache BEFORE UPDATE OF rendered_md ON brews BEGIN SELECT RAISE(ABORT,'test cache failure'); END",
  ).run();
  try {
    const { version, issueNumber, configName, generatedAt, timezone, sections } = preview.snapshot;
    await expect(
      new CloudflareBrewStorage(new CloudflareStorage(env.DB)).saveScheduled(
        saved.id,
        { version, issueNumber, configName, generatedAt, timezone, sections },
        { key: 'test-failed-minute', value: 'claimed' },
      ),
    ).rejects.toThrow('test cache failure');
    expect(await state()).toEqual(before);
  } finally {
    await env.DB.prepare('DROP TRIGGER reject_brew_cache').run();
  }
  expect(await json(`/api/brew-configs/${saved.id}/generate`, 'POST')).toMatchObject({
    issueNumber: 1,
  });
});

it('prunes disabled compositions by age and preserves the next number after imported history expires', async () => {
  const saved = await config();
  for (let i = 0; i < 3; i++) await json(`/api/brew-configs/${saved.id}/generate`, 'POST');
  await env.DB.prepare('DELETE FROM settings WHERE key=?')
    .bind(`brew_issue_number_${saved.id}`)
    .run();
  const later = now + (BREW_RETENTION_DAYS + 1) * 86_400_000;
  await worker.scheduled({ scheduledTime: new Date(later) });
  expect(await json(`/api/brew-configs/${saved.id}/history`)).toEqual([]);
  expect(
    await json(`/api/brew-configs/${saved.id}/generate`, 'POST', undefined, later),
  ).toMatchObject({ issueNumber: 4 });
});

it('retains legacy CRUD and generation, unassigns deleted newsletter Brews and handles over 100 read-state IDs', async () => {
  const legacy = {
    name: '  Archive  ',
    enabled: false,
    scheduleCron: '15 8 * * 1-5',
    sections: [
      {
        id: 'old',
        title: 'Stories',
        source: 'feed',
        sourceId: 1,
        maxItems: 4,
        layout: 'hero',
        sort: 'newest',
        onlyUnread: false,
      },
    ],
  };
  const saved = await json<{ id: number; name: string }>('/api/brew-configs', 'POST', legacy);
  expect(saved.name).toBe('Archive');
  const issue = await json<BrewSnapshot>(`/api/brew-configs/${saved.id}/generate`, 'POST');
  expect(issue.sections[0]).toMatchObject({
    layout: 'hero',
    items: [{ id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }],
  });
  expect(await json(`/api/brew-configs/${saved.id}/composition`)).toMatchObject({
    scheduleCron: '15 8 * * 1-5',
    timezone: 'UTC',
  });
  const storage = new CloudflareBrewStorage(new CloudflareStorage(env.DB));
  expect(await storage.usesComposition(saved.id)).toBe(false);
  const states = await storage.articleStates([
    ...Array.from({ length: 120 }, (_, i) => i + 1),
    999,
  ]);
  expect(states).toHaveLength(121);
  expect(states.at(-1)).toMatchObject({ id: 999, available: false, feedId: null });
  await env.DB.prepare(
    "UPDATE feeds SET settings_json=json_object('brewId',?,'onlyInBrew',json('true')) WHERE id=2",
  )
    .bind(saved.id)
    .run();
  expect((await request(`/api/brew-configs/${saved.id}`, 'DELETE')).status).toBe(204);
  expect(
    await env.DB.prepare('SELECT settings_json FROM feeds WHERE id=2').first('settings_json'),
  ).toBe('{"onlyInBrew":false}');
  expect((await request(`/api/brews/${issue.id}`)).status).toBe(404);
  expect((await request(`/api/brew-configs/${saved.id}`, 'DELETE')).status).toBe(404);
});
