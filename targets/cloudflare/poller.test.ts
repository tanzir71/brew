import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';
import { fileURLToPath } from 'node:url';
import type { ReaderTestEnv } from './test/reader-worker.js';
import type { PollerCall } from './test/poller-upstream.js';
import { pollerUpstream } from './test/poller-upstream.js';
import type { PollResult } from '../../packages/core/src/feed-polling.js';
import { openDatabase } from '../node/src/db/database.js';
import { PollerService } from '../node/src/services/poller-service.js';
import { IngestPipeline } from '../../packages/core/src/ingest-pipeline.js';
import { NodeIngestStorage } from '../node/src/ports/ingest-storage.js';
import { nodeHash } from '../node/src/ports/runtime.js';

const now = Date.parse('2026-11-27T12:00:00Z');
const server = createTestHarness({
  workers: [
    {
      config: {
        name: 'brew-poller-test',
        main: fileURLToPath(new URL('./test/poller-worker.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        compatibility_flags: ['nodejs_compat'],
        workers_dev: false,
        rules: [{ type: 'CompiledWasm', globs: ['**/*.wasm', '**/wasm'], fallthrough: true }],
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'poller-test',
            database_id: '00000000-0000-0000-0000-000000000001',
            migrations_dir: fileURLToPath(
              new URL('../../packages/db/migrations/', import.meta.url),
            ),
          },
        ],
        r2_buckets: [{ binding: 'IMAGES', bucket_name: 'poller-images-test' }],
        services: [{ binding: 'UPSTREAM', service: 'brew-poller-upstream' }],
      },
    },
    {
      config: {
        name: 'brew-poller-upstream',
        main: fileURLToPath(new URL('./test/poller-upstream.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        workers_dev: false,
      },
    },
  ],
});
const worker = server.getWorker<ReaderTestEnv>('brew-poller-test');
let env: ReaderTestEnv;
beforeAll(async () => {
  await server.listen();
  await worker.applyD1Migrations('DB');
  env = await worker.getEnv();
}, 30_000);
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await env.UPSTREAM.fetch('https://source.test/__review/release');
  await env.UPSTREAM.fetch('https://source.test/__review/reset');
  await env.DB.batch(
    [
      'DELETE FROM feeds',
      'DELETE FROM rules',
      'DELETE FROM settings',
      "DELETE FROM sqlite_sequence WHERE name IN ('feeds','articles','rules')",
    ].map((sql) => env.DB.prepare(sql)),
  );
});
type Report = { results: PollResult[]; used: number };
async function poll(limit = 40, headers: Record<string, string> = {}): Promise<Report> {
  const response = await worker.fetch('https://brew.test/__review/poll', {
    headers: { 'x-review-limit': String(limit), ...headers },
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Report>;
}
async function calls(): Promise<PollerCall[]> {
  return (await env.UPSTREAM.fetch('https://source.test/__review/stats')).json() as Promise<
    PollerCall[]
  >;
}
async function release() {
  await env.UPSTREAM.fetch('https://source.test/__review/release');
}
async function insert(id: number, path: string, extra = '') {
  await env.DB.prepare(
    `INSERT INTO feeds(id,url,title${extra ? ',last_fetched_at,fetch_interval_minutes,consecutive_failures' : ''}) VALUES(?,?,'Pending'${extra ? `,${extra}` : ''})`,
  )
    .bind(id, `https://source.test${path}`)
    .run();
}
async function manual(id: number) {
  const response = await worker.fetch(`https://brew.test/api/feeds/${id}/fetch`, {
    method: 'POST',
  });
  return { status: response.status, value: (await response.json()) as PollResult };
}

it('polls 200 real feeds over five native scheduled invocations with at most 40 external requests each', async () => {
  await env.DB.batch(
    Array.from({ length: 200 }, (_, index) =>
      env.DB.prepare("INSERT INTO feeds(id,url,title) VALUES(?,?,'Pending')").bind(
        index + 1,
        `https://source.test/feed/${index + 1}`,
      ),
    ),
  );
  await env.DB.prepare(
    "INSERT INTO feeds(id,url,title,kind) VALUES(201,'mailto:letters@example.test','Letters','newsletter')",
  ).run();
  const seen: number[] = [];
  for (let index = 0; index < 5; index++) {
    const time = now + index * 60_000;
    await worker.scheduled({ cron: '* * * * *', scheduledTime: new Date(time) });
    const saved = await env.DB.prepare('SELECT value FROM settings WHERE key=?')
      .bind(`review-poll-${time}`)
      .first<{ value: string }>();
    const report = JSON.parse(saved!.value) as Report;
    expect(report.used).toBe(40);
    expect(report.results).toHaveLength(40);
    expect(
      report.results.every((result) => result.outcome === 'success' && result.newItems === 1),
    ).toBe(true);
    seen.push(...report.results.map((result) => result.feedId));
  }
  expect(seen).toEqual(Array.from({ length: 200 }, (_, index) => index + 1));
  expect(await calls()).toHaveLength(200);
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM articles WHERE content_html=?')
      .bind('<p>Keep this.</p>')
      .first(),
  ).toEqual({ n: 200 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM feed_poll_leases').first()).toEqual({
    n: 0,
  });
  expect(await env.DB.prepare('SELECT last_fetched_at FROM feeds WHERE id=201').first()).toEqual({
    last_fetched_at: null,
  });
}, 30_000);

it('orders by due time with stable ID ties, excludes backoff/future/newsletter sources and releases unused claims', async () => {
  await insert(1, '/one', `${now - 60 * 60_000},30,0`);
  await insert(2, '/two', `${now - 180 * 60_000},60,0`);
  await insert(3, '/never');
  await insert(4, '/future', `${now},30,0`);
  await insert(5, '/backoff', `${now - 60 * 60_000},30,3`);
  await insert(6, '/saturated', `${now - 1400 * 60_000},30,1000`);
  expect((await poll(2)).results.map((result) => result.feedId)).toEqual([2, 3]);
  expect((await calls()).map((call) => call.path)).toEqual(['/never', '/two']);
  expect((await poll(2)).results.map((result) => result.feedId)).toEqual([1]);
  expect((await poll(2)).results).toEqual([]);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM feed_poll_leases').first()).toEqual({
    n: 0,
  });
});

