import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { readdir, readFile } from 'node:fs/promises';
import type { D1Database } from '@cloudflare/workers-types';
import { CloudflareStorage } from './src/storage.js';
import { CloudflareBrewStorage } from './src/brew-storage.js';
import { AsyncBrewService } from '../../packages/core/src/async-brew-service.js';
import { BrewService } from '../../packages/core/src/brew-service.js';
import { NodeBrewStorage } from '../node/src/ports/brew-storage.js';
import { openDatabase } from '../node/src/db/database.js';
import {
  defaultDelivery,
  newBrewSection,
  BREW_RETENTION_DAYS,
} from '../../packages/core/src/composition-model.js';
import type { BrewConfigDraft } from '../../packages/core/src/types/brew.js';
import {
  ScheduledBrewProcessor,
  ScheduleLeaseLost,
  SCHEDULE_LEASE_MS,
} from '../../packages/core/src/brew-scheduled-processing.js';
import { CloudflareScheduledBrewJobs } from './src/brew-scheduled-jobs.js';
import { nodeRegex } from '../node/src/ports/runtime.js';

const runtime = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("schedule fixture"); } };',
  compatibilityDate: '2026-07-01',
  d1Databases: ['DB'],
});
let database: D1Database;
let storage: CloudflareStorage;
const now = new Date('2026-11-27T12:00:00Z');
const clock = { now: () => now, monotonic: () => 0 };
const cutoff = now.getTime() - BREW_RETENTION_DAYS * 86_400_000;

beforeAll(async () => {
  database = (await runtime.getD1Database('DB')) as unknown as D1Database;
  const directory = new URL('../../packages/db/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    await database.batch(
      unstable_splitSqlQuery(await readFile(new URL(name, directory), 'utf8')).map((sql) =>
        database.prepare(sql),
      ),
    );
  }
}, 30_000);
beforeEach(async () => {
  storage = new CloudflareStorage(database);
  await storage.batch(
    [
      'DROP TRIGGER IF EXISTS history_failure',
      'DROP TRIGGER IF EXISTS freeze_failure',
      'DROP TRIGGER IF EXISTS source_failure',
      'DELETE FROM brew_configs',
      'DELETE FROM settings',
      "DELETE FROM sqlite_sequence WHERE name IN ('brew_configs','brews')",
    ].map((sql) => storage.statement(sql)),
  );
});

function pendingProcessor(value = storage, jobs = new CloudflareScheduledBrewJobs(value)) {
  return new ScheduledBrewProcessor(jobs, new CloudflareBrewStorage(value), clock, nodeRegex);
}
it('atomically stores the frozen issue, receipt and delivery cursor after a lost native D1 acknowledgement', async () => {
  await new CloudflareBrewStorage(storage).createComposition(
    draft('Queued', { kind: 'daily', time: '12:00' }),
  );
  const jobs = new CloudflareScheduledBrewJobs(storage),
    freeze = jobs.freeze.bind(jobs);
  vi.spyOn(jobs, 'freeze').mockImplementationOnce(async (...args) => {
    await freeze(...args);
    throw new Error('lost native freeze response');
  });
  const work = pendingProcessor(storage, jobs);
  await work.capture();
  await expect(work.drain()).rejects.toThrow('lost native freeze');
  const row = await storage.first<{ state_json: string }>(
    'SELECT state_json FROM brew_schedule_jobs',
  );
  expect(JSON.parse(row!.state_json)).toMatchObject({
    phase: 'delivery',
    started: false,
    issueId: 1,
  });
  expect(await storage.first('SELECT count(*) AS n FROM brews')).toEqual({ n: 1 });
  await pendingProcessor().capture();
  await pendingProcessor().drain();
  expect(await storage.first('SELECT count(*) AS n FROM brew_schedule_jobs')).toEqual({ n: 0 });
  expect(await storage.first('SELECT count(*) AS n FROM brews')).toEqual({ n: 1 });
});

