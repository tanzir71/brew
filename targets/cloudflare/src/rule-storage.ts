import type {
  ActionResult,
  ArticleChanges,
  AsyncRuleStoragePort,
} from '../../../packages/core/src/ports.js';
import { ruleLogPageSize, type RuleDraft } from '../../../packages/core/src/types/rules.js';
import {
  ruleColumns,
  ruleRecord,
  ruleContextQuery,
  ruleContextsQuery,
  ruleContext,
  ruleCandidate,
  ruleHitsQuery,
  rulesWithHits,
  ruleLogColumns,
  ruleLog,
  ruleArticleIdsQuery,
  type RuleRow,
  type RuleContextRow,
  type RuleHitsRow,
  type RuleLogRow,
} from '../../../packages/db/src/rule-queries.js';
import { CloudflareStorage } from './storage.js';
import { libraryRevision } from './events.js';

export class CloudflareRuleStorage implements AsyncRuleStoragePort {
  constructor(private storage: CloudflareStorage) {}
  async definitions() {
    return (
      await this.storage.all<RuleRow>(`SELECT ${ruleColumns} FROM rules ORDER BY position,id`)
    ).map(ruleRecord);
  }
  async context(id: number) {
    const built = ruleContextQuery(id);
    const row = await this.storage.first<RuleContextRow>(built.sql, built.values);
    return row ? ruleContext(row) : null;
  }
  async contexts(ids: number[]) {
    if (!ids.length) return [];
    const built = ruleContextsQuery(ids);
    return (await this.storage.all<RuleContextRow>(built.sql, built.values)).map(ruleCandidate);
  }
  async list(at: Date) {
    const hits = ruleHitsQuery(at.getTime());
    const result = await this.storage.batch([
      this.storage.statement(`SELECT ${ruleColumns} FROM rules ORDER BY position,id`),
      this.storage.statement(hits.sql, hits.values),
    ]);
    return rulesWithHits(
      result[0]!.results as unknown as RuleRow[],
      result[1]!.results as unknown as RuleHitsRow[],
    );
  }
  async create(draft: RuleDraft & { position: number }) {
    const result = await this.storage.batch([
      this.storage.statement(
        `INSERT INTO rules(name,enabled,position,match_type,scope_json,conditions_json,actions_json,stop_processing)
        VALUES(?,?,?,?,?,?,?,?) RETURNING id`,
        [
          draft.name.trim(),
          draft.enabled ? 1 : 0,
          draft.position,
          draft.matchType,
          JSON.stringify(draft.scope),
          JSON.stringify(draft.conditions),
          JSON.stringify(draft.actions),
          draft.stopProcessing ? 1 : 0,
        ],
      ),
      libraryRevision(this.storage),
    ]);
    return result[0]!.results[0]!.id as number;
  }
  async update(id: number, draft: RuleDraft, now: Date) {
    const position = draft.position === undefined ? '' : ',position=?';
    const result = await this.storage.batch([
      this.storage.statement(
        `UPDATE rules SET name=?,enabled=?,match_type=?,scope_json=?,conditions_json=?,actions_json=?,stop_processing=?,updated_at=?${position} WHERE id=? RETURNING id`,
        [
          draft.name.trim(),
          draft.enabled ? 1 : 0,
          draft.matchType,
          JSON.stringify(draft.scope),
          JSON.stringify(draft.conditions),
          JSON.stringify(draft.actions),
          draft.stopProcessing ? 1 : 0,
          now.getTime(),
          ...(draft.position === undefined ? [] : [draft.position]),
          id,
        ],
      ),
      libraryRevision(this.storage),
    ]);
    return result[0]!.results.length > 0;
  }
  async delete(id: number) {
    const result = await this.storage.batch([
      this.storage.statement('DELETE FROM rules WHERE id=? RETURNING id', [id]),
      libraryRevision(this.storage),
    ]);
    return result[0]!.results.length > 0;
  }
  async logs(ruleId: number) {
    return (
      await this.storage.all<RuleLogRow>(
        `SELECT ${ruleLogColumns} FROM rule_logs l JOIN articles a ON a.id=l.article_id WHERE l.rule_id=? ORDER BY l.executed_at DESC LIMIT 100`,
        [ruleId],
      )
    ).map(ruleLog);
  }
  async logPage(ruleId: number, page: number) {
    const result = await this.storage.batch([
      this.storage.statement(
        'SELECT count(*) AS total FROM rule_logs l JOIN articles a ON a.id=l.article_id WHERE l.rule_id=?',
        [ruleId],
      ),
      this.storage.statement(
        `SELECT ${ruleLogColumns} FROM rule_logs l JOIN articles a ON a.id=l.article_id WHERE l.rule_id=? ORDER BY l.executed_at DESC,l.id DESC LIMIT ? OFFSET ?`,
        [ruleId, ruleLogPageSize, (page - 1) * ruleLogPageSize],
      ),
    ]);
    return {
      items: (result[1]!.results as unknown as RuleLogRow[]).map(ruleLog),
      total: Number(result[0]!.results[0]!.total),
      page,
      pageSize: ruleLogPageSize,
    };
  }
  async addTag(articleId: number, name: string) {
    await this.storage.batch([
      this.storage.statement("INSERT OR IGNORE INTO tags(name,color) VALUES(?,'#b45309')", [name]),
      this.storage.statement(
        'INSERT OR IGNORE INTO article_tags(article_id,tag_id) SELECT ?,id FROM tags WHERE name=?',
        [articleId, name],
      ),
      libraryRevision(this.storage),
    ]);
  }
  async removeTag(articleId: number, name: string) {
    await this.storage.batch([
      this.storage.statement(
        'DELETE FROM article_tags WHERE article_id=? AND tag_id IN (SELECT id FROM tags WHERE name=?)',
        [articleId, name],
      ),
      libraryRevision(this.storage),
    ]);
  }
  async updateArticle(id: number, changes: ArticleChanges) {
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
    if (!fields.length) return;
    await this.storage.batch([
      this.storage.statement(
        `UPDATE articles SET ${fields.map(([key]) => `${columns[key]}=?`).join(',')} WHERE id=?`,
        [
          ...fields.map(([, value]) =>
            value instanceof Date
              ? value.getTime()
              : typeof value === 'boolean'
                ? Number(value)
                : value,
          ),
          id,
        ],
      ),
      libraryRevision(this.storage),
    ]);
  }
  async log(ruleId: number, articleId: number, results: ActionResult[]) {
    await this.storage.batch([
      this.storage.statement(
        'INSERT INTO rule_logs(rule_id,article_id,actions_taken_json) VALUES(?,?,?)',
        [ruleId, articleId, JSON.stringify(results)],
      ),
      libraryRevision(this.storage),
    ]);
  }
  async articleIds(options: { since?: number; visibleOnly?: boolean }) {
    const built = ruleArticleIdsQuery(options);
    return (await this.storage.all<{ id: number }>(built.sql, built.values)).map((row) => row.id);
  }
  async publishedAt(id: number) {
    const row = await this.storage.first<{ value: number }>(
      'SELECT published_at AS value FROM articles WHERE id=?',
      [id],
    );
    if (!row) throw new Error('Article not found');
    return new Date(row.value);
  }
}