it('preserves real Node parsing, ingestion, metadata, adaptive intervals and failure policy', async () => {
  const database = openDatabase(':memory:');
  try {
    const paths = ['/busy', '/quiet', '/atom', '/invalid', '/gone'];
    const sql = paths.map(
      (path, index) =>
        `INSERT INTO feeds(id,url,title) VALUES(${index + 1},'https://source.test${path}','Pending')`,
    );
    await env.DB.batch(sql.map((query) => env.DB.prepare(query)));
    database.sqlite.exec(sql.join(';'));
    const clock = { now: () => new Date(now), monotonic: () => 0 };
    const pipeline = new IngestPipeline(new NodeIngestStorage(database), nodeHash, clock);
    const node = new PollerService(
      database,
      (input, init) => pollerUpstream(new Request(input, init)),
      (feed, items) => pipeline.ingest(feed, items),
      clock.now,
    );
    expect((await poll()).results).toEqual(await node.pollDue());
    for (const query of [
      'SELECT id,title,site_url,description,fetch_interval_minutes,etag,last_modified,last_fetched_at,last_status,consecutive_failures,failing_since FROM feeds ORDER BY id',
      'SELECT feed_id,guid,hash,url,title,content_html,published_at FROM articles ORDER BY feed_id,guid',
    ])
      expect((await env.DB.prepare(query).all()).results).toEqual(
        database.sqlite.prepare(query).all(),
      );
    expect(
      await env.DB.prepare(
        'SELECT fetch_interval_minutes AS interval FROM feeds WHERE id=1',
      ).first(),
    ).toEqual({ interval: 23 });
    expect(
      await env.DB.prepare(
        'SELECT fetch_interval_minutes AS interval FROM feeds WHERE id=2',
      ).first(),
    ).toEqual({ interval: 45 });
  } finally {
    database.close();
  }
});

