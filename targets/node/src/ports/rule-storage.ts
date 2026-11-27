import {
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
  type RuleContextRow,
  type RuleHitsRow,
  type RuleLogRow,
} from '../../../../packages/db/src/rule-queries.js';
import { asc, eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { ruleCommitQueries, ruleTagQueries } from '../../../../packages/db/src/rule-mutations.js';
import type { SqlQuery } from '../../../../packages/db/src/reader-queries.js';
import { ruleLogPageSize, type RuleLogPage } from '../../../../packages/core/src/types/rules.js';
import type {
  RuleDraft,
  RuleLogRecord,
  RuleRecord,
} from '../../../../packages/core/src/types/rules.js';
import type {
  ActionResult,
  ArticleChanges,
  ArticleContext,
  RuleStoragePort,
  RuleCommit,
  RuleTagAction,
} from '../../../../packages/core/src/ports.js';
import type { BrewDatabase } from '../db/database.js';
import { articles, ruleLogs, rules } from '../db/schema.js';
export class NodeRuleStorage implements RuleStoragePort {
  constructor(private readonly database: BrewDatabase) {}
  definitions(): RuleRecord[] {
    return this.database.db
      .select()
      .from(rules)
      .orderBy(asc(rules.position), asc(rules.id))
      .all()
      .map(ruleRecord);
  }
  context(id: number): ArticleContext | null {
    const built = ruleContextQuery(id);
    const row = this.database.sqlite.prepare(built.sql).get(...built.values) as
      RuleContextRow | undefined;
    return row ? ruleContext(row) : null;
  }
  contexts(ids: number[]) {
    if (!ids.length) return [];
    const built = ruleContextsQuery(ids);
    return (this.database.sqlite.prepare(built.sql).all(...built.values) as RuleContextRow[]).map(
      ruleCandidate,
    );
  }
  list(at: Date): RuleRecord[] {
    const built = ruleHitsQuery(at.getTime());
    const hits = this.database.sqlite.prepare(built.sql).all(...built.values) as RuleHitsRow[];
    const rows = this.database.db
      .select()
      .from(rules)
      .orderBy(asc(rules.position), asc(rules.id))
      .all();
    return rulesWithHits(rows, hits);
  }
  create(draft: RuleDraft & { position: number }): number {
    const inserted = this.database.db
      .insert(rules)
      .values({
        name: draft.name.trim(),
        enabled: draft.enabled,
        position: draft.position,
        matchType: draft.matchType,
        scopeJson: JSON.stringify(draft.scope),
        conditionsJson: JSON.stringify(draft.conditions),
        actionsJson: JSON.stringify(draft.actions),
        stopProcessing: draft.stopProcessing,
      })
      .returning()
      .get();
    return inserted.id;
  }

  update(id: number, draft: RuleDraft, now: Date): boolean {
    const updated = this.database.db
      .update(rules)
      .set({
        name: draft.name.trim(),
        enabled: draft.enabled,
        ...(draft.position === undefined ? {} : { position: draft.position }),
        matchType: draft.matchType,
        scopeJson: JSON.stringify(draft.scope),
        conditionsJson: JSON.stringify(draft.conditions),
        actionsJson: JSON.stringify(draft.actions),
        stopProcessing: draft.stopProcessing,
        updatedAt: now,
      })
      .where(eq(rules.id, id))
      .returning({ id: rules.id })
      .get();
    return Boolean(updated);
  }
  delete(id: number): boolean {
    return this.database.db.delete(rules).where(eq(rules.id, id)).run().changes > 0;
  }

  logs(ruleId: number): RuleLogRecord[] {
    return (
      this.database.sqlite
        .prepare(
          `SELECT ${ruleLogColumns} FROM rule_logs l JOIN articles a ON a.id=l.article_id WHERE l.rule_id=? ORDER BY l.executed_at DESC LIMIT 100`,
        )
        .all(ruleId) as RuleLogRow[]
    ).map(ruleLog);
  }
  logPage(ruleId: number, page: number): RuleLogPage {
    return this.database.sqlite.transaction(() => {
      const { total } = this.database.sqlite
        .prepare(
          'SELECT count(*) AS total FROM rule_logs l JOIN articles a ON a.id=l.article_id WHERE l.rule_id=?',
        )
        .get(ruleId) as { total: number };
      const rows = this.database.sqlite
        .prepare(
          `SELECT ${ruleLogColumns} FROM rule_logs l JOIN articles a ON a.id=l.article_id WHERE l.rule_id=? ORDER BY l.executed_at DESC,l.id DESC LIMIT ? OFFSET ?`,
        )
        .all(ruleId, ruleLogPageSize, (page - 1) * ruleLogPageSize) as RuleLogRow[];
      return { items: rows.map(ruleLog), total, page, pageSize: ruleLogPageSize };
    })();
  }
  addTag(articleId: number, name: string): void {
    this.runQueries(ruleTagQueries(articleId, { type: 'add_tag', tag: name }));
  }
  removeTag(articleId: number, name: string): void {
    this.runQueries(ruleTagQueries(articleId, { type: 'remove_tag', tag: name }));
  }
  private runQueries(queries: SqlQuery[]): void {
    this.database.sqlite.transaction(() => {
      for (const query of queries) this.database.sqlite.prepare(query.sql).run(...query.values);
    })();
  }
  applyTagActions(articleId: number, actions: RuleTagAction[]): ActionResult[] {
    if (!actions.length) return [];
    try {
      this.runQueries(actions.flatMap((action) => ruleTagQueries(articleId, action)));
      return actions.map(({ type }) => ({ type, ok: true }));
    } catch (error) {
      // Only a confirmed constraint rollback or pre-execution validation permits
      // individual fallback. Storage/commit failures propagate to the caller.
      if (
        !(error instanceof TypeError) &&
        !(error instanceof Database.SqliteError && error.code.startsWith('SQLITE_CONSTRAINT'))
      )
        throw error;
    }
    return actions.map((action) => {
      try {
        if (action.type === 'add_tag') this.addTag(articleId, action.tag);
        else this.removeTag(articleId, action.tag);
        return { type: action.type, ok: true };
      } catch (error) {
        return {
          type: action.type,
          ok: false,
          error: error instanceof Error ? error.message : 'Action failed',
        };
      }
    });
  }
  commitRule(value: RuleCommit): void {
    this.runQueries(ruleCommitQueries(value));
  }
  updateArticle(id: number, changes: ArticleChanges): void {
    this.database.db.update(articles).set(changes).where(eq(articles.id, id)).run();
  }
  log(ruleId: number, articleId: number, results: ActionResult[]): void {
    this.database.db
      .insert(ruleLogs)
      .values({ ruleId, articleId, actionsTakenJson: JSON.stringify(results) })
      .run();
  }
  articleIds(options: { since?: number; visibleOnly?: boolean }): number[] {
    const built = ruleArticleIdsQuery(options);
    return (
      this.database.sqlite.prepare(built.sql).all(...built.values) as Array<{ id: number }>
    ).map((row) => row.id);
  }
  publishedAt(id: number): Date {
    return this.database.db
      .select({ publishedAt: articles.publishedAt })
      .from(articles)
      .where(eq(articles.id, id))
      .get()!.publishedAt;
  }
}
