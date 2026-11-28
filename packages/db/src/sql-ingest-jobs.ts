import {
  IngestLeaseLost,
  decodeIngestState,
  cloneIngestRuleState,
  type IngestEffects,
  type IngestJob,
  type IngestJobsPort,
  type IngestProcessingState,
} from '../../core/src/ingest-processing.js';
import type { AsyncPort } from '../../core/src/ports.js';
import { actionFailure } from '../../core/src/rule-actions.js';
import { claimIngestJob, ingestCheckpointQueries, ingestJobColumns } from './ingest-job-queries.js';
import type { SqlQuery } from './reader-queries.js';
import type { AsyncSqlStorage } from './async-storage.js';
import { libraryRevision } from './async-storage.js';
export class SqlIngestJobs<Statement> implements AsyncPort<IngestJobsPort> {
  constructor(
    private readonly storage: AsyncSqlStorage<Statement>,
    private isConstraint: (error: unknown) => boolean,
  ) {}
  async claim(
    runner: string,
    now: number,
    until: number,
    feedId?: number,
  ): Promise<IngestJob | null> {
    const claim = claimIngestJob(runner, now, until, feedId);
    const results = await this.storage.batch([
      this.storage.statement(claim.sql, claim.values),
      this.storage.statement(
        `SELECT ${ingestJobColumns} FROM ingest_jobs j JOIN feeds f ON f.id=j.feed_id WHERE j.runner=?`,
        [runner],
      ),
      this.storage.statement(
        'SELECT i.article_id AS id FROM ingest_job_items i JOIN ingest_jobs j ON j.id=i.job_id WHERE j.runner=? ORDER BY i.article_id',
        [runner],
      ),
      this.storage.statement('SELECT id FROM rules'),
    ]);
    const row = results[1]!.results[0] as unknown as
      (Omit<IngestJob, 'state' | 'articleIds' | 'liveRuleIds'> & { stateJson: string }) | undefined;
    return row
      ? {
          ...row,
          state: decodeIngestState(row.stateJson),
          articleIds: results[2]!.results.map((row) => Number(row.id)),
          liveRuleIds: results[3]!.results.map((row) => Number(row.id)),
        }
      : null;
  }
  private async run(queries: SqlQuery[]) {
    await this.storage.batch([
      ...queries.map(({ sql, values }) => this.storage.statement(sql, values)),
      libraryRevision(this.storage),
    ]);
  }
  async checkpoint(
    job: IngestJob,
    next: IngestProcessingState,
    effects: IngestEffects,
    now: number,
    until: number,
  ) {
    try {
      await this.run(ingestCheckpointQueries(job, next, effects, now, until));
      return null;
    } catch (error) {
      if (error instanceof Error && error.message.includes('brew_ingest_lease'))
        throw new IngestLeaseLost('Ingestion processing ownership changed.');
      if (!effects.tag || !(error instanceof TypeError || this.isConstraint(error))) throw error;
      const failure = actionFailure(effects.tag, error);
      if (next.phase !== 'rules' || !next.actions) throw error;
      const failed = cloneIngestRuleState(next);
      failed.actions!.results[failed.actions!.results.length - 1] = failure;
      await this.run(ingestCheckpointQueries(job, failed, {}, now, until));
      return failure;
    }
  }
  async release(id: string, runner: string) {
    await this.storage.run(
      'UPDATE ingest_jobs SET runner=NULL,expires_at=0 WHERE id=? AND runner=?',
      [id, runner],
    );
  }
}
