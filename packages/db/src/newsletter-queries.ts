import {
  defaultNewsletterSettings,
  senderInNewsletterView,
  type NewsletterSender,
  type NewsletterSettings,
  type NewsletterOverview,
  type NewsletterLetterQuery,
} from '../../core/src/types/newsletters.js';

export interface SenderRow {
  id: number;
  title: string;
  url: string;
  settings: string;
  retention: number;
  unread: number;
  total: number;
  latest: number | null;
}
export const senderSettings = (row: SenderRow): NewsletterSettings => ({
  ...defaultNewsletterSettings(),
  ...JSON.parse(row.settings),
  retentionDays: row.retention,
});
export const newsletterSender = (row: SenderRow): NewsletterSender => ({
  id: row.id,
  title: row.title,
  address: row.url.slice('mailto:'.length),
  settings: senderSettings(row),
  unreadCount: row.unread,
  letterCount: row.total,
  latestAt: row.latest === null ? null : new Date(row.latest).toISOString(),
});

export function newsletterSendersQuery(id?: number) {
  return {
    sql: `SELECT f.id,f.title,f.url,f.settings_json AS settings,f.retention_days AS retention,count(a.id) AS total,coalesce(sum(CASE WHEN a.id IS NOT NULL AND a.read_at IS NULL THEN 1 ELSE 0 END),0) AS unread,max(a.published_at) AS latest FROM feeds f LEFT JOIN articles a ON a.feed_id=f.id AND a.hidden=0 WHERE f.kind='newsletter' ${id === undefined ? '' : 'AND f.id=?'} GROUP BY f.id ORDER BY latest DESC,f.title COLLATE NOCASE,f.id`,
    values: id === undefined ? [] : [id],
  };
}
export const newsletterBrewsQuery = 'SELECT id,name FROM brew_configs ORDER BY id';
export const letterMetadataQuery =
  "SELECT a.feed_id,a.cleaning_json,a.raw_html IS NOT NULL AS original FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE a.id=? AND f.kind='newsletter'";
export const letterOriginalQuery =
  "SELECT a.raw_html AS html FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE a.id=? AND f.kind='newsletter'";
export const senderAffectedQuery =
  'SELECT a.id,a.raw_html IS NOT NULL AS original,a.starred_at IS NULL AND NOT EXISTS(SELECT 1 FROM article_tags t WHERE t.article_id=a.id) AND NOT EXISTS(SELECT 1 FROM ingest_job_items p WHERE p.article_id=a.id) AS discard FROM articles a WHERE a.feed_id=? AND a.published_at<? ORDER BY a.id';
export function senderAffectedSnapshotQuery(id: number, at: number, retention?: number) {
  return {
    sql: `SELECT a.id,a.raw_html IS NOT NULL AS original,a.starred_at IS NULL AND NOT EXISTS(SELECT 1 FROM article_tags t WHERE t.article_id=a.id) AND NOT EXISTS(SELECT 1 FROM ingest_job_items p WHERE p.article_id=a.id) AS discard
      FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE f.id=? AND a.published_at<?-coalesce(?,f.retention_days)*86400000
      AND coalesce(?,f.retention_days)<>f.retention_days ORDER BY a.id`,
    values: [id, at, retention ?? null, retention ?? null],
  };
}
export interface SenderAffectedRow {
  id: number;
  original: number;
  discard: number;
}
export type { NewsletterLetterRow } from '../../core/src/newsletter-library.js';

export function newsletterOverview(
  senders: NewsletterSender[],
  brews: Array<{ id: number; name: string }>,
): NewsletterOverview {
  const counts = { inbox: 0, favorites: 0, skipped: 0, blocked: 0 };
  let unreadCount = 0;
  for (const sender of senders) {
    for (const view of ['inbox', 'favorites', 'skipped', 'blocked'] as const)
      if (senderInNewsletterView(sender.settings, view)) counts[view] += sender.letterCount;
    if (senderInNewsletterView(sender.settings, 'inbox')) unreadCount += sender.unreadCount;
  }
  return {
    senders,
    unreadCount,
    counts,
    brews,
  };
}

export function newsletterLettersQuery(query: NewsletterLetterQuery) {
  const clauses = ["f.kind='newsletter'", 'a.hidden=0'];
  const params: number[] = [];
  const blocked = "coalesce(json_extract(f.settings_json,'$.blocked'),0)";
  const skipped = "coalesce(json_extract(f.settings_json,'$.skipInbox'),0)";
  if (query.view === 'blocked') clauses.push(`${blocked}=1`);
  else {
    clauses.push(`${blocked}<>1`);
    if (query.view === 'favorites') clauses.push("json_extract(f.settings_json,'$.favorite')=1");
    else clauses.push(`${skipped}${query.view === 'skipped' ? '=1' : '<>1'}`);
  }
  if (query.senderId !== undefined) {
    clauses.push('f.id=?');
    params.push(query.senderId);
  }
  const where = clauses.join(' AND ');
  return {
    count: {
      sql: `SELECT count(*) AS n FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE ${where}`,
      values: params,
    },
    rows: {
      sql: `SELECT a.id,f.id AS feedId,f.title AS feedTitle,a.title,substr(coalesce(a.summary_html,a.content_html,''),1,2500) AS excerpt,a.published_at AS publishedAt,a.read_at AS readAt,a.starred_at AS starredAt FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE ${where} ORDER BY a.published_at DESC,a.id DESC LIMIT ? OFFSET ?`,
      values: [...params, 50, (query.page - 1) * 50],
    },
  };
}
