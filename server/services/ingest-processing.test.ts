import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, unlinkSync } from 'node:fs';
import { openDatabase, type BrewDatabase } from '../../targets/node/src/db/database.js';
import { NodeIngestStorage } from '../../targets/node/src/ports/ingest-storage.js';
import { NodeIngestJobs } from '../../targets/node/src/ports/ingest-jobs.js';
import { NodeRuleStorage } from '../../targets/node/src/ports/rule-storage.js';
import { nodeRegex } from '../../targets/node/src/ports/runtime.js';
import {
  IngestProcessingService,
  IngestLeaseLost,
  type IngestEffects,
  type IngestJob,
  type IngestProcessingState,
} from '../../packages/core/src/ingest-processing.js';
import { RulesService } from '../../packages/core/src/rules-service.js';
import type { RuleAction } from '../../packages/core/src/types/rules.js';
import type { IngestCandidate } from '../../packages/core/src/ports.js';
import { ActionsService } from '../../packages/core/src/actions.js';
import { NodeActionStorage } from '../../targets/node/src/ports/action-storage.js';
import { NodeBrewStorage } from '../../targets/node/src/ports/brew-storage.js';
import { RulesService as NodeRulesService } from '../../targets/node/src/services/rules-service.js';
import { createApp, nodeServices } from '../../targets/node/src/app.js';
import { PollerService } from '../../targets/node/src/services/poller-service.js';

const now = Date.parse('2026-07-10T12:00:00Z');
const clock = { now: () => new Date(now), monotonic: () => 0 };
const files: string[] = [];
const opened = new Set<BrewDatabase>();
afterEach(() => {
  for (const db of opened) db.close();
  opened.clear();
  for (const file of files.splice(0))
    for (const suffix of ['', '-wal', '-shm'])
      if (existsSync(file + suffix)) unlinkSync(file + suffix);
});
function open(filename = ':memory:') {
  const db = openDatabase(filename);
  opened.add(db);
  return db;
}
function close(db: BrewDatabase) {
  db.close();
  opened.delete(db);
}
function candidate(guid = 'new'): IngestCandidate {
  return {
    feedId: 1,
    guid,
    hash: guid,
    prepare: () => ({
      feedId: 1,
      guid,
      hash: guid,
      url: `https://feed.test/${guid}`,
      title: 'Story',
      author: null,
      summaryHtml: null,
      contentHtml: '<p>Clean content.</p>',
      imageUrl: null,
      enclosureUrl: null,
      enclosureType: null,
      publishedAt: new Date(now),
    }),
  };
}
function seed(db: BrewDatabase, actions: RuleAction[]) {
  db.sqlite
    .prepare("INSERT INTO feeds(id,url,title) VALUES(1,'https://feed.test/rss','Feed')")
    .run();
  db.sqlite
    .prepare(
      "INSERT INTO rules(id,name,match_type,scope_json,conditions_json,actions_json) VALUES(1,'Pending','all','{}','[]',?)",
    )
    .run(JSON.stringify(actions));
  return new NodeIngestStorage(db, true).insertBatch([candidate()])[0]!;
}
function processor(
  db: BrewDatabase,
  jobs = new NodeIngestJobs(db),
  network = { fetch },
  notices = { notify: () => {} },
  runClock = clock,
) {
  return new IngestProcessingService(
    jobs,
    new NodeIngestStorage(db, true),
    new NodeRuleStorage(db),
    nodeRegex,
    network,
    notices,
    runClock,
    randomUUID,
  );
}
const rows = (db: BrewDatabase, sql: string) => db.sqlite.prepare(sql).all();

