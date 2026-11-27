import type { IngestCandidate, IngestStoragePort } from '../../../packages/core/src/ports.js';
import { CloudflareStorage } from './storage.js';
import { PollInterruptedError } from '../../../packages/core/src/feed-polling.js';

/** Trusted adapter predicate, evaluated atomically with article insertion. */
export type StorageAdmission = { predicate: string; values: unknown[]; error?: () => Error };
export type IngestAdmission = () => StorageAdmission;

export class CloudflareIngestStorage implements IngestStoragePort {
  constructor(
    protected readonly storage: CloudflareStorage,
    protected readonly admission?: IngestAdmission,
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
    const statements = pending.map((candidate) => {
      const item = candidate.prepare();
      return this.storage.statement(
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
    });
    if (admission)
      statements.push(
        this.storage.statement(`SELECT 1 AS id WHERE ${admission.predicate}`, admission.values),
      );
    const results = await this.storage.batch<{ id: number }>(statements);
    if (admission && !results.at(-1)?.results.length) throw this.admissionError(admission);
    return results
      .slice(0, pending.length)
      .flatMap((result) => result.results.map((row) => Number(row.id)));
  }
  async duplicateFilterEnabled() {
    return (
      (
        await this.storage.first<{ value: string }>(
          "SELECT value FROM settings WHERE key='duplicate_filter_enabled'",
        )
      )?.value === 'true'
    );
  }
  async title(id: number) {
    const article = await this.storage.first<{ title: string }>(
      'SELECT title FROM articles WHERE id=?',
      [id],
    );
    if (!article) throw new Error('Article not found');
    return article.title;
  }
  async recentTitles(excludeId: number, since: number) {
    return (
      await this.storage.all<{ title: string }>(
        'SELECT title FROM articles WHERE id!=? AND published_at>=?',
        [excludeId, since],
      )
    ).map((row) => row.title);
  }
  async hide(id: number) {
    await this.storage.run('UPDATE articles SET hidden=1 WHERE id=?', [id]);
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
        `DELETE FROM articles WHERE feed_id=? AND published_at<? AND starred_at IS NULL AND NOT EXISTS(SELECT 1 FROM article_tags WHERE article_id=articles.id)${guard}`,
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
