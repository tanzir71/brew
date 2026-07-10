import { and, asc, eq } from 'drizzle-orm';
import { parseHTML } from 'linkedom';
import type { RuleAction, RuleCondition, RuleScope } from '../../shared/rules.js';
import type { BrewDatabase } from '../db/database.js';
import { articleTags, articles, ruleLogs, rules, tags } from '../db/schema.js';
import { safeRegexTest } from './safe-regex.js';

type Fetch = typeof globalThis.fetch;
interface ArticleContext { id: number; title: string; content: string; author: string; url: string; feedId: number; feed: string; folderId: number | null; folder: string }
interface ActionResult { type: RuleAction['type']; ok: boolean; error?: string }
type Notify = (article: { id: number; title: string; url: string }) => void;

const text = (html: string | null): string => html ? (parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body.textContent ?? '') : '';
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase();

export class RulesService {
  constructor(private readonly database: BrewDatabase, private readonly fetcher: Fetch = globalThis.fetch, private readonly notify: Notify = () => undefined) {}

  private context(articleId: number): ArticleContext | null {
    const row = this.database.sqlite.prepare(`SELECT a.id, a.title, a.author, a.url, a.summary_html, a.content_html, a.full_text_html, f.id AS feed_id, f.title AS feed, fo.id AS folder_id, coalesce(fo.title, '') AS folder FROM articles a JOIN feeds f ON f.id = a.feed_id LEFT JOIN folders fo ON fo.id = f.folder_id WHERE a.id = ?`).get(articleId) as { id: number; title: string; author: string | null; url: string; summary_html: string | null; content_html: string | null; full_text_html: string | null; feed_id: number; feed: string; folder_id: number | null; folder: string } | undefined;
    return row ? { id: row.id, title: row.title, content: text(row.full_text_html ?? row.content_html ?? row.summary_html), author: row.author ?? '', url: row.url, feedId: row.feed_id, feed: row.feed, folderId: row.folder_id, folder: row.folder } : null;
  }

  private inScope(context: ArticleContext, scope: RuleScope): boolean {
    const hasFeeds = Boolean(scope.feedIds?.length); const hasFolders = Boolean(scope.folderIds?.length);
    if (!hasFeeds && !hasFolders) return true;
    return Boolean(scope.feedIds?.includes(context.feedId) || (context.folderId !== null && scope.folderIds?.includes(context.folderId)));
  }

  async conditionMatches(context: ArticleContext, condition: RuleCondition): Promise<boolean> {
    const source = normalized(String(context[condition.field] ?? ''));
    const target = normalized(condition.value);
    switch (condition.operator) {
      case 'contains': return source.includes(target);
      case 'not_contains': return !source.includes(target);
      case 'equals': return source === target;
      case 'starts_with': return source.startsWith(target);
      case 'ends_with': return source.endsWith(target);
      case 'matches_regex': return (await safeRegexTest(condition.value, String(context[condition.field] ?? ''))).matched;
    }
  }

  private async executeActions(rule: typeof rules.$inferSelect, context: ArticleContext, actions: RuleAction[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    const changes: Partial<typeof articles.$inferInsert> = {};
    for (const action of actions) {
      try {
        switch (action.type) {
          case 'add_tag': { this.database.db.insert(tags).values({ name: action.tag, color: '#b45309' }).onConflictDoNothing({ target: tags.name }).run(); const tag = this.database.db.select().from(tags).where(eq(tags.name, action.tag)).get()!; this.database.db.insert(articleTags).values({ articleId: context.id, tagId: tag.id }).onConflictDoNothing().run(); break; }
          case 'remove_tag': { const tag = this.database.db.select().from(tags).where(eq(tags.name, action.tag)).get(); if (tag) this.database.db.delete(articleTags).where(and(eq(articleTags.articleId, context.id), eq(articleTags.tagId, tag.id))).run(); break; }
          case 'star': changes.starredAt = new Date(); break;
          case 'mark_read': changes.readAt = new Date(); break;
          case 'hide': changes.hidden = true; break;
          case 'highlight': changes.highlightColor = action.color; break;
          case 'feature_in_brew': changes.featuredInBrew = true; changes.excludedFromBrew = false; break;
          case 'exclude_from_brew': changes.excludedFromBrew = true; changes.featuredInBrew = false; break;
          case 'notify': this.notify({ id: context.id, title: context.title, url: context.url }); break;
          case 'webhook': {
            const payload = JSON.stringify({ article: { id: context.id, title: context.title, url: context.url }, rule: { id: rule.id, name: rule.name } });
            let lastError = 'Webhook failed';
            for (let attempt = 0; attempt < 2; attempt++) { try { const response = await this.fetcher(action.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: AbortSignal.timeout(5_000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); lastError = ''; break; } catch (error) { lastError = error instanceof Error ? error.message : 'Webhook failed'; } }
            if (lastError) throw new Error(lastError);
            break;
          }
        }
        results.push({ type: action.type, ok: true });
      } catch (error) { results.push({ type: action.type, ok: false, error: error instanceof Error ? error.message : 'Action failed' }); }
    }
    if (Object.keys(changes).length) this.database.db.update(articles).set(changes).where(eq(articles.id, context.id)).run();
    return results;
  }

  async evaluateArticle(articleId: number): Promise<number> {
    const context = this.context(articleId); if (!context) return 0;
    const ordered = this.database.db.select().from(rules).where(eq(rules.enabled, true)).orderBy(asc(rules.position), asc(rules.id)).all();
    let matched = 0;
    for (const rule of ordered) {
      const scope = JSON.parse(rule.scopeJson) as RuleScope; if (!this.inScope(context, scope)) continue;
      const conditions = JSON.parse(rule.conditionsJson) as RuleCondition[]; if (conditions.length > 10) continue;
      const matches = await Promise.all(conditions.map((condition) => this.conditionMatches(context, condition)));
      const isMatch = conditions.length === 0 || (rule.matchType === 'all' ? matches.every(Boolean) : matches.some(Boolean));
      if (!isMatch) continue;
      const actions = JSON.parse(rule.actionsJson) as RuleAction[];
      const results = await this.executeActions(rule, context, actions);
      this.database.db.insert(ruleLogs).values({ ruleId: rule.id, articleId, actionsTakenJson: JSON.stringify(results) }).run();
      matched++;
      if (rule.stopProcessing) break;
    }
    return matched;
  }
}
