import { and, asc, eq } from 'drizzle-orm';
import { articleText as text } from './article-text.js';
import { ruleLogPageSize, type RuleLogPage } from '../../../../packages/core/src/types/rules.js';
import type {
  RuleDraft,
  RuleLogRecord,
  RuleRecord,
  RuleScope,
  RuleCondition,
  RuleAction,
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
      .map((rule) => ({
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        position: rule.position,
        matchType: rule.matchType,
        scope: JSON.parse(rule.scopeJson) as RuleScope,
        conditions: JSON.parse(rule.conditionsJson) as RuleCondition[],
        actions: JSON.parse(rule.actionsJson) as RuleAction[],
        stopProcessing: rule.stopProcessing,
      }));
  }
  context(articleId: number): ArticleContext | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT a.id, a.title, a.author, a.url, a.summary_html, a.content_html, a.full_text_html, f.id AS feed_id, f.title AS feed, fo.id AS folder_id, coalesce(fo.title, '') AS folder FROM articles a JOIN feeds f ON f.id = a.feed_id LEFT JOIN folders fo ON fo.id = f.folder_id WHERE a.id = ?`,
      )
      .get(articleId) as
      | {
          id: number;
          title: string;
          author: string | null;
          url: string;
          summary_html: string | null;
          content_html: string | null;
          full_text_html: string | null;
          feed_id: number;
          feed: string;
          folder_id: number | null;
          folder: string;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          title: row.title,
          content: text(row.full_text_html ?? row.content_html ?? row.summary_html),
          author: row.author ?? '',
          url: row.url,
          feedId: row.feed_id,
          feed: row.feed,
          folderId: row.folder_id,
          folder: row.folder,
        }
      : null;
  }

  list(at: Date): RuleRecord[] {
    const now = at.getTime();
    const counts = this.database.sqlite
      .prepare(
        `SELECT rule_id AS ruleId,
      sum(CASE WHEN executed_at >= ? THEN 1 ELSE 0 END) AS hits24h,
      sum(CASE WHEN executed_at >= ? THEN 1 ELSE 0 END) AS hits30d
      FROM rule_logs GROUP BY rule_id`,
      )
      .all(now - 86_400_000, now - 2_592_000_000) as Array<{
      ruleId: number;
      hits24h: number;
      hits30d: number;
    }>;
    const byRule = new Map(counts.map((row) => [row.ruleId, row]));
    return this.database.db
      .select()
      .from(rules)
      .orderBy(asc(rules.position), asc(rules.id))
      .all()
      .map((rule) => ({
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        position: rule.position,
        matchType: rule.matchType,
        scope: JSON.parse(rule.scopeJson) as RuleScope,
        conditions: JSON.parse(rule.conditionsJson) as RuleCondition[],
        actions: JSON.parse(rule.actionsJson) as RuleAction[],
        stopProcessing: rule.stopProcessing,
        hits24h: byRule.get(rule.id)?.hits24h ?? 0,
        hits30d: byRule.get(rule.id)?.hits30d ?? 0,
      }));
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
          `SELECT l.id, l.article_id AS articleId,
      a.title AS articleTitle, l.executed_at AS executedAt, l.actions_taken_json AS actionsJson
      FROM rule_logs l JOIN articles a ON a.id = l.article_id
      WHERE l.rule_id = ? ORDER BY l.executed_at DESC LIMIT 100`,
        )
        .all(ruleId) as Array<{
        id: number;
        articleId: number;
        articleTitle: string;
        executedAt: number;
        actionsJson: string;
      }>
    ).map((row) => ({
      id: row.id,
      articleId: row.articleId,
      articleTitle: row.articleTitle,
      executedAt: new Date(row.executedAt).toISOString(),
      actions: JSON.parse(row.actionsJson),
    }));
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
          `SELECT l.id, l.article_id AS articleId, a.title AS articleTitle, l.executed_at AS executedAt, l.actions_taken_json AS actionsJson FROM rule_logs l JOIN articles a ON a.id=l.article_id WHERE l.rule_id=? ORDER BY l.executed_at DESC,l.id DESC LIMIT ? OFFSET ?`,
        )
        .all(ruleId, ruleLogPageSize, (page - 1) * ruleLogPageSize) as Array<{
        id: number;
        articleId: number;
        articleTitle: string;
        executedAt: number;
        actionsJson: string;
      }>;
      return {
        items: rows.map(({ executedAt, actionsJson, ...row }) => ({
          ...row,
          executedAt: new Date(executedAt).toISOString(),
          actions: JSON.parse(actionsJson),
        })),
        total,
        page,
        pageSize: ruleLogPageSize,
      };
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
    const clauses: string[] = [];
    const parameters: number[] = [];
    if (options.since !== undefined) {
      clauses.push('published_at >= ?');
      parameters.push(options.since);
    }
    if (options.visibleOnly) clauses.push('hidden = 0');
    return (
      this.database.sqlite
        .prepare(
          `SELECT id FROM articles ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY published_at DESC`,
        )
        .all(...parameters) as Array<{ id: number }>
    ).map(({ id }) => id);
  }
  publishedAt(id: number): Date {
    return this.database.db
      .select({ publishedAt: articles.publishedAt })
      .from(articles)
      .where(eq(articles.id, id))
      .get()!.publishedAt;
  }
}
