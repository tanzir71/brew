import { and, asc, eq } from 'drizzle-orm';
import { parseHTML } from 'linkedom';
import type {
  RuleAction,
  RuleCondition,
  RuleDraft,
  RulePreviewItem,
  RuleRecord,
  RuleScope,
} from '../../shared/rules.js';
import type { BrewDatabase } from '../db/database.js';
import { articleTags, articles, ruleLogs, rules, tags } from '../db/schema.js';
import { safeRegexTest } from './safe-regex.js';

type Fetch = typeof globalThis.fetch;
interface ArticleContext {
  id: number;
  title: string;
  content: string;
  author: string;
  url: string;
  feedId: number;
  feed: string;
  folderId: number | null;
  folder: string;
}
interface ActionResult {
  type: RuleAction['type'];
  ok: boolean;
  error?: string;
}
type Notify = (article: { id: number; title: string; url: string }) => void;

const text = (html: string | null): string =>
  html
    ? (parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body.textContent ??
      '')
    : '';
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase();

export class RulesService {
  constructor(
    private readonly database: BrewDatabase,
    private readonly fetcher: Fetch = globalThis.fetch,
    private readonly notify: Notify = () => undefined,
  ) {}

  private context(articleId: number): ArticleContext | null {
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

  private inScope(context: ArticleContext, scope: RuleScope): boolean {
    const hasFeeds = Boolean(scope.feedIds?.length);
    const hasFolders = Boolean(scope.folderIds?.length);
    if (!hasFeeds && !hasFolders) return true;
    return Boolean(
      scope.feedIds?.includes(context.feedId) ||
      (context.folderId !== null && scope.folderIds?.includes(context.folderId)),
    );
  }

  private async definitionMatches(
    context: ArticleContext,
    scope: RuleScope,
    matchType: 'all' | 'any',
    conditions: RuleCondition[],
  ): Promise<boolean> {
    if (!this.inScope(context, scope)) return false;
    const matches = await Promise.all(
      conditions.map((condition) => this.conditionMatches(context, condition)),
    );
    return (
      conditions.length === 0 ||
      (matchType === 'all' ? matches.every(Boolean) : matches.some(Boolean))
    );
  }

  async conditionMatches(context: ArticleContext, condition: RuleCondition): Promise<boolean> {
    const source = normalized(String(context[condition.field] ?? ''));
    const target = normalized(condition.value);
    switch (condition.operator) {
      case 'contains':
        return source.includes(target);
      case 'not_contains':
        return !source.includes(target);
      case 'equals':
        return source === target;
      case 'starts_with':
        return source.startsWith(target);
      case 'ends_with':
        return source.endsWith(target);
      case 'matches_regex':
        return (await safeRegexTest(condition.value, String(context[condition.field] ?? '')))
          .matched;
    }
  }

  private async executeActions(
    rule: typeof rules.$inferSelect,
    context: ArticleContext,
    actions: RuleAction[],
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    const changes: Partial<typeof articles.$inferInsert> = {};
    for (const action of actions) {
      try {
        switch (action.type) {
          case 'add_tag': {
            this.database.db
              .insert(tags)
              .values({ name: action.tag, color: '#b45309' })
              .onConflictDoNothing({ target: tags.name })
              .run();
            const tag = this.database.db
              .select()
              .from(tags)
              .where(eq(tags.name, action.tag))
              .get()!;
            this.database.db
              .insert(articleTags)
              .values({ articleId: context.id, tagId: tag.id })
              .onConflictDoNothing()
              .run();
            break;
          }
          case 'remove_tag': {
            const tag = this.database.db.select().from(tags).where(eq(tags.name, action.tag)).get();
            if (tag)
              this.database.db
                .delete(articleTags)
                .where(and(eq(articleTags.articleId, context.id), eq(articleTags.tagId, tag.id)))
                .run();
            break;
          }
          case 'star':
            changes.starredAt = new Date();
            break;
          case 'mark_read':
            changes.readAt = new Date();
            break;
          case 'hide':
            changes.hidden = true;
            break;
          case 'highlight':
            changes.highlightColor = action.color;
            break;
          case 'feature_in_brew':
            changes.featuredInBrew = true;
            changes.excludedFromBrew = false;
            break;
          case 'exclude_from_brew':
            changes.excludedFromBrew = true;
            changes.featuredInBrew = false;
            break;
          case 'notify':
            this.notify({ id: context.id, title: context.title, url: context.url });
            break;
          case 'webhook': {
            const payload = JSON.stringify({
              article: { id: context.id, title: context.title, url: context.url },
              rule: { id: rule.id, name: rule.name },
            });
            let lastError = 'Webhook failed';
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const response = await this.fetcher(action.url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: payload,
                  signal: AbortSignal.timeout(5_000),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                lastError = '';
                break;
              } catch (error) {
                lastError = error instanceof Error ? error.message : 'Webhook failed';
              }
            }
            if (lastError) throw new Error(lastError);
            break;
          }
        }
        results.push({ type: action.type, ok: true });
      } catch (error) {
        results.push({
          type: action.type,
          ok: false,
          error: error instanceof Error ? error.message : 'Action failed',
        });
      }
    }
    if (Object.keys(changes).length)
      this.database.db.update(articles).set(changes).where(eq(articles.id, context.id)).run();
    return results;
  }