it('rolls back a native freeze failure with its receipt, issue counter and pending cursor', async () => {
  await new CloudflareBrewStorage(storage).createComposition(
    draft('Rollback', { kind: 'daily', time: '12:00' }),
  );
  await pendingProcessor().capture();
  await storage.run(
    "CREATE TRIGGER freeze_failure BEFORE INSERT ON brews BEGIN SELECT RAISE(ABORT,'controlled freeze failure'); END",
  );
  await expect(pendingProcessor().drain()).rejects.toThrow('controlled freeze failure');
  expect(await storage.first('SELECT count(*) AS n FROM brews')).toEqual({ n: 0 });
  expect(
    await storage.first(
      "SELECT value FROM settings WHERE key LIKE 'brew_composed_%' OR key LIKE 'brew_issue_number_%'",
    ),
  ).toBeNull();
  expect(await storage.first('SELECT count(*) AS n FROM brew_schedule_jobs')).toEqual({ n: 1 });
  expect(await storage.first('SELECT count(*) AS n FROM brew_schedule_guard')).toEqual({ n: 0 });
  await storage.run('DROP TRIGGER freeze_failure');
  await pendingProcessor().drain();
  expect(await storage.first('SELECT issue_number FROM brews')).toEqual({ issue_number: 1 });
  expect(await storage.first('SELECT count(*) AS n FROM brew_schedule_jobs')).toEqual({ n: 0 });
});

it('fences native old runners before source, freeze and delivery writes', async () => {
  await new CloudflareBrewStorage(storage).createComposition(
    draft('Lease', { kind: 'daily', time: '12:00' }),
  );
  await pendingProcessor().capture();
  const jobs = new CloudflareScheduledBrewJobs(storage);
  const old = (await jobs.claim('old', now.getTime(), now.getTime() + SCHEDULE_LEASE_MS))!;
  const later = now.getTime() + SCHEDULE_LEASE_MS + 1;
  const replacement = (await jobs.claim('replacement', later, later + SCHEDULE_LEASE_MS))!;
  await expect(jobs.checkpoint(old, old.state, later, later + SCHEDULE_LEASE_MS)).rejects.toThrow(
    ScheduleLeaseLost,
  );
  await expect(
    jobs.captureSource(
      old,
      { feedId: 1, onlyUnread: false, starred: false, featured: false, sort: 'newest' },
      later,
      old.state,
      later,
      later + SCHEDULE_LEASE_MS,
    ),
  ).rejects.toThrow(ScheduleLeaseLost);
  await expect(jobs.candidates(old, 0, 4, true, later)).rejects.toThrow(ScheduleLeaseLost);
  await expect(
    jobs.freeze(old, { configName: 'Stale', sections: [] }, later, later + SCHEDULE_LEASE_MS),
  ).rejects.toThrow(ScheduleLeaseLost);
  await expect(
    jobs.claimDelivery(
      old,
      1,
      {
        version: 1,
        email: { status: 'disabled', attempts: 0 },
        webhook: { status: 'pending', attempts: 0 },
      },
      later,
    ),
  ).rejects.toThrow(ScheduleLeaseLost);
  await jobs.release(old.id, old.runner);
  expect(await storage.first('SELECT runner FROM brew_schedule_jobs')).toEqual({
    runner: replacement.runner,
  });
  await jobs.release(replacement.id, replacement.runner);
  await pendingProcessor().drain();
  expect(await storage.first('SELECT count(*) AS n FROM brews')).toEqual({ n: 1 });
});

it('rolls back native source materialization with its cursor and preserves captured rows after deletion', async () => {
  const brew = new CloudflareBrewStorage(storage);
  const id = await brew.createComposition({
    ...draft('Source rollback', { kind: 'daily', time: '12:00' }),
    sections: [
      { ...newBrewSection('stories'), onlyUnread: false, sources: [{ kind: 'feed', id: 991 }] },
    ],
  });
  await storage.run(
    "INSERT INTO feeds(id,url,title) VALUES(991,'https://source.test/native-snapshot','Native snapshot')",
  );
  try {
    await storage.run(
      "INSERT INTO articles(feed_id,guid,hash,url,title,content_html,published_at) VALUES(991,'snapshot','snapshot','https://source.test/snapshot','Captured native story','<p>Snapshot body.</p>',?)",
      [now.getTime() - 1000],
    );
    await pendingProcessor().capture();
    await storage.run(
      "CREATE TRIGGER source_failure BEFORE INSERT ON brew_schedule_candidates BEGIN SELECT RAISE(ABORT,'controlled native source failure'); END",
    );
    await expect(pendingProcessor().drain(1)).rejects.toThrow('controlled native source failure');
    expect(await storage.first('SELECT count(*) AS n FROM brew_schedule_candidates')).toEqual({
      n: 0,
    });
    expect(
      JSON.parse(
        (await storage.first<{ state_json: string }>('SELECT state_json FROM brew_schedule_jobs'))!
          .state_json,
      ).source,
    ).toBe(0);
    await storage.run('DROP TRIGGER source_failure');
    await pendingProcessor().drain(1);
    await storage.run('DELETE FROM articles WHERE feed_id=991');
    await pendingProcessor().drain();
    const issue = await brew.snapshot((await brew.historyIds(id))[0]!);
    expect(issue!.sections[0]!.items[0]!.title).toBe('Captured native story');
    expect(await storage.first('SELECT count(*) AS n FROM brew_schedule_candidates')).toEqual({
      n: 0,
    });
  } finally {
    await storage.run('DELETE FROM feeds WHERE id=991');
  }
});

