import type {
  IngestEffects,
  IngestJob,
  IngestProcessingState,
} from '../../core/src/ingest-processing.js';
import { ruleCommitQueries, ruleTagQueries } from './rule-mutations.js';
import type { SqlQuery } from './reader-queries.js';

export const ingestJobColumns =
  'j.id,j.feed_id AS feedId,j.version,j.runner,j.state_json AS stateJson,f.retention_days AS retentionDays';
export const pendingIngestArticle =
  'NOT EXISTS(SELECT 1 FROM ingest_job_items pending WHERE pending.article_id=articles.id)';
export function claimIngestJob(
  runner: string,
  now: number,
  until: number,
  feedId?: number,
): SqlQuery {
  return {
    sql: `UPDATE ingest_jobs SET runner=?,expires_at=? WHERE id=(SELECT id FROM ingest_jobs WHERE expires_at<=? ${feedId === undefined ? '' : 'AND feed_id=?'} ORDER BY sequence LIMIT 1)`,
    values: [runner, until, now, ...(feedId === undefined ? [] : [feedId])],
  };
}
export function ingestCheckpointQueries(
  job: IngestJob,
  next: IngestProcessingState,
  effects: IngestEffects,
  now: number,
  until: number,
): SqlQuery[] {
  const needsLive =
    effects.tag || effects.commit || (next.phase === 'rules' && next.actions?.externalStarted);
  const active =
    needsLive && job.state.phase === 'rules' && job.state.context && job.state.actions
      ? job.state
      : null;
  const live = active
    ? ' AND EXISTS(SELECT 1 FROM articles WHERE id=?) AND EXISTS(SELECT 1 FROM rules WHERE id=?)'
    : '';
  const values = active ? [active.context!.id, active.rules[active.ruleIndex]!.id] : [];
  return [
    {
      sql: `INSERT INTO ingest_job_guard(id,valid) SELECT 1,EXISTS(SELECT 1 FROM ingest_jobs WHERE id=? AND runner=? AND version=? AND expires_at>?${live})`,
      values: [job.id, job.runner, job.version, now, ...values],
    },
    ...(effects.hidden?.length
      ? [
          {
            sql: 'UPDATE articles SET hidden=1 WHERE id IN (SELECT value FROM json_each(?))',
            values: [JSON.stringify(effects.hidden)],
          },
        ]
      : []),
    ...(effects.tag ? ruleTagQueries(active!.context!.id, effects.tag) : []),
    ...(effects.commit ? ruleCommitQueries(effects.commit) : []),
    ...(effects.releaseArticle !== undefined
      ? [
          {
            sql: 'DELETE FROM ingest_job_items WHERE article_id=? AND job_id=?',
            values: [effects.releaseArticle, job.id],
          },
        ]
      : []),
    ...(effects.complete
      ? [
          {
            sql: 'UPDATE articles SET raw_html=NULL WHERE feed_id=? AND published_at<?-(SELECT retention_days FROM feeds WHERE id=articles.feed_id)*86400000 AND raw_html IS NOT NULL',
            values: [job.feedId, now],
          },
          {
            sql: 'DELETE FROM articles WHERE feed_id=? AND published_at<?-(SELECT retention_days FROM feeds WHERE id=articles.feed_id)*86400000 AND starred_at IS NULL AND NOT EXISTS(SELECT 1 FROM article_tags WHERE article_id=articles.id) AND NOT EXISTS(SELECT 1 FROM ingest_job_items p WHERE p.article_id=articles.id AND p.job_id<>?)',
            values: [job.feedId, now, job.id],
          },
          { sql: 'DELETE FROM ingest_jobs WHERE id=?', values: [job.id] },
        ]
      : [
          {
            sql: 'UPDATE ingest_jobs SET state_json=?,version=version+1,expires_at=? WHERE id=?',
            values: [JSON.stringify(next), until, job.id],
          },
        ]),
    { sql: 'DELETE FROM ingest_job_guard', values: [] },
  ];
}
