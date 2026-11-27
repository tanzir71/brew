import type { BrewCandidate, BrewItemQuery } from '../../core/src/ports.js';
import type {
  ScheduledBrewJob,
  ScheduledBrewState,
} from '../../core/src/brew-scheduled-processing.js';
import { compositionItemsQuery, brewCandidates, type BrewCandidateRow } from './brew-queries.js';
import {
  scheduleFence,
  clearScheduleFence,
  scheduledStateWrite,
} from './brew-scheduled-queries.js';
import type { SqlQuery } from './reader-queries.js';

const fields = [
  'feedKind',
  'cleaningJson',
  'id',
  'title',
  'url',
  'author',
  'feedId',
  'feed',
  'folderId',
  'folder',
  'summaryHtml',
  'imageUrl',
  'publishedAt',
  'readAt',
  'body',
];
/** SQL captures the same complete source snapshot without transferring its bodies
 * through the Worker. Its source cursor commits in this transaction as well.
 */
export function scheduledSourceQueries(
  job: ScheduledBrewJob,
  query: BrewItemQuery | null,
  when: number,
  next: ScheduledBrewState,
  now: number,
  until: number,
): SqlQuery[] {
  if (job.state.phase !== 'composition') throw new Error('Invalid source snapshot.');
  const built = query ? compositionItemsQuery(query) : null;
  return [
    scheduleFence(job, now),
    ...(built
      ? [
          {
            sql: `INSERT INTO brew_schedule_candidates(job_id,section_index,article_id,format,snapshot_json)
      SELECT ?,?,source.id,1,json_object(${fields.map((name) => `'${name}',source.${name}`).join(',')})
      FROM (${built.sql}) source WHERE source.publishedAt<=?
      ON CONFLICT(job_id,section_index,article_id) DO UPDATE SET format=excluded.format,snapshot_json=excluded.snapshot_json
      WHERE brew_schedule_candidates.format<>excluded.format OR brew_schedule_candidates.snapshot_json IS NOT excluded.snapshot_json`,
            values: [job.id, job.state.index, ...built.values, when],
          },
        ]
      : []),
    scheduledStateWrite(job, next, until),
    clearScheduleFence,
  ];
}
export interface ScheduledCandidateRow {
  format: number;
  snapshot_json: string;
}
export function scheduledCandidates(
  rows: ScheduledCandidateRow[],
  includeContent: boolean | 'newsletter' = true,
): BrewCandidate[] {
  return rows.map((row) => {
    const value: unknown = JSON.parse(row.snapshot_json);
    return row.format === 0
      ? (value as BrewCandidate)
      : brewCandidates(
          [value as BrewCandidateRow],
          includeContent === true ||
            (includeContent === 'newsletter' &&
              (value as BrewCandidateRow).feedKind === 'newsletter'),
        )[0]!;
  });
}
export function scheduledCandidatePage(
  job: ScheduledBrewJob,
  after: number,
  limit: number,
): SqlQuery {
  if (job.state.phase !== 'composition') throw new Error('Invalid source snapshot.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Invalid candidate page size.');
  return {
    sql: 'SELECT format,snapshot_json FROM brew_schedule_candidates WHERE job_id=? AND section_index=? AND article_id>? ORDER BY article_id LIMIT ?',
    values: [job.id, job.state.index, after, limit],
  };
}
export function scheduledSelectedCandidates(job: ScheduledBrewJob, ids: number[]): SqlQuery {
  if (job.state.phase !== 'composition') throw new Error('Invalid source snapshot.');
  return {
    sql: 'SELECT format,snapshot_json FROM brew_schedule_candidates WHERE job_id=? AND section_index=? AND article_id IN (SELECT value FROM json_each(?))',
    values: [job.id, job.state.index, JSON.stringify(ids)],
  };
}
