import type {
  ActionResult,
  ArticleChanges,
  AsyncRuleStoragePort,
  RuleCommit,
  RuleTagAction,
} from '../../core/src/ports.js';
import { ruleLogPageSize, type RuleDraft } from '../../core/src/types/rules.js';
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
} from './rule-queries.js';
import type { AsyncSqlStorage } from './async-storage.js';
import { libraryRevision } from './async-storage.js';
import {
  ruleArticleQuery,
  ruleCommitQueries,
  ruleLogQuery,
  ruleTagQueries,
} from './rule-mutations.js';
import type { SqlQuery } from './reader-queries.js';

export class SqlRuleStorage<Statement> implements AsyncRuleStoragePort {
  constructor(
    private storage: AsyncSqlStorage<Statement>,
    private isConstraint: (error: unknown) => boolean,
  ) {}
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
    await this.runQueries(ruleTagQueries(articleId, { type: 'add_tag', tag: name }));
  }
  async removeTag(articleId: number, name: string) {
    await this.runQueries(ruleTagQueries(articleId, { type: 'remove_tag', tag: name }));
  }
  private async runQueries(queries: SqlQuery[]) {
    if (!queries.length) return;
    await this.storage.batch([
      ...queries.map(({ sql, values }) => this.storage.statement(sql, values)),
      libraryRevision(this.storage),
    ]);
  }
  async applyTagActions(articleId: number, actions: RuleTagAction[]): Promise<ActionResult[]> {
    if (!actions.length) return [];
    let queries: SqlQuery[];
    try {
      queries = actions.flatMap((action) => ruleTagQueries(articleId, action));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return this.individualTagActions(articleId, actions);
    }
    try {
      await this.runQueries(queries);
      return actions.map(({ type }) => ({ type, ok: true }));
    } catch (error) {
      // D1 also uses D1_ERROR for transport/timeouts. Those can have an unknown
      // write outcome; only SQLite constraint errors confirm batch rollback.
      if (!this.isConstraint(error)) throw error;
      return this.individualTagActions(articleId, actions);
    }
  }
  private async individualTagActions(articleId: number, actions: RuleTagAction[]) {
    const results: ActionResult[] = [];
    for (const action of actions) {
      try {
        if (action.type === 'add_tag') await this.addTag(articleId, action.tag);
        else await this.removeTag(articleId, action.tag);
        results.push({ type: action.type, ok: true });
      } catch (error) {
        results.push({
          type: action.type,
          ok: false,
          error: error instanceof Error ? error.message : 'Action failed',
        });
      }
    }
    return results;
  }
  async commitRule(value: RuleCommit) {
    await this.runQueries(ruleCommitQueries(value));
  }
  async updateArticle(id: number, changes: ArticleChanges) {
    const query = ruleArticleQuery(id, changes);
    if (query) await this.runQueries([query]);
  }
  async log(ruleId: number, articleId: number, results: ActionResult[]) {
    await this.runQueries([ruleLogQuery(ruleId, articleId, results)]);
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
