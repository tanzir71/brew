import type { BrewDatabase } from '../db/database.js';
import { NodeBrewStorage } from './brew-storage.js';
import {
  ScheduleLeaseLost,
  type ScheduledBrewJobsPort,
  type ScheduledBrewJob,
  type ScheduledBrewState,
  type ScheduledPayload,
} from '../../../../packages/core/src/brew-scheduled-processing.js';
import type { ScheduledBrewRequest } from '../../../../packages/core/src/brew-scheduled-request.js';
import type { BrewDeliveryResults } from '../../../../packages/core/src/types/delivery.js';
import type { BrewItemQuery } from '../../../../packages/core/src/ports.js';
import {
  scheduledSourceQueries,
  scheduledCandidates,
  scheduledCandidatePage,
  scheduledSelectedCandidates,
  type ScheduledCandidateRow,
} from '../../../../packages/db/src/brew-scheduled-candidates.js';
import { brewConfigFromRaw } from '../../../../packages/db/src/brew-queries.js';
import { BREW_RETENTION_DAYS } from '../../../../packages/core/src/composition-model.js';
import {
  scheduledConfig,
  scheduledJob,
  scheduledJobColumns,
  enqueueScheduledQueries,
  claimScheduledQuery,
  scheduleFence,
  clearScheduleFence,
  scheduledCheckpoint,
  scheduledStateWrite,
  scheduledRunner,
} from '../../../../packages/db/src/brew-scheduled-queries.js';
import type { SqlQuery } from '../../../../packages/db/src/reader-queries.js';

export class NodeScheduledBrewJobs implements ScheduledBrewJobsPort {
  private readonly brew: NodeBrewStorage;
  constructor(private readonly database: BrewDatabase) {
    this.brew = new NodeBrewStorage(database);
  }
  configs() {
    return (
      this.database.sqlite.prepare('SELECT * FROM brew_configs ORDER BY id').all() as Record<
        string,
        unknown
      >[]
    ).map((row) => scheduledConfig(brewConfigFromRaw(row)));
  }
  private run(query: SqlQuery) {
    return this.database.sqlite.prepare(query.sql).run(...query.values);
  }
  captureAfter(now: number) {
    return this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('brew:schedule:through',?)")
        .run(String(now - 60_000));
      return Number(this.brew.setting('brew:schedule:through'));
    })();
  }
  enqueue(requests: ScheduledBrewRequest[], now: number) {
    this.database.sqlite.transaction(() => {
      for (const query of enqueueScheduledQueries(requests, now)) this.run(query);
    })();
  }
  claim(runner: string, now: number, until: number) {
    runner = scheduledRunner(runner);
    return this.database.sqlite.transaction(() => {
      this.run(claimScheduledQuery(runner, now, until));
      const row = this.database.sqlite
        .prepare(`SELECT ${scheduledJobColumns} FROM brew_schedule_jobs WHERE runner=?`)
        .get(runner) as Parameters<typeof scheduledJob>[0] | undefined;
      return row ? scheduledJob(row) : null;
    })();
  }
  private transaction<T>(work: () => T): T {
    try {
      return this.database.sqlite.transaction(work)();
    } catch (error) {
      if (error instanceof Error && error.message.includes('brew_schedule_lease'))
        throw new ScheduleLeaseLost('Scheduled Brew ownership changed.');
      throw error;
    }
  }
  checkpoint(
    job: ScheduledBrewJob,
    state: ScheduledBrewState | null,
    now: number,
    until: number,
    skipped = false,
  ) {
    this.transaction(() => {
      for (const query of scheduledCheckpoint(job, state, now, until, skipped)) this.run(query);
    });
  }
  captureSource(
    job: ScheduledBrewJob,
    query: BrewItemQuery | null,
    when: number,
    next: ScheduledBrewState,
    now: number,
    until: number,
  ) {
    this.transaction(() => {
      for (const statement of scheduledSourceQueries(job, query, when, next, now, until))
        this.run(statement);
    });
  }
  private readCandidates(
    job: ScheduledBrewJob,
    query: SqlQuery,
    includeContent: boolean | 'newsletter',
    now: number,
  ) {
    return this.owned(job, now, () =>
      scheduledCandidates(
        this.database.sqlite.prepare(query.sql).all(...query.values) as ScheduledCandidateRow[],
        includeContent,
      ),
    );
  }
  candidates(
    job: ScheduledBrewJob,
    after: number,
    limit: number,
    includeContent: boolean,
    now: number,
  ) {
    return this.readCandidates(job, scheduledCandidatePage(job, after, limit), includeContent, now);
  }
  selectedCandidates(job: ScheduledBrewJob, ids: number[], now: number) {
    return ids.length
      ? this.readCandidates(job, scheduledSelectedCandidates(job, ids), 'newsletter', now)
      : [];
  }
  freeze(job: ScheduledBrewJob, payload: ScheduledPayload, now: number, until: number) {
    return this.transaction(() => {
      this.run(scheduleFence(job, now));
      const id = this.brew.saveScheduled(job.request.config.id, payload, job.request.receipt);
      this.run(
        scheduledStateWrite(
          job,
          id !== null && job.request.kind === 'composition'
            ? { phase: 'delivery', issueId: id, started: false }
            : null,
          until,
        ),
      );
      if (id !== null) {
        if (job.request.kind === 'legacy') {
          this.database.sqlite
            .prepare('UPDATE brews SET generated_at=? WHERE id=?')
            .run(new Date(job.request.receipt.value).getTime(), id);
          this.brew.prune(job.request.config.id, 30);
        } else this.brew.pruneBefore(job.request.config.id, now - BREW_RETENTION_DAYS * 86_400_000);
      }
      this.run(clearScheduleFence);
      return id;
    });
  }
  private owned<T>(job: ScheduledBrewJob, now: number, work: () => T) {
    return this.transaction(() => {
      this.run(scheduleFence(job, now));
      const result = work();
      this.run(clearScheduleFence);
      return result;
    });
  }
  claimDelivery(job: ScheduledBrewJob, id: number, results: BrewDeliveryResults, now: number) {
    return this.owned(job, now, () => this.brew.claimDelivery(id, results));
  }
  saveDelivery(job: ScheduledBrewJob, id: number, results: BrewDeliveryResults, now: number) {
    this.owned(job, now, () => this.brew.saveDelivery(id, results));
  }
  deliveryResults(job: ScheduledBrewJob, id: number, now: number) {
    return this.owned(job, now, () => this.brew.deliveryResults(id));
  }
  release(id: string, runner: string) {
    this.database.sqlite
      .prepare('UPDATE brew_schedule_jobs SET runner=NULL,expires_at=0 WHERE id=? AND runner=?')
      .run(id, runner);
  }
}
