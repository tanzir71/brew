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
import { and, asc, eq } from 'drizzle-orm';
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
} from '../../../../packages/core/src/ports.js';
import type { BrewDatabase } from '../db/database.js';
import { articleTags, articles, ruleLogs, rules, tags } from '../db/schema.js';
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
    this.database.db
      .insert(tags)
      .values({ name, color: '#b45309' })
      .onConflictDoNothing({ target: tags.name })
      .run();
    const tag = this.database.db.select().from(tags).where(eq(tags.name, name)).get()!;
    this.database.db
      .insert(articleTags)
      .values({ articleId, tagId: tag.id })
      .onConflictDoNothing()
      .run();
  }
  removeTag(articleId: number, name: string): void {
    const tag = this.database.db.select().from(tags).where(eq(tags.name, name)).get();
    if (tag)
      this.database.db
        .delete(articleTags)
        .where(and(eq(articleTags.articleId, articleId), eq(articleTags.tagId, tag.id)))
        .run();
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
