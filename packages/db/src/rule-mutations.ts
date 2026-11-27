import type {
  ActionResult,
  ArticleChanges,
  RuleCommit,
  RuleTagAction,
} from '../../core/src/ports.js';
import type { SqlQuery } from './reader-queries.js';

export function ruleTagQueries(articleId: number, action: RuleTagAction): SqlQuery[] {
  if (typeof action.tag !== 'string') throw new TypeError('A tag name must be a string');
  return action.type === 'add_tag'
    ? [
        {
          sql: "INSERT INTO tags(name,color) VALUES(?,'#b45309') ON CONFLICT(name) DO NOTHING",
          values: [action.tag],
        },
        {
          sql: 'INSERT OR IGNORE INTO article_tags(article_id,tag_id) SELECT ?,id FROM tags WHERE name=?',
          values: [articleId, action.tag],
        },
      ]
    : [
        {
          sql: 'DELETE FROM article_tags WHERE article_id=? AND tag_id IN (SELECT id FROM tags WHERE name=?)',
          values: [articleId, action.tag],
        },
      ];
}

export function ruleArticleQuery(id: number, changes: ArticleChanges): SqlQuery | null {
  const columns = {
    starredAt: 'starred_at',
    readAt: 'read_at',
    hidden: 'hidden',
    highlightColor: 'highlight_color',
    featuredInBrew: 'featured_in_brew',
    excludedFromBrew: 'excluded_from_brew',
  };
  const fields = Object.entries(changes).filter(([, value]) => value !== undefined) as Array<
    [keyof ArticleChanges, Date | boolean | string]
  >;
  if (!fields.length) return null;
  return {
    sql: `UPDATE articles SET ${fields.map(([key]) => `${columns[key]}=?`).join(',')} WHERE id=?`,
    values: [
      ...fields.map(([, value]) =>
        value instanceof Date || Object.prototype.toString.call(value) === '[object Date]'
          ? (value as Date).getTime()
          : typeof value === 'boolean'
            ? Number(value)
            : value,
      ),
      id,
    ],
  };
}

export function ruleLogQuery(ruleId: number, articleId: number, results: ActionResult[]): SqlQuery {
  return {
    sql: 'INSERT INTO rule_logs(rule_id,article_id,actions_taken_json) VALUES(?,?,?)',
    values: [ruleId, articleId, JSON.stringify(results)],
  };
}

export function ruleCommitQueries(value: RuleCommit): SqlQuery[] {
  const update = ruleArticleQuery(value.articleId, value.changes);
  return [...(update ? [update] : []), ruleLogQuery(value.ruleId, value.articleId, value.results)];
}
