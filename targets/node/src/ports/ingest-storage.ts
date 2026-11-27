import { and, eq, or } from 'drizzle-orm';
import type {
  IngestStoragePort,
  IngestCandidate,
  DuplicateTitles,
} from '../../../../packages/core/src/ports.js';
import { duplicateTitleQueries } from '../../../../packages/db/src/ingest-queries.js';
import type { BrewDatabase } from '../db/database.js';
import { articles } from '../db/schema.js';
import { randomUUID } from 'node:crypto';
import { pendingIngestArticle } from '../../../../packages/db/src/ingest-job-queries.js';

export class NodeIngestStorage implements IngestStoragePort {
  constructor(
    protected readonly database: BrewDatabase,
    protected readonly queued = false,
  ) {}
  insertBatch(items: IngestCandidate[]): number[] {
    return this.database.sqlite.transaction(() => {
      const ids: number[] = [];
      const jobs = new Map<number, string>();
      for (const item of items) {
        const duplicate = this.database.db
          .select({ id: articles.id })
          .from(articles)
          .where(
            and(
              eq(articles.feedId, item.feedId),
              or(eq(articles.guid, item.guid), eq(articles.hash, item.hash)),
            ),
          )
          .get();
        if (duplicate) continue;
        const id = this.database.db
          .insert(articles)
          .values(item.prepare())
          .returning({ id: articles.id })
          .get().id;
        ids.push(id);
        if (this.queued) {
          let job = jobs.get(item.feedId);
          if (!job) {
            job = randomUUID();
            jobs.set(item.feedId, job);
            this.database.sqlite
              .prepare('INSERT INTO ingest_jobs(id,feed_id) VALUES(?,?)')
              .run(job, item.feedId);
          }
          this.database.sqlite
            .prepare('INSERT INTO ingest_job_items(article_id,job_id) VALUES(?,?)')
            .run(id, job);
        }
      }
      return ids;
    })();
  }
  duplicateTitles(ids: number[], since: number): DuplicateTitles | null {
    if (!ids.length) return null;
    const queries = duplicateTitleQueries(ids, since);
    return this.database.sqlite.transaction(() => {
      const enabled = this.database.sqlite.prepare(queries.enabled.sql).get() as {
        enabled: number;
      };
      if (!enabled.enabled) return null;
      return {
        subjects: this.database.sqlite
          .prepare(queries.subjects.sql)
          .all(...queries.subjects.values),
        recent: this.database.sqlite.prepare(queries.recent.sql).all(...queries.recent.values),
      } as DuplicateTitles;
    })();
  }
  hideMany(ids: number[]): void {
    if (ids.length)
      this.database.sqlite
        .prepare('UPDATE articles SET hidden=1 WHERE id IN (SELECT value FROM json_each(?))')
        .run(JSON.stringify(ids));
  }
  prune(feedId: number, before: number): void {
    // Starred/tagged stories keep their cleaned text, but never retain original
    // email HTML beyond the sender's retention window.
    this.database.sqlite
      .prepare(
        'UPDATE articles SET raw_html = NULL WHERE feed_id = ? AND published_at < ? AND raw_html IS NOT NULL',
      )
      .run(feedId, before);
    this.database.sqlite
      .prepare(
        `DELETE FROM articles WHERE feed_id = ? AND published_at < ? AND starred_at IS NULL AND NOT EXISTS (SELECT 1 FROM article_tags WHERE article_id = articles.id) AND ${pendingIngestArticle}`,
      )
      .run(feedId, before);
  }
}