it('marks an interrupted native delivery unknown without sending its claimed issue again', async () => {
  const brew = new CloudflareBrewStorage(storage);
  await brew.createComposition({
    ...draft('Unknown', { kind: 'daily', time: '12:00' }),
    delivery: { ...defaultDelivery(), webhook: { url: 'https://source.test/webhook' } },
  });
  await pendingProcessor().capture();
  await pendingProcessor().drain(2);
  const jobs = new CloudflareScheduledBrewJobs(storage),
    at = now.getTime();
  const job = (await jobs.claim('interrupted', at, at + SCHEDULE_LEASE_MS))!;
  expect(job.state.phase).toBe('delivery');
  if (job.state.phase !== 'delivery') throw new Error('Missing frozen issue.');
  const state = { ...job.state, started: true };
  await jobs.checkpoint(job, state, at, at + SCHEDULE_LEASE_MS);
  job.version++;
  job.state = state;
  await jobs.claimDelivery(
    job,
    state.issueId,
    {
      version: 1,
      email: { status: 'disabled', attempts: 0 },
      webhook: { status: 'pending', attempts: 1, attemptedAt: now.toISOString() },
    },
    at,
  );
  await jobs.release(job.id, job.runner);
  let sends = 0;
  await new ScheduledBrewProcessor(jobs, brew, clock, nodeRegex, {
    fetcher: async () => {
      sends++;
      throw new Error('Unexpected replay');
    },
  }).drain();
  expect(sends).toBe(0);
  expect((await brew.deliveryResults(state.issueId))!.webhook).toMatchObject({
    status: 'failed',
    error: 'interrupted',
    attempts: 1,
  });
  expect(await storage.first('SELECT count(*) AS n FROM brew_schedule_jobs')).toEqual({ n: 0 });
});
afterAll(async () => runtime.dispose());

async function configs(count: number) {
  await storage.run(
    `WITH RECURSIVE numbers(id) AS
    (SELECT 1 UNION ALL SELECT id+1 FROM numbers WHERE id<?)
    INSERT INTO brew_configs(id,name,enabled,composition_version,schedule_cron,schedule_json)
    SELECT id,'Brew '||id,1,CASE WHEN id%2=0 THEN 2 ELSE 1 END,'0 23 * * *',
      '{"kind":"daily","time":"23:00"}' FROM numbers`,
    [count],
  );
}
async function oldIssues(count: number) {
  await storage.run(
    `WITH RECURSIVE numbers(id) AS
    (SELECT 1 UNION ALL SELECT id+1 FROM numbers WHERE id<?)
    INSERT INTO brews(id,brew_config_id,issue_number,generated_at,payload_json)
    SELECT id,2,id,0,'{"configName":"Old","sections":[]}' FROM numbers`,
    [count],
  );
}
const draft = (
  name: string,
  schedule: BrewConfigDraft['schedule'],
  timezone = 'UTC',
): BrewConfigDraft => ({
  name,
  enabled: true,
  timezone,
  schedule,
  delivery: defaultDelivery(),
  sections: [{ ...newBrewSection('note', 'note'), note: 'Scheduled note.' }],
});

