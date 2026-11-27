import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { openDatabase, type BrewDatabase } from '../../targets/node/src/db/database.js';
import { NodeBrewStorage } from '../../targets/node/src/ports/brew-storage.js';
import { NodeScheduledBrewJobs } from '../../targets/node/src/ports/brew-scheduled-jobs.js';
import {
  ScheduledBrewProcessor,
  ScheduleLeaseLost,
  SCHEDULE_LEASE_MS,
  type ScheduledBrewJob,
} from '../../packages/core/src/brew-scheduled-processing.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';
import { BrewService } from '../../packages/core/src/brew-service.js';
import { nodeRegex } from '../../targets/node/src/ports/runtime.js';
import type { BrewConfigDraft } from '../../packages/core/src/types/brew.js';
import type { BrewDeliveryOptions } from '../../packages/core/src/types/delivery.js';
import { createApp } from '../../targets/node/src/app.js';
import { PollerService } from '../../targets/node/src/services/poller-service.js';

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
) {
  return new ScheduledBrewProcessor(
    jobs,
    new NodeBrewStorage(db),
    clock,
    nodeRegex,
    { fetcher: fetch, baseUrl: 'https://brew.test', ...delivery },
    () => randomUUID(),
  );
}
function count(db: BrewDatabase, table: string) {
  return (db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

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
  ).toBe('current');
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
  await processor(db).drain(3);
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
