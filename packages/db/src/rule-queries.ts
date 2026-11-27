import { articleText } from '../../core/src/article-reading.js';
import type { ArticleContext, RuleCandidate } from '../../core/src/ports.js';
import type { RuleRecord, RuleLogRecord } from '../../core/src/types/rules.js';
import type { SqlQuery } from './reader-queries.js';

export interface RuleRow {
  id: number;
  name: string;
  enabled: number | boolean;
  position: number;
  matchType: 'all' | 'any';
  scopeJson: string;
  conditionsJson: string;
  actionsJson: string;
  stopProcessing: number | boolean;
}
export const ruleColumns =
  'id,name,enabled,position,match_type AS matchType,scope_json AS scopeJson,conditions_json AS conditionsJson,actions_json AS actionsJson,stop_processing AS stopProcessing';
export function ruleRecord(row: RuleRow): RuleRecord {
  return {
    id: row.id,
    name: row.name,
    enabled: !!row.enabled,
    position: row.position,
    matchType: row.matchType,
    scope: JSON.parse(row.scopeJson),
    conditions: JSON.parse(row.conditionsJson),
    actions: JSON.parse(row.actionsJson),
    stopProcessing: !!row.stopProcessing,
  };
}
export interface RuleHitsRow {
  ruleId: number;
  hits24h: number;
  hits30d: number;
}
export function ruleHitsQuery(now: number): SqlQuery {
  return {
    sql: `SELECT rule_id AS ruleId,sum(CASE WHEN executed_at>=? THEN 1 ELSE 0 END) AS hits24h,
    sum(CASE WHEN executed_at>=? THEN 1 ELSE 0 END) AS hits30d FROM rule_logs GROUP BY rule_id`,
    values: [now - 86_400_000, now - 2_592_000_000],
  };
}
export function rulesWithHits(rows: RuleRow[], hits: RuleHitsRow[]): RuleRecord[] {
  const byId = new Map(hits.map((row) => [row.ruleId, row]));
  return rows.map((row) => ({
    ...ruleRecord(row),
    hits24h: byId.get(row.id)?.hits24h ?? 0,
    hits30d: byId.get(row.id)?.hits30d ?? 0,
  }));
}
export interface RuleContextRow {
  id: number;
  title: string;
  author: string | null;
  url: string;
  body: string | null;
  feedId: number;
  feed: string;
  folderId: number | null;
  folder: string;
  publishedAt: number;
}
const contextColumns = `a.id,a.title,a.author,a.url,coalesce(a.full_text_html,a.content_html,a.summary_html) AS body,
  f.id AS feedId,f.title AS feed,fo.id AS folderId,coalesce(fo.title,'') AS folder,a.published_at AS publishedAt`;
const contextJoins =
  'FROM articles a JOIN feeds f ON f.id=a.feed_id LEFT JOIN folders fo ON fo.id=f.folder_id';
export function ruleContextQuery(id: number): SqlQuery {
  return { sql: `SELECT ${contextColumns} ${contextJoins} WHERE a.id=?`, values: [id] };
}
export function ruleContextsQuery(ids: number[]): SqlQuery {
  return {
    sql: `SELECT ${contextColumns} ${contextJoins} WHERE a.id IN (SELECT value FROM json_each(?))`,
    values: [JSON.stringify(ids)],
  };
}
export function ruleContext(row: RuleContextRow): ArticleContext {
  return {
    id: row.id,
    title: row.title,
    content: articleText(row.body),
    author: row.author ?? '',
    url: row.url,
    feedId: row.feedId,
    feed: row.feed,
    folderId: row.folderId,
    folder: row.folder,
  };
}
export function ruleCandidate(row: RuleContextRow): RuleCandidate {
  return { ...ruleContext(row), publishedAt: new Date(row.publishedAt) };
}
export interface RuleLogRow {
  id: number;
  articleId: number;
  articleTitle: string;
  executedAt: number;
  actionsJson: string;
}
export const ruleLogColumns =
  'l.id,l.article_id AS articleId,a.title AS articleTitle,l.executed_at AS executedAt,l.actions_taken_json AS actionsJson';
export function ruleLog(row: RuleLogRow): RuleLogRecord {
  return {
    id: row.id,
    articleId: row.articleId,
    articleTitle: row.articleTitle,
    executedAt: new Date(row.executedAt).toISOString(),
    actions: JSON.parse(row.actionsJson),
  };
}
export function ruleArticleIdsQuery(options: { since?: number; visibleOnly?: boolean }): SqlQuery {
  const clauses: string[] = [],
    values: number[] = [];
  if (options.since !== undefined) {
    clauses.push('published_at>=?');
    values.push(options.since);
  }
  if (options.visibleOnly) clauses.push('hidden=0');
  return {
    sql: `SELECT id FROM articles ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY published_at DESC`,
    values,
  };
}