  async evaluateArticle(articleId: number): Promise<number> {
    const context = this.context(articleId);
    if (!context) return 0;
    const ordered = this.database.db
      .select()
      .from(rules)
      .where(eq(rules.enabled, true))
      .orderBy(asc(rules.position), asc(rules.id))
      .all();
    let matched = 0;
    for (const rule of ordered) {
      const scope = JSON.parse(rule.scopeJson) as RuleScope;
      const conditions = JSON.parse(rule.conditionsJson) as RuleCondition[];
      if (conditions.length > 10) continue;
      if (!(await this.definitionMatches(context, scope, rule.matchType, conditions))) continue;
      const actions = JSON.parse(rule.actionsJson) as RuleAction[];
      const results = await this.executeActions(rule, context, actions);
      this.database.db
        .insert(ruleLogs)
        .values({ ruleId: rule.id, articleId, actionsTakenJson: JSON.stringify(results) })
        .run();
      matched++;
      if (rule.stopProcessing) break;
    }
    return matched;
  }

  list(): RuleRecord[] {
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

  private validate(draft: RuleDraft): void {
    if (!draft.name.trim()) throw new Error('Rule name is required');
    if (!['all', 'any'].includes(draft.matchType)) throw new Error('Invalid match type');
    if (draft.conditions.length > 10) throw new Error('A rule may have at most 10 conditions');
    if (!draft.actions.length) throw new Error('Add at least one action');
    for (const condition of draft.conditions) {
      if (!condition.value.trim()) throw new Error('Condition values are required');
      if (condition.operator === 'matches_regex') {
        try {
          new RegExp(condition.value, 'iu');
        } catch {
          throw new Error(`Invalid regular expression: ${condition.value}`);
        }
      }
    }
  }

  create(draft: RuleDraft): RuleRecord {
    this.validate(draft);
    const position =
      draft.position ??
      (this.database.db.select().from(rules).orderBy(asc(rules.position)).all().at(-1)?.position ??
        -1) + 1;
    const inserted = this.database.db
      .insert(rules)
      .values({
        name: draft.name.trim(),
        enabled: draft.enabled,
        position,
        matchType: draft.matchType,
        scopeJson: JSON.stringify(draft.scope),
        conditionsJson: JSON.stringify(draft.conditions),
        actionsJson: JSON.stringify(draft.actions),
        stopProcessing: draft.stopProcessing,
      })
      .returning()
      .get();
    return this.list().find((rule) => rule.id === inserted.id)!;
  }

  update(id: number, draft: RuleDraft): RuleRecord | null {
    this.validate(draft);
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
        updatedAt: new Date(),
      })
      .where(eq(rules.id, id))
      .returning({ id: rules.id })
      .get();
    return updated ? (this.list().find((rule) => rule.id === id) ?? null) : null;
  }
  delete(id: number): boolean {
    return this.database.db.delete(rules).where(eq(rules.id, id)).run().changes > 0;
  }

  async preview(
    draft: Pick<RuleDraft, 'scope' | 'matchType' | 'conditions'>,
  ): Promise<RulePreviewItem[]> {
    if (draft.conditions.length > 10) throw new Error('A rule may have at most 10 conditions');
    const ids = this.database.sqlite
      .prepare('SELECT id FROM articles WHERE hidden = 0 ORDER BY published_at DESC')
      .all() as Array<{ id: number }>;
    const matches: RulePreviewItem[] = [];
    for (const { id } of ids) {
      const context = this.context(id);
      if (
        !context ||
        !(await this.definitionMatches(context, draft.scope, draft.matchType, draft.conditions))
      )
        continue;
      const published = this.database.db
        .select({ publishedAt: articles.publishedAt })
        .from(articles)
        .where(eq(articles.id, id))
        .get()!;
      matches.push({
        id,
        title: context.title,
        feedTitle: context.feed,
        publishedAt: published.publishedAt.toISOString(),
      });
      if (matches.length === 50) break;
    }
    return matches;
  }
}
