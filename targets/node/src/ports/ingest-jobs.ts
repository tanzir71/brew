import Database from 'better-sqlite3';
import {
  IngestLeaseLost,
  decodeIngestState,
  cloneIngestRuleState,
  type IngestEffects,
  type IngestJob,
  type IngestJobsPort,
  type IngestProcessingState,
} from '../../../../packages/core/src/ingest-processing.js';
import { actionFailure } from '../../../../packages/core/src/rule-actions.js';
import {
  claimIngestJob,
  ingestCheckpointQueries,
  ingestJobColumns,
} from '../../../../packages/db/src/ingest-job-queries.js';
import type { SqlQuery } from '../../../../packages/db/src/reader-queries.js';
import type { BrewDatabase } from '../db/database.js';

export class NodeIngestJobs implements IngestJobsPort {
  constructor(private readonly database: BrewDatabase) {}
  claim(runner: string, now: number, until: number, feedId?: number): IngestJob | null {
    return this.database.sqlite.transaction(() => {
      const claim = claimIngestJob(runner, now, until, feedId);
      this.database.sqlite.prepare(claim.sql).run(...claim.values);
      const row = this.database.sqlite
        .prepare(
          `SELECT ${ingestJobColumns} FROM ingest_jobs j JOIN feeds f ON f.id=j.feed_id WHERE j.runner=?`,
        )
        .get(runner) as
        | (Omit<IngestJob, 'state' | 'articleIds' | 'liveRuleIds'> & { stateJson: string })
        | undefined;
      if (!row) return null;
      return {
        ...row,
        state: decodeIngestState(row.stateJson),
        articleIds: (
          this.database.sqlite
            .prepare(
              'SELECT article_id AS id FROM ingest_job_items WHERE job_id=? ORDER BY article_id',
            )
            .all(row.id) as { id: number }[]
        ).map(({ id }) => id),
        liveRuleIds: (
          this.database.sqlite.prepare('SELECT id FROM rules').all() as { id: number }[]
        ).map(({ id }) => id),
      };
    })();
  }
  private run(queries: SqlQuery[]) {
    this.database.sqlite.transaction(() => {
      for (const query of queries) this.database.sqlite.prepare(query.sql).run(...query.values);
    })();
  }
  checkpoint(
    job: IngestJob,
    next: IngestProcessingState,
    effects: IngestEffects,
    now: number,
    until: number,
  ) {
    try {
      this.run(ingestCheckpointQueries(job, next, effects, now, until));
      return null;
    } catch (error) {
      if (error instanceof Error && error.message.includes('brew_ingest_lease'))
        throw new IngestLeaseLost('Ingestion processing ownership changed.');
      if (
        !effects.tag ||
        (!(error instanceof TypeError) &&
          !(error instanceof Database.SqliteError && error.code.startsWith('SQLITE_CONSTRAINT')))
      )
        throw error;
      const failure = actionFailure(effects.tag, error);
      if (next.phase !== 'rules' || !next.actions) throw error;
      const failed = cloneIngestRuleState(next);
      failed.actions!.results[failed.actions!.results.length - 1] = failure;
      this.run(ingestCheckpointQueries(job, failed, {}, now, until));
      return failure;
    }
  }
  release(id: string, runner: string) {
    this.database.sqlite
      .prepare('UPDATE ingest_jobs SET runner=NULL,expires_at=0 WHERE id=? AND runner=?')
      .run(id, runner);
  }
}
