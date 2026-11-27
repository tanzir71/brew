import {
  ScheduleLeaseLost,
  type ScheduledBrewJobsPort,
  type ScheduledBrewJob,
  type ScheduledBrewState,
  type ScheduledPayload,
} from '../../../packages/core/src/brew-scheduled-processing.js';
import type { ScheduledBrewRequest } from '../../../packages/core/src/brew-scheduled-request.js';
import type { ScheduledCapture } from '../../../packages/core/src/brew-scheduled-capture.js';
import {
  beginScheduledCapture,
  scheduledCaptureAnchor,
  scheduledConfigPage,
  capturedConfigs,
  commitScheduledCapture,
  releaseScheduledCapture,
} from '../../../packages/db/src/brew-scheduled-capture.js';
import type { AsyncPort, BrewItemQuery } from '../../../packages/core/src/ports.js';
import {
  scheduledSourceQueries,
  scheduledCandidates,
  scheduledCandidatePage,
  scheduledSelectedCandidates,
  type ScheduledCandidateRow,
} from '../../../packages/db/src/brew-scheduled-candidates.js';
import type { BrewDeliveryResults } from '../../../packages/core/src/types/delivery.js';
import {
  scheduledJob,
  scheduledJobColumns,
  claimScheduledQuery,
  scheduleFence,
  clearScheduleFence,
  scheduledCheckpoint,
  scheduledRunner,
} from '../../../packages/db/src/brew-scheduled-queries.js';
import type { SqlQuery } from '../../../packages/db/src/reader-queries.js';
import { CloudflareBrewStorage } from './brew-storage.js';
import { CloudflareStorage } from './storage.js';

export class CloudflareScheduledBrewJobs implements AsyncPort<ScheduledBrewJobsPort> {
  constructor(
    private readonly storage: CloudflareStorage,
    private readonly brew = new CloudflareBrewStorage(storage),
  ) {}
  async beginCapture(runner: string, now: number, until: number, pendingOnly = false) {
    if (!pendingOnly) await this.batch([scheduledCaptureAnchor(now)]);
    const results = await this.batch(beginScheduledCapture(runner, now, until, pendingOnly));
    return (results.at(-1)!.results[0] as unknown as ScheduledCapture | undefined) ?? null;
  }
  async captureConfigs(capture: ScheduledCapture, limit: number, now: number) {
    const results = await this.batch(scheduledConfigPage(capture, limit, now));
    return capturedConfigs(results[1]!.results as unknown as { snapshot_json: string }[]);
  }
  async commitCapture(
    capture: ScheduledCapture,
    cursor: number | null,
    requests: ScheduledBrewRequest[],
    now: number,
    until: number,
  ) {
    await this.batch(commitScheduledCapture(capture, cursor, requests, now, until));
  }
  async releaseCapture(capture: ScheduledCapture) {
    await this.batch([releaseScheduledCapture(capture)]);
  }
  private async batch(queries: SqlQuery[]) {
    try {
      return await this.storage.batch(
        queries.map((query) => this.storage.statement(query.sql, query.values)),
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('brew_schedule_lease'))
        throw new ScheduleLeaseLost('Scheduled Brew ownership changed.');
      throw error;
    }
  }
  async claim(runner: string, now: number, until: number) {
    runner = scheduledRunner(runner);
    const results = await this.batch([
      claimScheduledQuery(runner, now, until),
      {
        sql: `SELECT ${scheduledJobColumns} FROM brew_schedule_jobs WHERE runner=?`,
        values: [runner],
      },
    ]);
    const row = results[1]!.results[0] as Parameters<typeof scheduledJob>[0] | undefined;
    return row ? scheduledJob(row) : null;
  }
  async checkpoint(
    job: ScheduledBrewJob,
    state: ScheduledBrewState | null,
    now: number,
    until: number,
    skipped = false,
  ) {
    await this.batch(scheduledCheckpoint(job, state, now, until, skipped));
  }
  async captureSource(
    job: ScheduledBrewJob,
    query: BrewItemQuery | null,
    when: number,
    next: ScheduledBrewState,
    now: number,
    until: number,
  ) {
    await this.batch(scheduledSourceQueries(job, query, when, next, now, until));
  }
  async candidates(
    job: ScheduledBrewJob,
    after: number,
    limit: number,
    includeContent: boolean,
    now: number,
  ) {
    const result = await this.owned(job, now, scheduledCandidatePage(job, after, limit));
    return scheduledCandidates(
      result.results as unknown as ScheduledCandidateRow[],
      includeContent,
    );
  }
  async selectedCandidates(job: ScheduledBrewJob, ids: number[], now: number) {
    if (!ids.length) return [];
    const result = await this.owned(job, now, scheduledSelectedCandidates(job, ids));
    return scheduledCandidates(result.results as unknown as ScheduledCandidateRow[], 'newsletter');
  }
  async freeze(job: ScheduledBrewJob, payload: ScheduledPayload, now: number, until: number) {
    try {
      return await this.brew.saveScheduledWork(job, payload, now, until);
    } catch (error) {
      if (error instanceof Error && error.message.includes('brew_schedule_lease'))
        throw new ScheduleLeaseLost('Scheduled Brew ownership changed.');
      throw error;
    }
  }
  private async owned(job: ScheduledBrewJob, now: number, query: SqlQuery) {
    const result = await this.batch([scheduleFence(job, now), query, clearScheduleFence]);
    return result[1]!;
  }
  async claimDelivery(
    job: ScheduledBrewJob,
    id: number,
    results: BrewDeliveryResults,
    now: number,
  ) {
    return (
      (
        await this.owned(job, now, {
          sql: 'UPDATE brews SET sent_json=? WHERE id=? AND sent_json IS NULL',
          values: [JSON.stringify(results), id],
        })
      ).meta.changes === 1
    );
  }
  async saveDelivery(job: ScheduledBrewJob, id: number, results: BrewDeliveryResults, now: number) {
    await this.owned(job, now, {
      sql: 'UPDATE brews SET sent_json=? WHERE id=?',
      values: [JSON.stringify(results), id],
    });
  }
  async deliveryResults(job: ScheduledBrewJob, id: number, now: number) {
    const row = (
      await this.owned(job, now, {
        sql: 'SELECT sent_json AS value FROM brews WHERE id=?',
        values: [id],
      })
    ).results[0] as { value: string | null } | undefined;
    return row?.value ? (JSON.parse(row.value) as BrewDeliveryResults) : null;
  }
  async release(id: string, runner: string) {
    await this.storage.run(
      'UPDATE brew_schedule_jobs SET runner=NULL,expires_at=0 WHERE id=? AND runner=?',
      [id, runner],
    );
  }
}