it('runs the shared scheduler over 400 non-due mixed configurations using one D1 batch and no per-config queries', async () => {
  await configs(400);
  const calls = {
    batch: vi.spyOn(storage, 'batch'),
    first: vi.spyOn(storage, 'first'),
    all: vi.spyOn(storage, 'all'),
    run: vi.spyOn(storage, 'run'),
  };
  const scoped = await CloudflareBrewStorage.scheduled(storage, now);
  const service = new AsyncBrewService(scoped, clock);
  expect(await service.runScheduled()).toBe(0);
  expect(await service.runCompositionScheduled()).toBe(0);
  expect(calls.batch).toHaveBeenCalledTimes(1);
  for (const method of [calls.first, calls.all, calls.run]) expect(method).not.toHaveBeenCalled();
  Object.values(calls).forEach((method) => method.mockRestore());
  expect(await storage.first('SELECT count(*) AS count FROM brews')).toEqual({ count: 0 });
});

it('keeps configuration snapshots within one invocation, returns independent values, and leaves ordinary reads live', async () => {
  await configs(2);
  const first = await CloudflareBrewStorage.scheduled(storage, now);
  const value = (await first.composition(2))!;
  value.schedule.time = '01:00';
  expect((await first.composition(2))!.schedule.time).toBe('23:00');
  await storage.run("UPDATE brew_configs SET name='Edited',composition_version=1 WHERE id=2");
  expect((await first.composition(2))!.name).toBe('Brew 2');
  expect(await first.usesComposition(2)).toBe(true);
  const next = await CloudflareBrewStorage.scheduled(new CloudflareStorage(database), now);
  expect((await next.composition(2))!.name).toBe('Edited');
  expect(await next.usesComposition(2)).toBe(false);
  expect((await new CloudflareBrewStorage(storage).composition(2))!.name).toBe('Edited');
  expect(await next.composition(999)).toBeNull();
  expect(await next.usesComposition(999)).toBe(false);
});

it('continues 1002 expired issues over bounded pages, retains legacy/boundary history and preserves issue numbers after all old rows disappear', async () => {
  await configs(4);
  await oldIssues(1001);
  await storage.batch([
    storage.statement('UPDATE brew_configs SET enabled=0'),
    storage.statement(
      `INSERT INTO brews(brew_config_id,issue_number,generated_at,payload_json)
      VALUES(4,12,0,'{}'),(1,900,0,'{}'),(2,1002,?,'{}'),(2,1003,?,'{}')`,
      [cutoff, now.getTime()],
    ),
    storage.statement("INSERT INTO settings(key,value) VALUES('brew_issue_number_2','corrupt')"),
  ]);
  for (const expected of [505, 5, 3]) {
    const invocation = new CloudflareStorage(database);
    const calls = vi.spyOn(invocation, 'batch');
    await CloudflareBrewStorage.scheduled(invocation, now);
    expect(calls).toHaveBeenCalledTimes(2);
    expect(await storage.first('SELECT count(*) AS count FROM brews')).toEqual({ count: expected });
  }
  expect(await storage.all('SELECT brew_config_id,issue_number FROM brews ORDER BY id')).toEqual([
    { brew_config_id: 1, issue_number: 900 },
    { brew_config_id: 2, issue_number: 1002 },
    { brew_config_id: 2, issue_number: 1003 },
  ]);
  expect(
    await storage.all(
      "SELECT key,value FROM settings WHERE key LIKE 'brew_issue_number_%' ORDER BY key",
    ),
  ).toEqual([
    { key: 'brew_issue_number_2', value: '1003' },
    { key: 'brew_issue_number_4', value: '12' },
  ]);
  const ordinary = new CloudflareBrewStorage(storage);
  await ordinary.save(4, { configName: 'After prune', sections: [] });
  expect(await ordinary.nextIssueNumber(4)).toBe(14);
});

it('rolls back retained counters and history together when pruning fails, then retries the same oldest page', async () => {
  await configs(2);
  await oldIssues(3);
  await storage.run(`CREATE TRIGGER history_failure BEFORE DELETE ON brews
    WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'history test failure'); END`);
  await expect(CloudflareBrewStorage.scheduled(storage, now)).rejects.toThrow();
  expect(await storage.first('SELECT count(*) AS count FROM brews')).toEqual({ count: 3 });
  expect(
    await storage.first("SELECT value FROM settings WHERE key='brew_issue_number_2'"),
  ).toBeNull();
  await storage.run('DROP TRIGGER history_failure');
  await CloudflareBrewStorage.scheduled(new CloudflareStorage(database), now);
  expect(await storage.first('SELECT count(*) AS count FROM brews')).toEqual({ count: 0 });
  expect(await new CloudflareBrewStorage(storage).nextIssueNumber(2)).toBe(4);
});

