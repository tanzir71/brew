import type { IngestCandidate, IngestStoragePort, DuplicateTitles } from '../../core/src/ports.js';
import { duplicateTitleQueries } from './ingest-queries.js';
import type { AsyncSqlStorage } from './async-storage.js';
import { PollInterruptedError } from '../../core/src/feed-polling.js';
import { pendingIngestArticle } from './ingest-job-queries.js';

/** Trusted adapter predicate, evaluated atomically with article insertion. */
export type StorageAdmission = { predicate: string; values: unknown[]; error?: () => Error };
export type IngestAdmission = () => StorageAdmission;

export class SqlIngestStorage<Statement> implements IngestStoragePort {
  constructor(
    protected readonly storage: AsyncSqlStorage<Statement>,
    protected readonly admission?: IngestAdmission,
    protected readonly queued = false,
  ) {}
  protected admissionError(admission: StorageAdmission) {
    return admission.error?.() ?? new PollInterruptedError('Feed polling ownership changed.');
  }
  async insertBatch(items: IngestCandidate[]) {
    if (!items.length && !this.admission) return [];
    // Preserve lazy cleaning: a normal conditional refresh can repeat thousands
    // of old entries. Do not parse/sanitize their bodies again on Worker CPU.
    const previous = await this.storage.all<{ feed_id: number; guid: string; hash: string }>(
      `SELECT DISTINCT a.feed_id,a.guid,a.hash FROM articles a JOIN json_each(?) c
       ON a.feed_id=json_extract(c.value,'$.feedId') AND
       (a.guid=json_extract(c.value,'$.guid') OR a.hash=json_extract(c.value,'$.hash'))`,
      [JSON.stringify(items.map(({ feedId, guid, hash }) => ({ feedId, guid, hash })))],
    );
    const guids = new Set(previous.map((item) => JSON.stringify([item.feed_id, item.guid])));
    const hashes = new Set(previous.map((item) => JSON.stringify([item.feed_id, item.hash])));
    const pending = items.filter((item) => {
      const guid = JSON.stringify([item.feedId, item.guid]),
        hash = JSON.stringify([item.feedId, item.hash]);
      if (guids.has(guid) || hashes.has(hash)) return false;
      guids.add(guid);
      hashes.add(hash);
      return true;
    });
    const admission = this.admission?.();
    const jobs = this.queued
      ? new Map(
          [...new Set(pending.map((item) => item.feedId))].map((id) => [id, crypto.randomUUID()]),
        )
      : new Map<number, string>();
    const statements = [...jobs].map(([feedId, id]) =>
      this.storage.statement('INSERT INTO ingest_jobs(id,feed_id) VALUES(?,?)', [id, feedId]),
    );
    const offset = statements.length;
    statements.push(
      ...pending.flatMap((candidate) => {
        const item = candidate.prepare();
        const insert = this.storage.statement(
          `INSERT INTO articles(feed_id,guid,hash,url,title,author,summary_html,content_html,image_url,enclosure_url,enclosure_type,published_at)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS
         (SELECT 1 FROM articles WHERE feed_id=? AND (guid=? OR hash=?))
         ${admission ? `AND (${admission.predicate})` : ''} RETURNING id`,
          [
            item.feedId,
            item.guid,
            item.hash,
            item.url,
            item.title,
            item.author,
            item.summaryHtml,
            item.contentHtml,
            item.imageUrl,
            item.enclosureUrl,
            item.enclosureType,
            item.publishedAt.getTime(),
            item.feedId,
            item.guid,
            item.hash,
            ...(admission?.values ?? []),
          ],
        );
        return this.queued
          ? [
              insert,
              this.storage.statement(
                'INSERT INTO ingest_job_items(article_id,job_id) SELECT id,? FROM articles WHERE feed_id=? AND guid=? AND changes()>0',
                [jobs.get(item.feedId), item.feedId, item.guid],
              ),
            ]
          : [insert];
      }),
    );
    if (jobs.size)
      statements.push(
        this.storage.statement(
          'DELETE FROM ingest_jobs WHERE id IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM ingest_job_items WHERE job_id=ingest_jobs.id)',
          [JSON.stringify([...jobs.values()])],
        ),
      );
    if (admission)
      statements.push(
        this.storage.statement(`SELECT 1 AS id WHERE ${admission.predicate}`, admission.values),
      );
    const results = await this.storage.batch<{ id: number }>(statements);
    if (admission && !results.at(-1)?.results.length) throw this.admissionError(admission);
    return results
      .slice(offset, offset + pending.length * (this.queued ? 2 : 1))
      .filter((_, index) => !this.queued || index % 2 === 0)
      .flatMap((result) => result.results.map((row) => Number(row.id)));
  }
  async duplicateTitles(ids: number[], since: number): Promise<DuplicateTitles | null> {
    if (!ids.length) return null;
    const queries = duplicateTitleQueries(ids, since);
    const results = await this.storage.batch(
      Object.values(queries).map((query) => this.storage.statement(query.sql, query.values)),
    );
    return results[0]!.results[0]!.enabled
      ? {
          subjects: results[1]!.results as unknown as DuplicateTitles['subjects'],
          recent: results[2]!.results as unknown as DuplicateTitles['recent'],
        }
      : null;
  }
  async hideMany(ids: number[]) {
    if (!ids.length) return;
    const admission = this.admission?.();
    const results = await this.storage.batch([
      this.storage.statement(
        `UPDATE articles SET hidden=1 WHERE id IN (SELECT value FROM json_each(?))${admission ? ` AND (${admission.predicate})` : ''}`,
        [JSON.stringify(ids), ...(admission?.values ?? [])],
      ),
      ...(admission
        ? [this.storage.statement(`SELECT 1 WHERE ${admission.predicate}`, admission.values)]
        : []),
    ]);
    if (admission && !results.at(-1)?.results.length) throw this.admissionError(admission);
  }
  async prune(feedId: number, before: number) {
    const admission = this.admission?.();
    const guard = admission ? ` AND (${admission.predicate})` : '';
    const statements = [
      this.storage.statement(
        `UPDATE articles SET raw_html=NULL WHERE feed_id=? AND published_at<? AND raw_html IS NOT NULL${guard}`,
        [feedId, before, ...(admission?.values ?? [])],
      ),
      this.storage.statement(
        `DELETE FROM articles WHERE feed_id=? AND published_at<? AND starred_at IS NULL AND NOT EXISTS(SELECT 1 FROM article_tags WHERE article_id=articles.id) AND ${pendingIngestArticle}${guard}`,
        [feedId, before, ...(admission?.values ?? [])],
      ),
    ];
    if (admission)
      statements.push(
        this.storage.statement(`SELECT 1 AS id WHERE ${admission.predicate}`, admission.values),
      );
    const results = await this.storage.batch(statements);
    if (admission && !results.at(-1)?.results.length) throw this.admissionError(admission);
  }
}
