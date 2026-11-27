import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync, readdirSync, readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { openDatabase, type BrewDatabase } from '../../targets/node/src/db/database.js';
import { NodeBrewStorage } from '../../targets/node/src/ports/brew-storage.js';
import { NodeScheduledBrewJobs } from '../../targets/node/src/ports/brew-scheduled-jobs.js';
import {
  ScheduledBrewProcessor,
  ScheduleLeaseLost,
  SCHEDULE_LEASE_MS,
  type ScheduledBrewJob,
  type ScheduledWorkBudget,
} from '../../packages/core/src/brew-scheduled-processing.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';
import { BrewService } from '../../packages/core/src/brew-service.js';
import { nodeRegex } from '../../targets/node/src/ports/runtime.js';
import type { BrewConfigDraft } from '../../packages/core/src/types/brew.js';
import type { BrewDeliveryOptions } from '../../packages/core/src/types/delivery.js';
import { createApp } from '../../targets/node/src/app.js';
import { PollerService } from '../../targets/node/src/services/poller-service.js';
import { BrewService as ScheduledNodeService } from '../../targets/node/src/services/brew-service.js';

const baseline = Date.parse('2026-11-27T12:00:00Z');
let at = baseline;
const clock = { now: () => new Date(at), monotonic: () => performance.now() };
let server: Server;
let endpoint: string;
const calls: { body: string; key?: string; path?: string }[] = [];
const files: string[] = [];
const databases = new Set<BrewDatabase>();
let releaseHeld: (() => void) | undefined;
beforeAll(async () => {
  server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    calls.push({
      body,
      key: request.headers['idempotency-key'] as string | undefined,
      path: request.url,
    });
    if (request.url === '/hold') {
      releaseHeld = () => {
        if (response.writableEnded) return;
        response.writeHead(204);
        response.end();
      };
      return;
    }
    response.writeHead(request.url === '/fail' ? 503 : 204);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing provider port.');
  endpoint = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
afterEach(() => {
  releaseHeld?.();
  releaseHeld = undefined;
  vi.restoreAllMocks();
  for (const db of databases) db.close();
  databases.clear();
  for (const file of files.splice(0))
    for (const suffix of ['', '-wal', '-shm'])
      if (existsSync(file + suffix)) unlinkSync(file + suffix);
  calls.length = 0;
  at = baseline;
});
function database(file = ':memory:') {
  const db = openDatabase(file);
  databases.add(db);
  return db;
}
function close(db: BrewDatabase) {
  db.close();
  databases.delete(db);
}
function fixture(db: BrewDatabase, overrides: Partial<BrewConfigDraft> = {}) {
  db.sqlite
    .prepare("INSERT INTO feeds(id,url,title) VALUES(1,'https://source.test/feed','Source')")
    .run();
  db.sqlite
    .prepare(
      "INSERT INTO articles(feed_id,guid,hash,url,title,summary_html,content_html,published_at) VALUES(1,'one','one','https://source.test/one','Scheduled story','<p>Excerpt.</p>','<p>Body.</p>',?)",
    )
    .run(at - 60_000);
  const storage = new NodeBrewStorage(db);
  const id = storage.createComposition({
    name: 'Scheduled',
    enabled: true,
    timezone: 'UTC',
    schedule: { kind: 'daily', time: '12:00' },
    delivery: defaultDelivery(),
    sections: [
      { ...newBrewSection('stories'), onlyUnread: false, sources: [{ kind: 'feed', id: 1 }] },
    ],
    ...overrides,
  });
  return { storage, id };
}
function processor(
  db: BrewDatabase,
  jobs = new NodeScheduledBrewJobs(db),
  delivery: BrewDeliveryOptions = {},
  budget: ScheduledWorkBudget = { remaining: Infinity },
) {
  return new ScheduledBrewProcessor(
    jobs,
    new NodeBrewStorage(db),
    clock,
    nodeRegex,
    { fetcher: fetch, baseUrl: 'https://brew.test', ...delivery },
    () => randomUUID(),
    budget,
  );
}
function count(db: BrewDatabase, table: string) {
  return (db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function scheduledIssue(db: BrewDatabase) {
  const issue = new NodeBrewStorage(db).snapshot(
    (db.sqlite.prepare('SELECT id FROM brews ORDER BY id DESC LIMIT 1').get() as { id: number }).id,
  )!;
  if (!('version' in issue)) throw new Error('Expected a composition snapshot.');
  return issue;
}

it('resumes a frozen configuration scan after SQLite reopening, edits and deletion, then catches a newly created due Brew', async () => {
  const file = join(tmpdir(), `brew-capture-${randomUUID()}.db`);
  files.push(file);
  let db = database(file);
  const { storage } = fixture(db, {
    sections: [{ ...newBrewSection('note', 'note'), note: 'Original note.' }],
  });
  for (let i = 2; i <= 8; i++)
    storage.createComposition({ ...storage.composition(1)!, name: `Original ${i}` });
  await processor(
    db,
    undefined,
    {},
    { remaining: Infinity, configPageSize: 2, capturePages: 1 },
  ).capture();
  expect(count(db, 'brew_schedule_jobs')).toBe(2);
  expect(count(db, 'brew_schedule_configs')).toBe(8);
  expect(storage.setting('brew:schedule:through')).toBe(String(baseline - 60_000));
  db.sqlite
    .prepare("UPDATE brew_configs SET name='Changed live',enabled=0,sections_json='[]'")
    .run();
  storage.delete(5);
  at += 60_000;
  const later = storage.createComposition({
    ...storage.composition(1)!,
    enabled: true,
    name: 'Created during capture',
    schedule: { kind: 'daily', time: '12:01' },
    sections: [{ ...newBrewSection('later', 'note'), note: 'Later note.' }],
  });
  db.sqlite.prepare('UPDATE brew_configs SET created_at=? WHERE id=?').run(at, later);
  let pages = 0;
  while (count(db, 'brew_schedule_captures') && pages++ < 8) {
    close(db);
    db = database(file);
    at += 60_000;
    await processor(
      db,
      undefined,
      {},
      { remaining: Infinity, configPageSize: 2, capturePages: 1 },
    ).capture();
  }
  expect(pages).toBe(4);
  expect(count(db, 'brew_schedule_configs')).toBe(0);
  expect(count(db, 'brew_schedule_jobs')).toBe(7);
  expect(new NodeBrewStorage(db).setting('brew:schedule:through')).toBe(String(baseline));
  await processor(db).capture();
  await processor(db).drain();
  const rows = db.sqlite
    .prepare('SELECT generated_at,payload_json FROM brews ORDER BY brew_config_id')
    .all() as { generated_at: number; payload_json: string }[];
  expect(rows).toHaveLength(8);
  expect(rows.slice(0, 7).map((row) => row.generated_at)).toEqual(Array(7).fill(baseline));
  expect(
    rows
      .slice(0, 7)
      .every((row) => JSON.parse(row.payload_json).sections[0].noteHtml.includes('Original note.')),
  ).toBe(true);
  expect(rows.at(-1)!.generated_at).toBe(baseline + 60_000);
});

it('resumes only an accepted discovery window at Node startup and admits new configurations on the next capture', async () => {
  const db = database();
  const { storage } = fixture(db);
  storage.createComposition({ ...storage.composition(1)!, name: 'Accepted second' });
  await processor(
    db,
    undefined,
    {},
    { remaining: Infinity, configPageSize: 1, capturePages: 1 },
  ).capture();
  storage.createComposition({ ...storage.composition(1)!, name: 'Created after snapshot' });
  await new ScheduledNodeService(db, clock).runPendingScheduled(false);
  expect(count(db, 'brews')).toBe(2);
  expect(count(db, 'brew_schedule_captures')).toBe(0);
  await new ScheduledNodeService(db, clock).runPendingScheduled(false);
  expect(count(db, 'brews')).toBe(2);
  await new ScheduledNodeService(db, clock).runPendingScheduled(true);
  expect(count(db, 'brews')).toBe(3);
});

it('fences older enqueue and watermark writes until accepted discovery finishes', async () => {
  const db = database();
  const { storage } = fixture(db);
  storage.createComposition({ ...storage.composition(1)!, name: 'Frozen second' });
  await processor(
    db,
    undefined,
    {},
    { remaining: Infinity, configPageSize: 1, capturePages: 1 },
  ).capture();
  const first = db.sqlite
    .prepare('SELECT request_json,state_json FROM brew_schedule_jobs')
    .get() as { request_json: string; state_json: string };
  const request = JSON.parse(first.request_json);
  request.config.id = 2;
  request.config.name = 'Older changed definition';
  request.receipt.key = `brew_composed_2_${request.receipt.value}`;
  expect(
    db.sqlite
      .prepare(
        'INSERT INTO brew_schedule_jobs(id,config_id,request_json,state_json,created_at) VALUES(?,2,?,?,?)',
      )
      .run(request.receipt.key, JSON.stringify(request), first.state_json, at).changes,
  ).toBe(0);
  expect(
    db.sqlite
      .prepare("UPDATE settings SET value=? WHERE key='brew:schedule:through'")
      .run(String(at + 86_400_000)).changes,
  ).toBe(0);
  expect(
    db.sqlite
      .prepare(
        "INSERT INTO settings(key,value) VALUES('brew:schedule:through',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(String(at + 86_400_000)).changes,
  ).toBe(0);
  await processor(db).capture();
  await processor(db).drain();
  expect(count(db, 'brews')).toBe(2);
  expect(scheduledIssue(db).configName).toBe('Frozen second');
  expect(storage.setting('brew:schedule:through')).toBe(String(baseline));
});

it('bounds configuration reads for a multi-megabyte library without dropping non-due or disabled definitions', async () => {
  const db = database();
  const { storage } = fixture(db, {
    sections: [{ ...newBrewSection('note', 'note'), note: 'x'.repeat(65_536) }],
  });
  for (let i = 1; i < 80; i++)
    storage.createComposition({
      ...storage.composition(1)!,
      name: `Large ${i}`,
      enabled: i % 2 === 0,
      schedule: { kind: 'daily', time: i % 3 ? '13:00' : '12:00' },
    });
  const jobs = new NodeScheduledBrewJobs(db),
    pages = vi.spyOn(jobs, 'captureConfigs');
  await processor(
    db,
    jobs,
    {},
    { remaining: Infinity, configPageSize: 3, capturePages: 1 },
  ).capture();
  expect(
    (
      db.sqlite
        .prepare('SELECT sum(length(snapshot_json)) AS bytes FROM brew_schedule_configs')
        .get() as { bytes: number }
    ).bytes,
  ).toBeGreaterThan(5_000_000);
  let steps = 0;
  while (count(db, 'brew_schedule_captures') && steps++ < 30)
    await processor(
      db,
      jobs,
      {},
      { remaining: Infinity, configPageSize: 3, capturePages: 1 },
    ).capture();
  expect(steps).toBeLessThan(30);
  expect(pages.mock.results.every((result) => result.value.length <= 3)).toBe(true);
  expect(pages.mock.results.reduce((sum, result) => sum + result.value.length, 0)).toBe(80);
  expect(count(db, 'brew_schedule_jobs')).toBe(14);
  expect(count(db, 'brew_schedule_configs')).toBe(0);
});

it.each(['before', 'after'] as const)(
  'recovers configuration page acknowledgement loss %s commit without duplicate occurrences',
  async (timing) => {
    const db = database();
    const { storage } = fixture(db);
    for (let i = 0; i < 2; i++)
      storage.createComposition({ ...storage.composition(1)!, name: `Other ${i}` });
    const jobs = new NodeScheduledBrewJobs(db),
      commit = jobs.commitCapture.bind(jobs);
    vi.spyOn(jobs, 'commitCapture').mockImplementationOnce((...args) => {
      if (timing === 'after') commit(...args);
      throw new Error('lost configuration response');
    });
    await expect(
      processor(db, jobs, {}, { remaining: Infinity, configPageSize: 2 }).capture(),
    ).rejects.toThrow('lost configuration response');
    expect(storage.setting('brew:schedule:through')).toBe(String(baseline - 60_000));
    at += 60_000;
    await processor(db).capture();
    await processor(db).drain();
    expect(count(db, 'brews')).toBe(3);
    expect(count(db, 'brew_schedule_captures')).toBe(0);
  },
);

it.each(['invalid', '1.5', '9007199254740992'])(
  'uses a safe initial minute for an invalid discovery watermark %s',
  async (value) => {
    const db = database();
    fixture(db);
    db.sqlite
      .prepare("INSERT INTO settings(key,value) VALUES('brew:schedule:through',?)")
      .run(value);
    await processor(db).capture();
    await processor(db).drain();
    expect(scheduledIssue(db).generatedAt).toBe(new Date(baseline).toISOString());
  },
);

it('persists the initial discovery watermark before a failed source-of-configurations snapshot', async () => {
  const db = database();
  fixture(db);
  db.sqlite.exec(
    "CREATE TRIGGER reject_capture BEFORE INSERT ON brew_schedule_configs BEGIN SELECT RAISE(ABORT,'controlled capture failure'); END",
  );
  await expect(processor(db).capture()).rejects.toThrow('controlled capture failure');
  expect(new NodeBrewStorage(db).setting('brew:schedule:through')).toBe(String(baseline - 60_000));
  expect(count(db, 'brew_schedule_captures')).toBe(0);
  expect(count(db, 'brew_schedule_configs')).toBe(0);
  db.sqlite.exec('DROP TRIGGER reject_capture');
  at += 60_000;
  await processor(db).capture();
  await processor(db).drain();
  expect(scheduledIssue(db).generatedAt).toBe(new Date(baseline).toISOString());
});

it('recovers a lost capture claim after expiry and fences superseded configuration reads and commits', async () => {
  const db = database();
  const { storage } = fixture(db);
  const jobs = new NodeScheduledBrewJobs(db),
    begin = jobs.beginCapture.bind(jobs);
  let original: ReturnType<typeof begin>;
  vi.spyOn(jobs, 'beginCapture').mockImplementationOnce((...args) => {
    original = begin(...args);
    throw new Error('lost capture claim');
  });
  await expect(processor(db, jobs).capture()).rejects.toThrow('lost capture claim');
  expect(jobs.beginCapture('busy', at, at + SCHEDULE_LEASE_MS)).toBeNull();
  db.sqlite.prepare("UPDATE brew_configs SET name='Changed after lost claim'").run();
  at += SCHEDULE_LEASE_MS + 1;
  const current = jobs.beginCapture('new', at, at + SCHEDULE_LEASE_MS)!;
  expect(() => jobs.captureConfigs(original!, 2, at)).toThrow(ScheduleLeaseLost);
  expect(() => jobs.commitCapture(original!, null, [], at, at + SCHEDULE_LEASE_MS)).toThrow(
    ScheduleLeaseLost,
  );
  jobs.releaseCapture(original!);
  expect(jobs.captureConfigs(current, 2, at)[0]!.config.name).toBe('Scheduled');
  jobs.releaseCapture(current);
  await processor(db).capture();
  await processor(db).drain();
  expect(scheduledIssue(db).configName).toBe('Scheduled');
  expect(storage.setting('brew:schedule:through')).toBe(String(baseline));
});

it.each([1, 2, 31])(
  'preserves longest ordering, ties and counts with candidate pages of %i',
  async (size) => {
    const db = database();
    fixture(db, {
      sections: [
        {
          ...newBrewSection('rank'),
          onlyUnread: false,
          sort: 'longest',
          maxItems: 2,
          sources: [
            { kind: 'feed', id: 1 },
            { kind: 'feed', id: 1 },
          ],
          filter: {
            match: 'all',
            conditions: [{ field: 'title', operator: 'contains', value: 'Rank' }],
          },
        },
      ],
    });
    const insert = db.sqlite.prepare(
      "INSERT INTO articles(id,feed_id,guid,hash,url,title,content_html,published_at) VALUES(?,1,?,?,'https://source.test/rank',?,?,?)",
    );
    for (const [id, body] of [
      [10, '<p>&amp;</p>'],
      [11, '<p>😀😀</p>'],
      [12, '<p>xxxxx</p>'],
    ] as const)
      insert.run(id, String(id), String(id), `Rank ${id}`, body, at - 1000);
    const jobs = new NodeScheduledBrewJobs(db);
    const pages = vi.spyOn(jobs, 'candidates');
    const work = processor(db, jobs, {}, { remaining: Infinity, candidatePageSize: size });
    await work.capture();
    await work.drain();
    const section = scheduledIssue(db).sections[0]!;
    expect(section).toMatchObject({ eligibleItems: 4, matchingItems: 3 });
    expect(section.items.map((row) => row.id)).toEqual([12, 10]);
    expect(pages.mock.results.every((result) => result.value.length <= size)).toBe(true);
    expect(pages.mock.results.reduce((sum, result) => sum + result.value.length, 0)).toBe(4);
    expect(count(db, 'brew_schedule_candidates')).toBe(0);
  },
);

it('keeps a complete large source in SQL and only ranks and counts in the job cursor', async () => {
  const db = database();
  fixture(db, {
    sections: [
      {
        ...newBrewSection('large'),
        onlyUnread: false,
        depth: 'title',
        maxItems: 3,
        sources: [{ kind: 'feed', id: 1 }],
        filter: {
          match: 'all',
          conditions: [{ field: 'title', operator: 'contains', value: 'Keep' }],
        },
      },
    ],
  });
  const insert = db.sqlite.prepare(
    "INSERT INTO articles(feed_id,guid,hash,url,title,content_html,published_at) VALUES(1,?,?,'https://source.test/large',?,?,?)",
  );
  db.sqlite.transaction(() => {
    for (let i = 0; i < 1000; i++)
      insert.run(
        String(i),
        String(i),
        i % 3 ? 'Ignore' : `Keep ${i}`,
        `<p>${'x'.repeat(4096)}</p>`,
        at - i * 1000,
      );
  })();
  const jobs = new NodeScheduledBrewJobs(db);
  const pages = vi.spyOn(jobs, 'candidates');
  const work = processor(db, jobs, {}, { remaining: Infinity, candidatePageSize: 31 });
  await work.capture();
  await work.drain(1);
  expect(
    (
      db.sqlite
        .prepare('SELECT sum(length(snapshot_json)) AS bytes FROM brew_schedule_candidates')
        .get() as { bytes: number }
    ).bytes,
  ).toBeGreaterThan(4_000_000);
  let steps = 0,
    largest = 0;
  while (count(db, 'brew_schedule_jobs') && steps++ < 50) {
    largest = Math.max(
      largest,
      (
        db.sqlite.prepare('SELECT length(state_json) AS bytes FROM brew_schedule_jobs').get() as {
          bytes: number;
        }
      ).bytes,
    );
    await work.drain(1);
  }
  expect(steps).toBeLessThan(50);
  expect(largest).toBeLessThan(16_384);
  expect(scheduledIssue(db).sections[0]).toMatchObject({ eligibleItems: 1001, matchingItems: 334 });
  expect(scheduledIssue(db).sections[0]!.items.map((row) => row.id)).toEqual([2, 5, 8]);
  expect(Math.max(...pages.mock.results.map((result) => result.value.length))).toBe(31);
  expect(count(db, 'brew_schedule_candidates')).toBe(0);
});

it('captures the last overlapping source and retains its exact content after live deletion', async () => {
  const db = database();
  const { storage, id } = fixture(db, {
    sections: [
      {
        ...newBrewSection('overlap'),
        onlyUnread: false,
        depth: 'full',
        sources: [
          { kind: 'feed', id: 1 },
          { kind: 'feed', id: 1 },
        ],
      },
    ],
  });
  const work = processor(db);
  await work.capture();
  await work.drain(1);
  db.sqlite
    .prepare("UPDATE articles SET title='Second capture',content_html='<p>Second body.</p>'")
    .run();
  await work.drain(1);
  const expected = (
    await new BrewService(storage, clock, nodeRegex).previewComposition(
      storage.composition(id)!,
      id,
      new Date(at).toISOString(),
    )
  ).snapshot;
  db.sqlite.prepare('DELETE FROM articles').run();
  await processor(db).drain();
  expect(scheduledIssue(db)).toEqual({ ...expected, id: scheduledIssue(db).id });
  expect(scheduledIssue(db).sections[0]!.items[0]!.contentHtml).toContain('Second body.');
  expect(count(db, 'brew_schedule_candidates')).toBe(0);
});

it.each(['all', 'any'] as const)(
  'preserves decoded content filters and newsletter output with %s matching',
  async (match) => {
    const db = database();
    const { storage, id } = fixture(db, {
      sections: [
        {
          ...newBrewSection('content'),
          onlyUnread: false,
          depth: 'full',
          sources: [{ kind: 'feed', id: 1 }, { kind: 'newsletters' }],
          filter: {
            match,
            conditions: [
              { field: 'content', operator: 'contains', value: 'Alpha & Beta' },
              { field: 'title', operator: 'starts_with', value: 'Letter' },
            ],
          },
        },
      ],
    });
    db.sqlite.prepare("UPDATE articles SET content_html='<p>Alpha &amp; Beta RSS.</p>'").run();
    db.sqlite
      .prepare(
        "INSERT INTO feeds(id,url,title,kind) VALUES(2,'newsletter:letter@example.test','Letter sender','newsletter')",
      )
      .run();
    db.sqlite
      .prepare(
        "INSERT INTO articles(feed_id,guid,hash,url,title,content_html,cleaning_json,published_at) VALUES(2,'letter','letter','https://source.test/letter','Letter content','<p>Alpha &amp; Beta letter.</p>',?,?)",
      )
      .run(JSON.stringify({ trackers: 2, sponsorBlocks: 1, footerTrimmed: true }), at - 2000);
    const expected = (
      await new BrewService(storage, clock, nodeRegex).previewComposition(
        storage.composition(id)!,
        id,
        new Date(at).toISOString(),
      )
    ).snapshot;
    const work = processor(db, undefined, {}, { remaining: Infinity, candidatePageSize: 1 });
    await work.capture();
    await work.drain();
    expect(scheduledIssue(db)).toEqual({ ...expected, id: scheduledIssue(db).id });
    const section = scheduledIssue(db).sections[0]!;
    expect(section.matchingItems).toBe(match === 'all' ? 1 : 2);
    const letter = section.items.find((row) => row.feedId === 2)!;
    expect(letter.summaryHtml).toBe('<p>Alpha &amp; Beta letter.</p>');
    expect(letter.newsletter?.cleaning).toEqual({
      trackers: 2,
      sponsorBlocks: 1,
      footerTrimmed: true,
    });
  },
);

it('rolls a rejected SQL source snapshot back with its cursor, and retains a committed snapshot after a lost response', async () => {
  const db = database();
  fixture(db);
  const jobs = new NodeScheduledBrewJobs(db),
    work = processor(db, jobs);
  await work.capture();
  db.sqlite.exec(
    "CREATE TRIGGER reject_source BEFORE INSERT ON brew_schedule_candidates BEGIN SELECT RAISE(ABORT,'controlled source failure'); END",
  );
  await expect(work.drain(1)).rejects.toThrow('controlled source failure');
  expect(count(db, 'brew_schedule_candidates')).toBe(0);
  expect(
    JSON.parse(
      (
        db.sqlite.prepare('SELECT state_json FROM brew_schedule_jobs').get() as {
          state_json: string;
        }
      ).state_json,
    ).source,
  ).toBe(0);
  db.sqlite.exec('DROP TRIGGER reject_source');
  const capture = jobs.captureSource.bind(jobs);
  vi.spyOn(jobs, 'captureSource').mockImplementationOnce((...args) => {
    capture(...args);
    throw new Error('lost source response');
  });
  await expect(work.drain(1)).rejects.toThrow('lost source response');
  db.sqlite.prepare("UPDATE articles SET title='Changed after checkpoint'").run();
  await processor(db).drain();
  expect(scheduledIssue(db).sections[0]!.items[0]!.title).toBe('Scheduled story');
});

it.each(['before', 'after'])(
  'recovers a page checkpoint response lost %s commit without duplicate counts',
  async (timing) => {
    const db = database();
    fixture(db);
    const jobs = new NodeScheduledBrewJobs(db),
      work = processor(db, jobs);
    await work.capture();
    await work.drain(1);
    const checkpoint = jobs.checkpoint.bind(jobs);
    vi.spyOn(jobs, 'checkpoint').mockImplementationOnce((...args) => {
      if (timing === 'after') checkpoint(...args);
      throw new Error('lost page response');
    });
    await expect(work.drain(1)).rejects.toThrow('lost page response');
    await processor(db).drain();
    expect(scheduledIssue(db).sections[0]).toMatchObject({ eligibleItems: 1, matchingItems: 1 });
    expect(scheduledIssue(db).sections[0]!.items.map((row) => row.id)).toEqual([1]);
  },
);

it('migrates inline source snapshots and fences old bundles, including jobs enqueued after upgrade', async () => {
  const donor = database();
  const { storage } = fixture(donor);
  await processor(donor).capture();
  const request = (
    donor.sqlite.prepare('SELECT request_json FROM brew_schedule_jobs').get() as {
      request_json: string;
    }
  ).request_json;
  const candidate = storage.compositionItems({
    feedId: 1,
    onlyUnread: false,
    starred: false,
    featured: false,
    sort: 'newest',
  })[0]!;
  const file = join(tmpdir(), `brew-schedule-migration-${randomUUID()}.db`);
  files.push(file);
  const raw = new Database(file);
  try {
    raw.pragma('foreign_keys = ON');
    raw.exec('CREATE TABLE __brew_migrations(name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)');
    const directory = new URL('../../packages/db/migrations/', import.meta.url);
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith('.sql') && name < '0018')
      .sort()) {
      raw.exec(readFileSync(new URL(name, directory), 'utf8'));
      raw.prepare('INSERT INTO __brew_migrations VALUES(?,0)').run(name);
    }
    raw
      .prepare(
        "INSERT INTO brew_configs(id,name,enabled,sections_json) VALUES(1,'Old queue',0,'[]')",
      )
      .run();
    const state = JSON.stringify({
      phase: 'composition',
      index: 0,
      source: 1,
      candidates: [candidate],
      sections: [],
    });
    raw
      .prepare(
        'INSERT INTO brew_schedule_jobs(id,config_id,request_json,state_json,runner,expires_at,created_at) VALUES(?,1,?,?,?,?,?)',
      )
      .run('old', request, state, 'old-runner', at + SCHEDULE_LEASE_MS, at);
  } finally {
    raw.close();
  }
  const db = database(file);
  expect(
    db.sqlite
      .prepare('SELECT runner,expires_at,version,source_version FROM brew_schedule_jobs')
      .get(),
  ).toEqual({ runner: null, expires_at: 0, version: 1, source_version: 1 });
  expect(
    db.sqlite.prepare("UPDATE brew_schedule_jobs SET runner='old-bundle' WHERE id='old'").run()
      .changes,
  ).toBe(0);
  expect(db.sqlite.prepare('SELECT format FROM brew_schedule_candidates').get()).toEqual({
    format: 0,
  });
  await processor(db).drain();
  expect(scheduledIssue(db).sections[0]!.items[0]!.title).toBe(candidate.title);
  expect(count(db, 'brew_schedule_candidates')).toBe(0);
  const lateRequest = JSON.parse(request);
  lateRequest.receipt.value = new Date(at + 60_000).toISOString();
  lateRequest.receipt.key = `brew_composed_1_${lateRequest.receipt.value}`;
  db.sqlite
    .prepare(
      'INSERT INTO brew_schedule_jobs(id,config_id,request_json,state_json,created_at) VALUES(?,1,?,?,?)',
    )
    .run(
      'late',
      JSON.stringify(lateRequest),
      JSON.stringify({
        phase: 'composition',
        index: 0,
        source: 1,
        candidates: [{ ...candidate, title: 'Late old capture' }],
        sections: [],
      }),
      at,
    );
  const converted = JSON.parse(
    (
      db.sqlite.prepare("SELECT state_json FROM brew_schedule_jobs WHERE id='late'").get() as {
        state_json: string;
      }
    ).state_json,
  );
  expect(converted.candidates).toBeUndefined();
  expect(converted.selection.after).toBe(0);
  expect(
    db.sqlite.prepare("UPDATE brew_schedule_jobs SET runner='old-bundle' WHERE id='late'").run()
      .changes,
  ).toBe(0);
  await processor(db).drain();
  expect(scheduledIssue(db).sections[0]!.items[0]!.title).toBe('Late old capture');
  expect(count(db, 'brews')).toBe(2);
});

it('reopens SQLite after every source/section checkpoint and preserves manual preview, original minute and configuration', async () => {
  const file = join(tmpdir(), `brew-schedule-${randomUUID()}.db`);
  files.push(file);
  let db = database(file);
  const { storage, id } = fixture(db, {
    sections: [
      { ...newBrewSection('note', 'note'), note: '**A note** <script>bad()</script>' },
      {
        ...newBrewSection('stories'),
        onlyUnread: false,
        depth: 'full',
        sources: [
          { kind: 'feed', id: 1 },
          { kind: 'folder', id: 999 },
          { kind: 'feed', id: 1 },
        ],
      },
      { ...newBrewSection('excluded', 'note'), note: 'Wrong day', days: [1] },
      newBrewSection('divider', 'divider'),
    ],
  });
  const config = storage.composition(id)!;
  const expected = (
    await new BrewService(storage, clock, nodeRegex).previewComposition(
      config,
      id,
      new Date(at).toISOString(),
    )
  ).snapshot;
  await processor(db).capture();
  storage.updateComposition(id, { ...config, name: 'Changed later', enabled: false, sections: [] });
  at += 60_000;
  let iterations = 0;
  while (count(db, 'brew_schedule_jobs') && iterations++ < 30) {
    await processor(db).drain(1);
    close(db);
    db = database(file);
  }
  expect(iterations).toBeGreaterThan(5);
  expect(count(db, 'brew_schedule_jobs')).toBe(0);
  const issue = new NodeBrewStorage(db).snapshot(
    (db.sqlite.prepare('SELECT id FROM brews').get() as { id: number }).id,
  )!;
  expect(issue).toEqual({ ...expected, id: issue.id });
  expect(count(db, 'brews')).toBe(1);
  expect(db.sqlite.prepare('SELECT sent_json FROM brews').get()).toEqual({
    sent_json: JSON.stringify({
      version: 1,
      email: { status: 'disabled', attempts: 0 },
      webhook: { status: 'disabled', attempts: 0 },
    }),
  });
});

it('queues an entire due minute once and resumes every configuration after that minute has passed', async () => {
  const db = database();
  const { storage } = fixture(db);
  for (let i = 0; i < 11; i++)
    storage.createComposition({ ...storage.composition(1)!, name: `Queued ${i}` });
  const work = processor(db);
  await work.capture();
  await work.capture();
  expect(count(db, 'brew_schedule_jobs')).toBe(12);
  await work.drain(2);
  at += 10 * 60_000;
  await processor(db).capture();
  await processor(db).drain();
  expect(count(db, 'brew_schedule_jobs')).toBe(0);
  expect(count(db, 'brews')).toBe(12);
  expect(
    db.sqlite
      .prepare('SELECT min(generated_at) AS first,max(generated_at) AS last FROM brews')
      .get(),
  ).toEqual({ first: baseline, last: baseline });
  await processor(db).capture();
  await processor(db).drain();
  expect(count(db, 'brews')).toBe(12);
});

it('rolls back enqueue with its watermark and recovers that missed minute on a later capture', async () => {
  const db = database();
  const { storage } = fixture(db);
  storage.createComposition({ ...storage.composition(1)!, name: 'Second' });
  db.sqlite
    .prepare(
      "CREATE TRIGGER reject_schedule BEFORE INSERT ON brew_schedule_jobs WHEN NEW.config_id=2 BEGIN SELECT RAISE(ABORT,'controlled queue failure'); END",
    )
    .run();
  await expect(processor(db).capture()).rejects.toThrow('controlled queue failure');
  expect(count(db, 'brew_schedule_jobs')).toBe(0);
  expect(new NodeBrewStorage(db).setting('brew:schedule:through')).toBe(String(baseline - 60_000));
  db.sqlite.prepare('DROP TRIGGER reject_schedule').run();
  at += 60_000;
  await processor(db).capture();
  await processor(db).drain();
  expect(count(db, 'brews')).toBe(2);
  expect(count(db, 'brew_schedule_jobs')).toBe(0);
});

it('advances downtime discovery one day at a time without creating issues before a configuration existed', async () => {
  const db = database();
  fixture(db);
  db.sqlite.prepare('UPDATE brew_configs SET created_at=?').run(baseline - 86_400_000);
  await processor(db).capture();
  await processor(db).drain();
  at += 3 * 86_400_000;
  const brew = new NodeBrewStorage(db);
  const added = brew.createComposition({ ...brew.composition(1)!, name: 'New after downtime' });
  db.sqlite.prepare('UPDATE brew_configs SET created_at=? WHERE id=?').run(at, added);
  for (let i = 0; i < 3; i++) {
    await processor(db).capture();
    await processor(db).drain();
    expect(brew.historyIds(added)).toHaveLength(1);
  }
  expect(count(db, 'brews')).toBe(5);
  expect(new NodeBrewStorage(db).setting('brew:schedule:through')).toBe(String(at));
  await processor(db).capture();
  await processor(db).drain();
  expect(count(db, 'brews')).toBe(5);
});

it('uses the shared zoned/skip/legacy policies and cancels queued work when its configuration is deleted', async () => {
  const db = database();
  const { storage } = fixture(db, {
    timezone: 'Asia/Dhaka',
    schedule: { kind: 'weekly', days: [5], time: '18:00', skipIfFewerThan: 2 },
  });
  storage.create({
    name: 'Legacy',
    enabled: true,
    scheduleCron: `${new Date(at).getMinutes()} ${new Date(at).getHours()} * * *`,
    sections: [],
  });
  const cancelled = storage.createComposition({ ...storage.composition(1)!, name: 'Cancelled' });
  await processor(db).capture();
  expect(count(db, 'brew_schedule_jobs')).toBe(3);
  storage.delete(cancelled);
  await processor(db).drain();
  expect(count(db, 'brews')).toBe(1);
  expect(
    (db.sqlite.prepare('SELECT payload_json FROM brews').get() as { payload_json: string })
      .payload_json,
  ).toContain('Legacy');
  expect(count(db, 'brew_schedule_jobs')).toBe(0);
  await processor(db).capture();
  await processor(db).drain();
  expect(count(db, 'brews')).toBe(1);
});

it('fences expired runners and recovers their queued source work', async () => {
  const db = database();
  fixture(db);
  const jobs = new NodeScheduledBrewJobs(db);
  await processor(db).capture();
  const old = jobs.claim('old', at, at + SCHEDULE_LEASE_MS)!;
  at += SCHEDULE_LEASE_MS + 1;
  const current = jobs.claim('current', at, at + SCHEDULE_LEASE_MS)!;
  expect(() => jobs.checkpoint(old, old.state, at, at + SCHEDULE_LEASE_MS)).toThrow(
    ScheduleLeaseLost,
  );
  expect(() =>
    jobs.freeze(old, { configName: 'stale', sections: [] }, at, at + SCHEDULE_LEASE_MS),
  ).toThrow(ScheduleLeaseLost);
  jobs.release(old.id, old.runner);
  expect(
    (db.sqlite.prepare('SELECT runner FROM brew_schedule_jobs').get() as { runner: string }).runner,
  ).toBe(current.runner);
  jobs.release(current.id, current.runner);
  await processor(db).drain();
  expect(count(db, 'brews')).toBe(1);
});

it('recovers a lost freeze acknowledgement without allocating a second issue or sending twice', async () => {
  const db = database();
  fixture(db, { delivery: { ...defaultDelivery(), webhook: { url: `${endpoint}/ok` } } });
  const jobs = new NodeScheduledBrewJobs(db);
  const freeze = jobs.freeze.bind(jobs);
  vi.spyOn(jobs, 'freeze').mockImplementationOnce((...args) => {
    freeze(...args);
    throw new Error('lost freeze acknowledgement');
  });
  await processor(db, jobs).capture();
  await expect(processor(db, jobs).drain()).rejects.toThrow('lost freeze');
  expect(count(db, 'brews')).toBe(1);
  expect(calls).toHaveLength(0);
  await processor(db).drain();
  await processor(db).drain();
  expect(count(db, 'brews')).toBe(1);
  expect(calls).toHaveLength(1);
  const issue = new NodeBrewStorage(db).snapshot(
    (db.sqlite.prepare('SELECT id FROM brews').get() as { id: number }).id,
  )!;
  expect(calls[0]!.key).toBe(`https://brew.test/b/${issue.brewConfigId}/1`);
  expect(calls[0]!.body).toContain('Scheduled story');
});

it('resumes a claimed channel whose first attempt never committed, then sends exactly once', async () => {
  const db = database();
  fixture(db, { delivery: { ...defaultDelivery(), webhook: { url: `${endpoint}/ok` } } });
  const jobs = new NodeScheduledBrewJobs(db);
  vi.spyOn(jobs, 'saveDelivery').mockImplementationOnce(() => {
    throw new Error('attempt marker did not commit');
  });
  await processor(db, jobs).capture();
  await expect(processor(db, jobs).drain()).rejects.toThrow('attempt marker did not commit');
  expect(calls).toHaveLength(0);
  const id = (db.sqlite.prepare('SELECT id FROM brews').get() as { id: number }).id;
  expect(new NodeBrewStorage(db).deliveryResults(id)!.webhook).toMatchObject({
    status: 'pending',
    attempts: 0,
  });
  await processor(db).drain();
  await processor(db).drain();
  expect(calls).toHaveLength(1);
  expect(new NodeBrewStorage(db).deliveryResults(id)!.webhook).toMatchObject({
    status: 'sent',
    attempts: 1,
    httpStatus: 204,
  });
  expect(count(db, 'brew_schedule_jobs')).toBe(0);
});

it.each(['before', 'after'] as const)(
  'does not resend after a provider succeeds and its result checkpoint fails %s commit',
  async (timing) => {
    const db = database();
    fixture(db, { delivery: { ...defaultDelivery(), webhook: { url: `${endpoint}/ok` } } });
    const jobs = new NodeScheduledBrewJobs(db);
    const save = jobs.saveDelivery.bind(jobs);
    let failed = false;
    vi.spyOn(jobs, 'saveDelivery').mockImplementation((...args) => {
      if (!failed && args[2].webhook.status === 'sent') {
        failed = true;
        if (timing === 'after') save(...args);
        throw new Error('lost delivery result');
      }
      save(...args);
    });
    await processor(db, jobs).capture();
    await expect(processor(db, jobs).drain()).rejects.toThrow('lost delivery');
    expect(calls).toHaveLength(1);
    await processor(db).drain();
    await processor(db).drain();
    expect(calls).toHaveLength(1);
    expect(count(db, 'brew_schedule_jobs')).toBe(0);
    const results = new NodeBrewStorage(db).deliveryResults(
      (db.sqlite.prepare('SELECT id FROM brews').get() as { id: number }).id,
    )!;
    expect(results.webhook).toMatchObject(
      timing === 'before'
        ? { status: 'failed', error: 'interrupted', attempts: 1 }
        : { status: 'sent', httpStatus: 204, attempts: 1 },
    );
  },
);

it('records two real provider rejections without turning a quota yield into a provider failure', async () => {
  const db = database();
  fixture(db, { delivery: { ...defaultDelivery(), webhook: { url: `${endpoint}/fail` } } });
  await processor(db).capture();
  await processor(db).drain();
  expect(calls).toHaveLength(2);
  const results = new NodeBrewStorage(db).deliveryResults(
    (db.sqlite.prepare('SELECT id FROM brews').get() as { id: number }).id,
  )!;
  expect(results.webhook).toMatchObject({
    status: 'failed',
    error: 'http',
    httpStatus: 503,
    attempts: 2,
  });
});

it('rechecks the delivery lease before writing an attempt or provider result', async () => {
  const db = database();
  fixture(db);
  const jobs = new NodeScheduledBrewJobs(db);
  await processor(db).capture();
  for (let step = 0; step < 10; step++) {
    const row = db.sqlite.prepare('SELECT state_json FROM brew_schedule_jobs').get() as {
      state_json: string;
    };
    if (JSON.parse(row.state_json).phase === 'delivery') break;
    await processor(db).drain(1);
  }
  const old = jobs.claim('old', at, at + SCHEDULE_LEASE_MS)!;
  expect(old.state.phase).toBe('delivery');
  at += SCHEDULE_LEASE_MS + 1;
  const current = jobs.claim('replacement', at, at + SCHEDULE_LEASE_MS)!;
  const result = {
    version: 1 as const,
    email: { status: 'disabled' as const, attempts: 0 },
    webhook: { status: 'pending' as const, attempts: 0 },
  };
  const id = (old.state as Extract<ScheduledBrewJob['state'], { phase: 'delivery' }>).issueId;
  expect(() => jobs.claimDelivery(old, id, result, at)).toThrow(ScheduleLeaseLost);
  expect(() => jobs.saveDelivery(old, id, result, at)).toThrow(ScheduleLeaseLost);
  expect(new NodeBrewStorage(db).deliveryResults(id)).toBeNull();
  jobs.release(current.id, current.runner);
  await processor(db).drain();
  expect(count(db, 'brew_schedule_jobs')).toBe(0);
});

it('waits for every live channel before releasing a failed delivery lease', async () => {
  const db = database();
  fixture(db, {
    delivery: {
      ...defaultDelivery(),
      email: { to: 'owner@example.test' },
      webhook: { url: `${endpoint}/hold` },
    },
  });
  const jobs = new NodeScheduledBrewJobs(db),
    save = jobs.saveDelivery.bind(jobs);
  let failed = false,
    settled = false;
  vi.spyOn(jobs, 'saveDelivery').mockImplementation((...args) => {
    if (args[2].email.status === 'failed') {
      failed = true;
      throw new Error('lost channel result');
    }
    save(...args);
  });
  const work = processor(db, jobs, {
    mail: {
      kind: 'smtp',
      send: async () => {
        await vi.waitFor(() => expect(calls).toHaveLength(1));
        throw new Error('controlled mail outage');
      },
    },
  });
  await work.capture();
  const pending = work.drain().then(
    () => {
      settled = true;
      return null;
    },
    (error) => {
      settled = true;
      return error as Error;
    },
  );
  await vi.waitFor(() => expect(failed).toBe(true));
  expect(settled).toBe(false);
  expect(
    (db.sqlite.prepare('SELECT runner FROM brew_schedule_jobs').get() as { runner: string | null })
      .runner,
  ).not.toBeNull();
  releaseHeld!();
  expect((await pending)?.message).toContain('lost channel result');
  expect(
    (db.sqlite.prepare('SELECT runner FROM brew_schedule_jobs').get() as { runner: string | null })
      .runner,
  ).toBeNull();
  await processor(db).drain();
  expect(calls).toHaveLength(1);
  expect(count(db, 'brew_schedule_jobs')).toBe(0);
});

it('recovers queued Brews at real Node application startup and captures another due Brew on its background timer', async () => {
  const db = database();
  const { storage } = fixture(db);
  await processor(db).capture();
  await processor(db).drain(1);
  at += 60_000;
  const start = vi.spyOn(PollerService.prototype, 'start').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp({ database: db, clock, startPoller: true, logger: false });
    expect(count(db, 'brew_schedule_jobs')).toBe(0);
    expect(count(db, 'brews')).toBe(1);
    storage.createComposition({
      ...storage.composition(1)!,
      name: 'Timer created',
      schedule: { kind: 'daily', time: '12:01' },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count(db, 'brew_schedule_jobs')).toBe(0);
    expect(count(db, 'brews')).toBe(2);
    expect(db.sqlite.prepare('SELECT generated_at FROM brews ORDER BY generated_at').all()).toEqual(
      [{ generated_at: baseline }, { generated_at: at }],
    );
  } finally {
    if (app) {
      await app.close();
      databases.delete(db);
    }
    vi.useRealTimers();
    start.mockRestore();
  }
});