it('reopens after every durable step, retains action/rule order and frozen timestamps, and finishes with Node manual parity', async () => {
  const filename = join(tmpdir(), `brew-pending-${randomUUID()}.db`);
  files.push(filename);
  const baseline = open(),
    actions: RuleAction[] = [
      { type: 'add_tag', tag: 'Before' },
      { type: 'star' },
      { type: 'mark_read' },
      { type: 'remove_tag', tag: 'Before' },
      { type: 'add_tag', tag: 'After' },
      { type: 'feature_in_brew' },
      { type: 'exclude_from_brew' },
    ];
  const baselineId = seed(baseline, actions);
  const old = new RulesService(
    new NodeRuleStorage(baseline),
    nodeRegex,
    { fetch },
    { notify: () => {} },
    clock,
  );
  expect(await old.evaluateArticle(baselineId)).toBe(1);
  let db = open(filename);
  seed(db, actions);
  close(db);
  let steps = 0;
  while (steps < 40) {
    db = open(filename);
    if (!rows(db, 'SELECT id FROM ingest_jobs').length) {
      close(db);
      break;
    }
    expect(await processor(db).drain(undefined, 1)).toBe(1);
    close(db);
    steps++;
  }
  expect(steps).toBeGreaterThan(actions.length);
  expect(steps).toBeLessThan(40);
  db = open(filename);
  for (const sql of [
    'SELECT starred_at,read_at,hidden,featured_in_brew,excluded_from_brew FROM articles',
    'SELECT rule_id,article_id,actions_taken_json FROM rule_logs',
    'SELECT t.name FROM article_tags at JOIN tags t ON t.id=at.tag_id ORDER BY t.name',
  ])
    expect(rows(db, sql)).toEqual(rows(baseline, sql));
  expect(rows(db, 'SELECT * FROM ingest_jobs')).toEqual([]);
  expect(rows(db, 'SELECT * FROM ingest_job_items')).toEqual([]);
  expect(rows(db, 'SELECT * FROM ingest_job_guard')).toEqual([]);
});

it.each(['tag', 'commit'] as const)(
  'does not repeat an acknowledged-by-storage %s after its response is lost',
  async (kind) => {
    const db = open();
    seed(db, [{ type: 'add_tag', tag: 'Once' }, { type: 'star' }]);
    db.sqlite.exec(
      'CREATE TABLE tag_audit(id INTEGER); CREATE TRIGGER audit_tag AFTER INSERT ON article_tags BEGIN INSERT INTO tag_audit VALUES(NEW.article_id); END',
    );
    let interrupted = false;
    class LostResponse extends NodeIngestJobs {
      override checkpoint(
        job: IngestJob,
        next: IngestProcessingState,
        effects: IngestEffects,
        at: number,
        until: number,
      ) {
        const result = super.checkpoint(job, next, effects, at, until);
        if (!interrupted && effects[kind]) {
          interrupted = true;
          throw new Error('Response lost after commit');
        }
        return result;
      }
    }
    await expect(processor(db, new LostResponse(db)).drain()).rejects.toThrow('Response lost');
    expect(interrupted).toBe(true);
    await processor(db).drain();
    expect(rows(db, 'SELECT * FROM tag_audit')).toHaveLength(1);
    expect(rows(db, 'SELECT * FROM rule_logs')).toHaveLength(1);
    expect(rows(db, 'SELECT * FROM ingest_jobs')).toEqual([]);
  },
);