it('uses validators on a forced refresh, resets 304 failures and leaves newsletters untouched', async () => {
  await insert(1, '/cached');
  expect((await manual(1)).value).toMatchObject({ outcome: 'success', newItems: 1 });
  await env.DB.prepare('UPDATE feeds SET consecutive_failures=3,failing_since=? WHERE id=1')
    .bind(now - 7 * 86_400_000)
    .run();
  expect((await manual(1)).value).toMatchObject({
    outcome: 'not-modified',
    status: 304,
    newItems: 0,
  });
  expect((await calls())[1]).toMatchObject({
    etag: '"v1"',
    modified: 'Fri, 27 Nov 2026 11:00:00 GMT',
  });
  expect(
    await env.DB.prepare(
      'SELECT consecutive_failures,failing_since,last_status FROM feeds WHERE id=1',
    ).first(),
  ).toEqual({ consecutive_failures: 0, failing_since: null, last_status: 304 });
  await env.DB.prepare(
    "INSERT INTO feeds(id,url,title,kind) VALUES(2,'mailto:letter@example.test','Letters','newsletter')",
  ).run();
  expect((await manual(2)).value).toMatchObject({ outcome: 'error', status: 0 });
  expect((await manual(99)).status).toBe(404);
  expect(await calls()).toHaveLength(2);
});

it('shares redirect capacity and defers local exhaustion without source failure or validators', async () => {
  for (let id = 1; id <= 5; id++) await insert(id, `/redirect/${id}`);
  const first = await poll(5);
  expect(first.used).toBe(5);
  expect(first.results.filter((result) => result.outcome === 'success')).toHaveLength(2);
  expect(first.results.filter((result) => result.error?.includes('allowance'))).toHaveLength(1);
  expect(
    await env.DB.prepare(
      'SELECT count(*) AS n FROM feeds WHERE last_fetched_at IS NULL AND consecutive_failures=0 AND etag IS NULL',
    ).first(),
  ).toEqual({ n: 3 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM feed_poll_leases').first()).toEqual({
    n: 0,
  });
  const next = await poll();
  expect(next.used).toBe(6);
  expect(next.results.every((result) => result.outcome === 'success')).toBe(true);
});

it('shares allowance with other work and records real rule delivery failures without exceeding it', async () => {
  await insert(1, '/rule');
  const saved = await worker.fetch('https://brew.test/api/rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Triage',
      enabled: true,
      scope: {},
      matchType: 'all',
      conditions: [],
      stopProcessing: false,
      actions: [
        { type: 'star' },
        { type: 'webhook', url: 'https://source.test/webhook' },
        { type: 'webhook', url: 'https://source.test/webhook' },
      ],
    }),
  });
  expect(saved.status).toBe(201);
  const report = await poll(3, { 'x-review-prefetch': '1' });
  expect(report.used).toBe(3);
  expect(report.results[0]).toMatchObject({ outcome: 'success', newItems: 1 });
  expect((await calls()).map((call) => call.path)).toEqual(['/prefetch', '/rule', '/webhook']);
  const logs = await env.DB.prepare('SELECT actions_taken_json FROM rule_logs').all<{
    actions_taken_json: string;
  }>();
  const actions = JSON.parse(logs.results[0]!.actions_taken_json) as Array<{
    ok: boolean;
    error?: string;
  }>;
  expect(actions.map((action) => action.ok)).toEqual([true, true, false]);
  expect(actions[2]!.error).toContain('allowance');
  expect(
    await env.DB.prepare('SELECT count(*) AS n FROM articles WHERE starred_at IS NOT NULL').first(),
  ).toEqual({ n: 1 });
  await manual(1);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM rule_logs').first()).toEqual({ n: 1 });
});

it('makes progress across due sources with maximum-length redirect chains instead of repeatedly exhausting every source', async () => {
  for (let id = 1; id <= 6; id++) await insert(id, `/chain/${id}/10`);
  const completed = new Set<number>();
  for (let cycle = 0; cycle < 3 && completed.size < 6; cycle++) {
    const report = await poll();
    expect(report.used).toBeLessThanOrEqual(40);
    const successes = report.results.filter((result) => result.outcome === 'success');
    expect(successes.length).toBeGreaterThan(0);
    successes.forEach((result) => completed.add(result.feedId));
  }
  expect(completed.size).toBe(6);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM articles').first()).toEqual({ n: 6 });
});

