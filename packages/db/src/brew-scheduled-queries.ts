import type {
  ScheduledBrewJob,
  ScheduledBrewState,
} from '../../core/src/brew-scheduled-processing.js';
import type { ScheduledConfig } from '../../core/src/brew-scheduled-request.js';
import type { SqlQuery } from './reader-queries.js';
import { legacyBrewConfig, brewComposition, type BrewConfigRow } from './brew-queries.js';
import { initialScheduledState } from '../../core/src/brew-scheduled-processing.js';
import type { ScheduledBrewRequest } from '../../core/src/brew-scheduled-request.js';
export function enqueueScheduledQueries(requests: ScheduledBrewRequest[], now: number): SqlQuery[] {
  return [
    ...requests.map((request) => ({
      sql: `INSERT INTO brew_schedule_jobs(id,config_id,request_json,state_json,created_at)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM brew_configs WHERE id=?)
      AND NOT EXISTS(SELECT 1 FROM settings WHERE key=?) ON CONFLICT(id) DO NOTHING`,
      values: [
        request.receipt.key,
        request.config.id,
        JSON.stringify(request),
        JSON.stringify(initialScheduledState(request)),
        now,
        request.config.id,
        request.receipt.key,
      ],
    })),
    {
      sql: `INSERT INTO settings(key,value) VALUES('brew:schedule:through',?) ON CONFLICT(key)
    DO UPDATE SET value=CAST(max(CAST(settings.value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)`,
      values: [String(now)],
    },
  ];
}
export function claimScheduledQuery(runner: string, now: number, until: number): SqlQuery {
  return {
    sql: `UPDATE brew_schedule_jobs SET runner=?,expires_at=? WHERE sequence=(
    SELECT sequence FROM brew_schedule_jobs WHERE expires_at<=? ORDER BY sequence LIMIT 1)`,
    values: [runner, until, now],
  };
}
export function scheduledConfig(row: BrewConfigRow): ScheduledConfig {
  return row.compositionVersion === 2
    ? { kind: 'composition', config: brewComposition(row) }
    : { kind: 'legacy', config: legacyBrewConfig(row) };
}
export const scheduledJobColumns =
  'id,runner,version,request_json AS requestJson,state_json AS stateJson';
export function scheduledJob(row: {
  id: string;
  runner: string;
  version: number;
  requestJson: string;
  stateJson: string;
}): ScheduledBrewJob {
  return {
    id: row.id,
    runner: row.runner,
    version: row.version,
    request: JSON.parse(row.requestJson),
    state: JSON.parse(row.stateJson),
  };
}
export function scheduleFence(job: ScheduledBrewJob, now: number): SqlQuery {
  return {
    sql: `INSERT INTO brew_schedule_guard(id,valid) SELECT 1,EXISTS(SELECT 1 FROM brew_schedule_jobs
    WHERE id=? AND runner=? AND version=? AND expires_at>?)`,
    values: [job.id, job.runner, job.version, now],
  };
}
export const clearScheduleFence: SqlQuery = { sql: 'DELETE FROM brew_schedule_guard', values: [] };
export function scheduledStateWrite(
  job: ScheduledBrewJob,
  state: ScheduledBrewState | null,
  until: number,
): SqlQuery {
  return state
    ? {
        sql: 'UPDATE brew_schedule_jobs SET state_json=?,version=version+1,expires_at=? WHERE id=?',
        values: [JSON.stringify(state), until, job.id],
      }
    : { sql: 'DELETE FROM brew_schedule_jobs WHERE id=?', values: [job.id] };
}
export function scheduledCheckpoint(
  job: ScheduledBrewJob,
  state: ScheduledBrewState | null,
  now: number,
  until: number,
  skipped = false,
): SqlQuery[] {
  return [
    scheduleFence(job, now),
    ...(skipped
      ? [
          {
            sql: 'INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)',
            values: [job.request.receipt.key, job.request.receipt.value],
          },
        ]
      : []),
    scheduledStateWrite(job, state, until),
    clearScheduleFence,
  ];
}