it.each(['before', 'after'] as const)(
  'never resends an external effect when its result checkpoint fails %s committing',
  async (boundary) => {
    let requests = 0;
    const server = createServer(async (request, response) => {
      for await (const chunk of request) void chunk;
      requests++;
      response.writeHead(204);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected HTTP port');
      const db = open();
      seed(db, [
        { type: 'webhook', url: `http://127.0.0.1:${address.port}/hook` },
        { type: 'star' },
      ]);
      let interrupted = false;
      class LostResult extends NodeIngestJobs {
        override checkpoint(
          job: IngestJob,
          next: IngestProcessingState,
          effects: IngestEffects,
          at: number,
          until: number,
        ) {
          const finished =
            next.phase === 'rules' &&
            next.actions?.results.some((result) => result.type === 'webhook');
          if (!interrupted && finished) {
            interrupted = true;
            if (boundary === 'before') throw new Error('Result interrupted');
            super.checkpoint(job, next, effects, at, until);
            throw new Error('Result interrupted');
          }
          return super.checkpoint(job, next, effects, at, until);
        }
      }
      await expect(processor(db, new LostResult(db)).drain()).rejects.toThrow('Result interrupted');
      expect(requests).toBe(1);
      await processor(db).drain();
      expect(requests).toBe(1);
      const log = new NodeRuleStorage(db).logs(1)[0]!.actions;
      if (boundary === 'before')
        expect(log[0]).toMatchObject({
          type: 'webhook',
          ok: false,
          error: expect.stringContaining('outcome is unknown'),
        });
      else expect(log[0]).toEqual({ type: 'webhook', ok: true });
      expect(log[1]).toEqual({ type: 'star', ok: true });
      expect(rows(db, 'SELECT starred_at FROM articles')).toEqual([{ starred_at: now }]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

it('recovers an expired lease and fences the old runner without altering a replacement lease', () => {
  const db = open();
  seed(db, []);
  const jobs = new NodeIngestJobs(db),
    old = jobs.claim('old', now, now + 10)!;
  expect(jobs.claim('overlap', now + 9, now + 20)).toBeNull();
  const replacement = jobs.claim('new', now + 10, now + 30)!;
  expect(() =>
    jobs.checkpoint(old, { phase: 'retention' }, { hidden: [1] }, now + 11, now + 40),
  ).toThrow(IngestLeaseLost);
  jobs.release(old.id, 'old');
  expect(rows(db, 'SELECT runner FROM ingest_jobs')).toEqual([{ runner: 'new' }]);
  jobs.checkpoint(replacement, { phase: 'retention' }, {}, now + 11, now + 40);
  expect(rows(db, 'SELECT hidden FROM articles')).toEqual([{ hidden: 0 }]);
  expect(rows(db, 'SELECT * FROM ingest_job_guard')).toEqual([]);
});

it('protects pending retention until its saved-state rule completes and keeps the original star timestamp across clocks', async () => {
  const db = open();
  seed(db, [{ type: 'star' }, { type: 'add_tag', tag: 'Saved' }]);
  db.sqlite.prepare('UPDATE articles SET published_at=0,raw_html=?').run('<p>Original</p>');
  new NodeIngestStorage(db).prune(1, now);
  expect(rows(db, 'SELECT raw_html FROM articles')).toEqual([{ raw_html: null }]);
  await processor(db).drain(undefined, 4); // duplicate, context, match, star checkpoint
  expect(rows(db, 'SELECT starred_at FROM articles')).toEqual([{ starred_at: null }]);
  await processor(db, undefined, undefined, undefined, {
    now: () => new Date(now + 86_400_000),
    monotonic: () => 0,
  }).drain();
  expect(rows(db, 'SELECT starred_at FROM articles')).toEqual([{ starred_at: now }]);
  expect(rows(db, 'SELECT * FROM ingest_jobs')).toEqual([]);
});

it.each(['article', 'rule'] as const)(
  'cancels unfinished work after its %s is deleted',
  async (kind) => {
    const db = open();
    seed(db, [{ type: 'add_tag', tag: 'Must not run' }]);
    await processor(db).drain(undefined, 3);
    db.sqlite.exec(`DELETE FROM ${kind === 'article' ? 'articles' : 'rules'}`);
    await processor(db).drain();
    expect(rows(db, 'SELECT * FROM rule_logs')).toEqual([]);
    expect(rows(db, 'SELECT * FROM tags')).toEqual([]);
    expect(rows(db, 'SELECT * FROM ingest_jobs')).toEqual([]);
  },
);

it('records a failed local action, completes other actions and uses a stable definition snapshot across resumptions', async () => {
  const db = open();
  seed(db, [
    { type: 'add_tag', tag: 'Refused' },
    { type: 'add_tag', tag: 'Kept' },
    { type: 'mark_read' },
  ]);
  db.sqlite.exec(
    "CREATE TRIGGER refuse_tag BEFORE INSERT ON tags WHEN NEW.name='Refused' BEGIN SELECT RAISE(ABORT,'Saved tag refusal'); END",
  );
  await processor(db).drain(undefined, 1);
  db.sqlite.prepare('UPDATE rules SET actions_json=?').run(JSON.stringify([{ type: 'hide' }]));
  await processor(db).drain();
  expect(new NodeRuleStorage(db).logs(1)[0]!.actions).toEqual([
    { type: 'add_tag', ok: false, error: 'Saved tag refusal' },
    { type: 'add_tag', ok: true },
    { type: 'mark_read', ok: true },
  ]);
  expect(rows(db, 'SELECT hidden,read_at FROM articles')).toEqual([{ hidden: 0, read_at: now }]);
  new NodeIngestStorage(db, true).insertBatch([candidate('later')]);
  await processor(db).drain();
  expect(rows(db, 'SELECT hidden FROM articles ORDER BY id')).toEqual([
    { hidden: 0 },
    { hidden: 1 },
  ]);
});

it('restores pending processing through actual feed deletion and Undo, fencing its prior lease', async () => {
  const db = open();
  seed(db, [{ type: 'star' }]);
  const actions = new ActionsService(new NodeActionStorage(db, clock));
  const old = new NodeIngestJobs(db).claim('before-delete', now, now + 60_000)!;
  const receipt = await actions.run({ kind: 'delete_feed', id: 1, confirm: true });
  expect(rows(db, 'SELECT * FROM ingest_jobs')).toEqual([]);
  actions.undo(receipt.id);
  expect(rows(db, 'SELECT runner,expires_at FROM ingest_jobs')).toEqual([
    { runner: null, expires_at: 0 },
  ]);
  expect(rows(db, 'SELECT article_id FROM ingest_job_items')).toEqual([{ article_id: 1 }]);
  expect(() =>
    new NodeIngestJobs(db).checkpoint(old, { phase: 'retention' }, {}, now, now + 60_000),
  ).toThrow(IngestLeaseLost);
  await processor(db).drain();
  expect(rows(db, 'SELECT starred_at FROM articles')).toEqual([{ starred_at: now }]);
  expect(rows(db, 'SELECT * FROM ingest_jobs')).toEqual([]);
});

it('hides every duplicate in a batch before its first notification observes the library', async () => {
  const db = open();
  seed(db, [{ type: 'notify' }]);
  db.sqlite.exec(
    "DELETE FROM ingest_jobs; INSERT INTO settings(key,value) VALUES('duplicate_filter_enabled','true')",
  );
  new NodeIngestStorage(db, true).insertBatch([candidate('second'), candidate('third')]);
  const observed: number[] = [];
  await processor(db, undefined, undefined, {
    notify: () => {
      observed.push(
        Number(
          (
            db.sqlite
              .prepare('SELECT count(*) AS n FROM articles WHERE id IN (2,3) AND hidden=1')
              .get() as { n: number }
          ).n,
        ),
      );
    },
  }).drain();
  expect(observed).toEqual([2, 2]);
  expect(rows(db, 'SELECT count(*) AS n FROM rule_logs')).toEqual([{ n: 2 }]);
});

it('keeps unfinished rules out of new Brews and releases each article after its final rule commit', async () => {
  const db = open();
  seed(db, [{ type: 'star' }]);
  const brews = new NodeBrewStorage(db),
    query = { onlyUnread: false, starred: false, featured: false, sort: 'newest' as const };
  expect(brews.compositionItems(query)).toEqual([]);
  expect(brews.items(query)).toEqual([]);
  await processor(db).drain(undefined, 5); // final rule log has committed; article release follows
  expect(rows(db, 'SELECT starred_at FROM articles')).toEqual([{ starred_at: now }]);
  expect(brews.compositionItems(query)).toEqual([]);
  await processor(db).drain(undefined, 1);
  expect(brews.compositionItems(query).map((row) => row.id)).toEqual([1]);
  expect(brews.items(query).map((row) => row.id)).toEqual([1]);
  expect(rows(db, 'SELECT count(*) AS n FROM ingest_jobs')).toEqual([{ n: 1 }]);
});

it('serializes independent Node ingest and recovery calls instead of returning early behind another lease', async () => {
  const db = open();
  seed(db, [{ type: 'star' }]);
  const rules = new NodeRulesService(db, fetch, () => {}, clock);
  const first = rules.ingestProcessor(new NodeIngestStorage(db, true)),
    second = rules.ingestProcessor(new NodeIngestStorage(db, true));
  expect(await Promise.all([first.drain(undefined, 1), second.drain(undefined, 1)])).toEqual([
    1, 1,
  ]);
  expect(rows(db, 'SELECT version FROM ingest_jobs')).toEqual([{ version: 2 }]);
  await second.drain();
  expect(rows(db, 'SELECT starred_at FROM articles')).toEqual([{ starred_at: now }]);
});

it('publishes actual recovery changes to an open reader from the Node background timer', async () => {
  const db = open(),
    start = vi.spyOn(PollerService.prototype, 'start').mockImplementation(() => {});
  vi.useFakeTimers();
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp({ database: db, clock, logger: false, startPoller: true });
    const events: Array<{ event: string; data: unknown }> = [];
    const unsubscribe = nodeServices(app).events.subscribe(
      (event, data) => events.push({ event, data }),
      () => {},
    );
    seed(db, [{ type: 'star' }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rows(db, 'SELECT starred_at FROM articles')).toEqual([{ starred_at: now }]);
    expect(events).toContainEqual({ event: 'article:new', data: { count: 0, feeds: [] } });
    expect(rows(db, 'SELECT * FROM ingest_jobs')).toEqual([]);
    unsubscribe();
  } finally {
    if (app) {
      await app.close();
      opened.delete(db);
    }
    vi.useRealTimers();
    start.mockRestore();
  }
});
