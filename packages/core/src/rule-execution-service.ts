import type {
  RuleAction,
  RuleCondition,
  RuleDraft,
  RulePreviewItem,
  RuleRecord,
  RuleScope,
} from './types/rules.js';
import type {
  ActionResult,
  ArticleChanges,
  ArticleContext,
  ClockPort,
  FetchPort,
  NotificationPort,
  RegexPort,
  AsyncRuleStoragePort,
  RuleCandidate,
} from './ports.js';
import { matchCondition } from './rule-matching.js';

export class RuleExecutionService {
  constructor(
    private readonly storage: AsyncRuleStoragePort,
    private readonly regex: RegexPort,
    private readonly network: FetchPort,
    private readonly notifications: NotificationPort,
    private readonly clock: ClockPort,
  ) {}
  private async *candidates(options: {
    since?: number;
    visibleOnly?: boolean;
  }): AsyncGenerator<RuleCandidate> {
    const ids = await this.storage.articleIds(options);
    for (let offset = 0; offset < ids.length; offset += 40) {
      const batch = ids.slice(offset, offset + 40);
      const rows = new Map((await this.storage.contexts(batch)).map((row) => [row.id, row]));
      for (const id of batch) {
        const row = rows.get(id);
        if (row) yield row;
      }
    }
  }
  private inScope(context: ArticleContext, scope: RuleScope): boolean {
    if (!scope.feedIds?.length && !scope.folderIds?.length) return true;
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
    return matchCondition(this.regex, context, condition);
  }

  private async executeActions(rule: RuleRecord, context: ArticleContext): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    const changes: ArticleChanges = {};
    for (const action of rule.actions) {
      try {
        switch (action.type) {
          case 'add_tag':
            await this.storage.addTag(context.id, action.tag);
            break;
          case 'remove_tag':
            await this.storage.removeTag(context.id, action.tag);
            break;
          case 'star':
            changes.starredAt = this.clock.now();
            break;
          case 'mark_read':
            changes.readAt = this.clock.now();
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
            await this.notifications.notify({
              id: context.id,
              title: context.title,
              url: context.url,
            });
            break;
          case 'webhook':
            await this.webhook(action, rule, context);
            break;
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
    if (Object.keys(changes).length) await this.storage.updateArticle(context.id, changes);
    return results;
  }

  private async webhook(
    action: Extract<RuleAction, { type: 'webhook' }>,
    rule: RuleRecord,
    context: ArticleContext,
  ): Promise<void> {
    const payload = JSON.stringify({
      article: { id: context.id, title: context.title, url: context.url },
      rule: { id: rule.id, name: rule.name },
    });
    let lastError = 'Webhook failed';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.network.fetch(action.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: AbortSignal.timeout(5_000),
        });
        void response.body?.cancel().catch(() => {});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Webhook failed';
      }
    }
    throw new Error(lastError);
  }

  async evaluateArticle(articleId: number): Promise<number> {
    const context = await this.storage.context(articleId);
    if (!context) return 0;
    let matched = 0;
    for (const rule of (await this.storage.definitions()).filter((rule) => rule.enabled)) {
      if (
        rule.conditions.length > 10 ||
        !(await this.definitionMatches(context, rule.scope, rule.matchType, rule.conditions))
      )
        continue;
      await this.storage.log(rule.id, articleId, await this.executeActions(rule, context));
      matched++;
      if (rule.stopProcessing) break;
    }
    return matched;
  }

  async applyToExisting(ruleId: number, days: number): Promise<number> {
    const rule = (await this.storage.definitions()).find((rule) => rule.id === ruleId);
    if (!rule) throw new Error('Rule not found');
    const since = this.clock.now().getTime() - Math.min(3650, Math.max(1, days)) * 86_400_000;
    let matched = 0;
    for await (const context of this.candidates({ since })) {
      const id = context.id;
      if (
        !context ||
        !(await this.definitionMatches(context, rule.scope, rule.matchType, rule.conditions))
      )
        continue;
      await this.storage.log(ruleId, id, await this.executeActions(rule, context));
      matched++;
    }
    return matched;
  }

  async preview(
    draft: Pick<RuleDraft, 'scope' | 'matchType' | 'conditions'>,
  ): Promise<RulePreviewItem[]> {
    if (draft.conditions.length > 10) throw new Error('A rule may have at most 10 conditions');
    const matches: RulePreviewItem[] = [];
    for await (const context of this.candidates({ visibleOnly: true })) {
      const id = context.id;
      if (
        !context ||
        !(await this.definitionMatches(context, draft.scope, draft.matchType, draft.conditions))
      )
        continue;
      matches.push({
        id,
        title: context.title,
        feedTitle: context.feed,
        publishedAt: context.publishedAt.toISOString(),
      });
      if (matches.length === 50) break;
    }
    return matches;
  }
  async previewSummary(draft: Pick<RuleDraft, 'scope' | 'matchType' | 'conditions'>) {
    if (draft.conditions.length > 10) throw new Error('A rule may have at most 10 conditions');
    const items: RulePreviewItem[] = [];
    let total = 0;
    for await (const context of this.candidates({ visibleOnly: true })) {
      const id = context.id;
      if (
        !context ||
        !(await this.definitionMatches(context, draft.scope, draft.matchType, draft.conditions))
      )
        continue;
      total++;
      if (items.length < 50)
        items.push({
          id,
          title: context.title,
          feedTitle: context.feed,
          publishedAt: context.publishedAt.toISOString(),
        });
    }
    return { items, total, limit: 50 };
  }
}
