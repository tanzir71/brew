import { CloudflareStorage } from './storage.js';

export const NEWSLETTER_MAINTENANCE_PAGE_SIZE = 500;
const cursorKey = 'maintenance:newsletter-retention:cursor';
const pageKey = 'maintenance:newsletter-retention:page';
const cursor = `(SELECT value FROM settings WHERE key='${cursorKey}')`;
const page = `(SELECT value FROM settings WHERE key='${pageKey}')`;
const selected = `id IN (SELECT value FROM json_each(${page}))`;
const expired = `EXISTS(SELECT 1 FROM feeds f WHERE f.id=articles.feed_id
  AND f.kind='newsletter' AND articles.published_at<?-f.retention_days*86400000)`;

/** One bounded, atomic D1 call; the next Cron invocation continues the sweep. */
export async function maintainCloudflareNewsletters(storage: CloudflareStorage, now: Date) {
  const at = now.getTime();
  if (!Number.isFinite(at)) throw new Error('Invalid newsletter maintenance time.');
  const results = await storage.batch([
    storage.statement(
      `INSERT INTO settings(key,value) SELECT ?,json_object('after',0,'through',coalesce(max(a.id),0))
       FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE f.kind='newsletter'
       ON CONFLICT(key) DO UPDATE SET value=CASE
         WHEN json_valid(settings.value) THEN CASE
           WHEN json_type(settings.value,'$.after')='integer'
             AND json_type(settings.value,'$.through')='integer'
             AND json_extract(settings.value,'$.after')>=0
             AND json_extract(settings.value,'$.after')<json_extract(settings.value,'$.through')
           THEN settings.value ELSE excluded.value END
         ELSE excluded.value END`,
      [cursorKey],
    ),
    storage.statement(
      `INSERT INTO settings(key,value) SELECT ?,json_group_array(id) FROM (
        SELECT a.id FROM articles a JOIN feeds f ON f.id=a.feed_id
        WHERE f.kind='newsletter' AND a.id>json_extract(${cursor},'$.after')
          AND a.id<=json_extract(${cursor},'$.through') ORDER BY a.id LIMIT ?) WHERE 1
       ON CONFLICT(key) DO UPDATE SET value=excluded.value RETURNING json_array_length(value) AS scanned`,
      [pageKey, NEWSLETTER_MAINTENANCE_PAGE_SIZE],
    ),
    storage.statement(
      `UPDATE articles SET raw_html=NULL WHERE ${selected} AND raw_html IS NOT NULL AND ${expired}
       RETURNING 1 AS changed`,
      [at],
    ),
    storage.statement(
      `DELETE FROM articles WHERE ${selected} AND ${expired} AND starred_at IS NULL
       AND NOT EXISTS(SELECT 1 FROM article_tags WHERE article_id=articles.id) RETURNING 1 AS changed`,
      [at],
    ),
    storage.statement(
      `UPDATE settings SET value=json_object('after',
        CASE WHEN json_array_length(${page})<? THEN json_extract(value,'$.through')
        ELSE (SELECT max(value) FROM json_each(${page})) END,
        'through',json_extract(value,'$.through')) WHERE key=?`,
      [NEWSLETTER_MAINTENANCE_PAGE_SIZE, cursorKey],
    ),
    storage.statement('DELETE FROM settings WHERE key=?', [pageKey]),
  ]);
  return {
    scanned: Number(results[1]!.results[0]!.scanned),
    originalsCleared: results[2]!.results.length,
    deleted: results[3]!.results.length,
  };
}
