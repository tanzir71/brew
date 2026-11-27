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
      'DELETE FROM brew_configs',
      'DELETE FROM settings',
      "DELETE FROM sqlite_sequence WHERE name IN ('brew_configs','brews')",
    ].map((sql) => storage.statement(sql)),
  );
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