it('rechecks kind, expiry and configuration existence inside the pruning transaction', async () => {
  await configs(6);
  await storage.run(
    "INSERT INTO brews(brew_config_id,issue_number,generated_at,payload_json) VALUES(2,7,0,'{}'),(4,8,0,'{}'),(6,9,0,'{}')",
  );
  const realBatch = storage.batch.bind(storage);
  let calls = 0;
  vi.spyOn(storage, 'batch').mockImplementation(async (statements) => {
    if (++calls === 2)
      await realBatch([
        storage.statement('UPDATE brew_configs SET composition_version=1 WHERE id=2'),
        storage.statement('UPDATE brews SET generated_at=? WHERE brew_config_id=4', [
          now.getTime(),
        ]),
        storage.statement('DELETE FROM brew_configs WHERE id=6'),
      ]);
    return realBatch(statements);
  });
  await CloudflareBrewStorage.scheduled(storage, now);
  expect(await storage.all('SELECT brew_config_id FROM brews ORDER BY id')).toEqual([
    { brew_config_id: 2 },
    { brew_config_id: 4 },
  ]);
  expect(
    await storage.first("SELECT key FROM settings WHERE key='brew_issue_number_6'"),
  ).toBeNull();
});

it('preserves numbering through overlapping maintenance, then freezes unique consecutive issues', async () => {
  await configs(2);
  await oldIssues(503);
  await Promise.all([
    CloudflareBrewStorage.scheduled(new CloudflareStorage(database), now),
    CloudflareBrewStorage.scheduled(new CloudflareStorage(database), now),
  ]);
  await CloudflareBrewStorage.scheduled(new CloudflareStorage(database), now);
  const payload = { configName: 'Concurrent', sections: [] };
  await Promise.all([
    new CloudflareBrewStorage(new CloudflareStorage(database)).save(2, payload),
    new CloudflareBrewStorage(new CloudflareStorage(database)).save(2, payload),
  ]);
  expect(await storage.all('SELECT issue_number FROM brews ORDER BY issue_number')).toEqual([
    { issue_number: 504 },
    { issue_number: 505 },
  ]);
});

it('uses the same Node policy for zoned schedules, skip thresholds, disabled configurations and receipt replay', async () => {
  const nodeDatabase = openDatabase(':memory:');
  try {
    const nodeStorage = new NodeBrewStorage(nodeDatabase);
    const cloudStorage = new CloudflareBrewStorage(storage);
    const drafts = [
      draft('UTC', { kind: 'daily', time: '12:00' }),
      draft('Dhaka', { kind: 'weekly', days: [5], time: '18:00' }, 'Asia/Dhaka'),
      { ...draft('Skipped', { kind: 'daily', time: '12:00', skipIfFewerThan: 2 }) },
      { ...draft('Paused', { kind: 'daily', time: '12:00' }), enabled: false },
    ];
    for (const value of drafts) {
      nodeStorage.createComposition(value);
      await cloudStorage.createComposition(value);
    }
    const legacy = {
      name: 'Legacy',
      enabled: true,
      scheduleCron: `${now.getMinutes()} ${now.getHours()} * * *`,
      sections: [],
    };
    nodeStorage.create(legacy);
    await cloudStorage.create(legacy);
    const node = new BrewService(nodeStorage, clock);
    const cloud = new AsyncBrewService(await CloudflareBrewStorage.scheduled(storage, now), clock);
    expect(await cloud.runScheduled()).toBe(node.runScheduled());
    expect(await cloud.runCompositionScheduled()).toBe(await node.runCompositionScheduled());
    const expected = nodeDatabase.sqlite
      .prepare('SELECT brew_config_id,issue_number FROM brews ORDER BY brew_config_id')
      .all();
    expect(
      await storage.all('SELECT brew_config_id,issue_number FROM brews ORDER BY brew_config_id'),
    ).toEqual(expected);
    expect(expected).toHaveLength(3);
    const replay = new AsyncBrewService(
      await CloudflareBrewStorage.scheduled(new CloudflareStorage(database), now),
      clock,
    );
    expect(await replay.runScheduled()).toBe(0);
    expect(await replay.runCompositionScheduled()).toBe(0);
  } finally {
    nodeDatabase.close();
  }
});