it('claims across concurrent invocations, including manual refresh, and never releases another runner', async () => {
  for (let id = 1; id <= 4; id++) await insert(id, `/hold/${id}`);
  const first = poll(2);
  let second: Promise<Report> | undefined;
  try {
    await expect.poll(async () => (await calls()).length, { timeout: 2000, interval: 10 }).toBe(1);
    const busyId = Number((await calls())[0]!.path.split('/').at(-1));
    expect((await manual(busyId)).value.error).toContain('already running');
    second = poll(2);
    await expect.poll(async () => (await calls()).length, { timeout: 2000, interval: 10 }).toBe(2);
    expect(
      await env.DB.prepare('SELECT count(DISTINCT runner) AS n FROM feed_poll_leases').first(),
    ).toEqual({ n: 2 });
    await release();
    const reports = await Promise.all([first, second]);
    expect(
      reports.flatMap((report) => report.results).every((result) => result.outcome === 'success'),
    ).toBe(true);
    expect(new Set((await calls()).map((call) => call.path)).size).toBe(4);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM feed_poll_leases').first()).toEqual({
      n: 0,
    });
  } finally {
    await release();
    await Promise.allSettled([first, ...(second ? [second] : [])]);
  }
});

it('recovers an expired claim and fences the superseded response from articles and metadata', async () => {
  await insert(1, '/hold/expired');
  const first = poll(1);
  let replacement: ReturnType<typeof manual> | undefined;
  try {
    await expect.poll(async () => (await calls()).length, { timeout: 2000, interval: 10 }).toBe(1);
    await env.DB.prepare('UPDATE feed_poll_leases SET expires_at=?')
      .bind(now - 1)
      .run();
    replacement = manual(1);
    await expect.poll(async () => (await calls()).length, { timeout: 2000, interval: 10 }).toBe(2);
    await release();
    expect((await first).results[0]).toMatchObject({
      outcome: 'error',
      newItems: 0,
      error: 'Feed polling ownership changed.',
    });
    expect((await replacement).value).toMatchObject({ outcome: 'success', newItems: 1 });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM articles').first()).toEqual({ n: 1 });
    expect(
      await env.DB.prepare('SELECT consecutive_failures,last_status FROM feeds').first(),
    ).toEqual({ consecutive_failures: 0, last_status: 200 });
  } finally {
    await release();
    await Promise.allSettled([first, ...(replacement ? [replacement] : [])]);
  }
});

it.each(['delete', 'change URL'])(
  'does not apply a fetched response after owners %s',
  async (change) => {
    await insert(1, '/hold/changed');
    const pending = poll(1);
    try {
      await expect
        .poll(async () => (await calls()).length, { timeout: 2000, interval: 10 })
        .toBe(1);
      await env.DB.prepare(
        change === 'delete'
          ? 'DELETE FROM feeds WHERE id=1'
          : "UPDATE feeds SET url='https://source.test/replaced',title='Replacement' WHERE id=1",
      ).run();
      await release();
      expect((await pending).results[0]).toMatchObject({ outcome: 'error', newItems: 0 });
      expect(await env.DB.prepare('SELECT count(*) AS n FROM articles').first()).toEqual({ n: 0 });
      if (change !== 'delete')
        expect(
          await env.DB.prepare(
            'SELECT title,last_fetched_at,consecutive_failures FROM feeds',
          ).first(),
        ).toEqual({ title: 'Replacement', last_fetched_at: null, consecutive_failures: 0 });
    } finally {
      await release();
      await pending;
    }
  },
);

it('fences empty responses before applying stale retention to a replacement source', async () => {
  await insert(1, '/hold/quiet');
  await env.DB.prepare(
    "INSERT INTO articles(feed_id,guid,hash,url,title,published_at) VALUES(1,'old','old','https://source.test/old','Keep old history',?)",
  )
    .bind(now - 100 * 86_400_000)
    .run();
  const pending = poll(1);
  try {
    await expect.poll(async () => (await calls()).length, { timeout: 2000, interval: 10 }).toBe(1);
    await env.DB.prepare(
      "UPDATE feeds SET url='https://source.test/replaced',retention_days=3650 WHERE id=1",
    ).run();
    await release();
    expect((await pending).results[0]).toMatchObject({
      outcome: 'error',
      error: 'Feed polling ownership changed.',
    });
    expect(await env.DB.prepare('SELECT title FROM articles').first()).toEqual({
      title: 'Keep old history',
    });
    expect(
      await env.DB.prepare('SELECT last_fetched_at,consecutive_failures FROM feeds').first(),
    ).toEqual({ last_fetched_at: null, consecutive_failures: 0 });
  } finally {
    await release();
    await pending;
  }
});
