import type {
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
  RuleTagAction,
} from './ports.js';
import { changeArticle, externalRuleAction } from './rule-actions.js';
import { matchCondition, matchingContexts, inRuleScope, matchesRule } from './rule-matching.js';

export class RuleExecutionService {
  constructor(
    private readonly storage: AsyncRuleStoragePort,
    private readonly regex: RegexPort,
    private readonly network: FetchPort,
    private readonly notifications: NotificationPort,
    private readonly clock: ClockPort,
  ) {}
  private async *candidateBatches(options: {
    since?: number;
    visibleOnly?: boolean;
  }): AsyncGenerator<RuleCandidate[]> {
    const ids = await this.storage.articleIds(options);
    for (let offset = 0; offset < ids.length; offset += 40) {
      const batch = ids.slice(offset, offset + 40);
      const rows = new Map((await this.storage.contexts(batch)).map((row) => [row.id, row]));
      yield batch.flatMap((id) => (rows.has(id) ? [rows.get(id)!] : []));
    }
  }
  private async *candidates(options: { since?: number; visibleOnly?: boolean }) {
    for await (const rows of this.candidateBatches(options)) yield* rows;
  }
  private async *previewMatches(
    draft: Pick<RuleDraft, 'scope' | 'matchType' | 'conditions'>,
    limit = Infinity,
  ) {
    let count = 0;
    for await (const rows of this.candidateBatches({ visibleOnly: true })) {
      const scoped = rows.filter((row) => this.inScope(row, draft.scope));
      for (let offset = 0; offset < scoped.length;) {
        // Do not evaluate beyond the prefix a bounded preview still needs.
        const size = Math.min(scoped.length - offset, limit - count);
        const matches = await matchingContexts(
          scoped.slice(offset, offset + size),
          {
            match: draft.matchType,
            conditions: draft.conditions,
          },
          this.regex,
          'exclude',
        );
        offset += size;
        for (const row of matches) {
          yield row;
          if (++count === limit) return;
        }
      }
    }
  }
  private inScope(context: ArticleContext, scope: RuleScope): boolean {
    return inRuleScope(context, scope);
  }

  private async definitionMatches(
    context: ArticleContext,
    scope: RuleScope,
    matchType: 'all' | 'any',
    conditions: RuleCondition[],
  ): Promise<boolean> {
    return matchesRule(this.regex, context, scope, matchType, conditions);
  }

  async conditionMatches(context: ArticleContext, condition: RuleCondition): Promise<boolean> {
    return matchCondition(this.regex, context, condition);
  }

  private async executeActions(rule: RuleRecord, context: ArticleContext): Promise<void> {
    const results: Array<ActionResult | null> = [];
    const changes: ArticleChanges = {};
    const batched = Boolean(this.storage.applyTagActions && this.storage.commitRule);
    let pending: Array<{ index: number; action: RuleTagAction }> = [];
    const flush = async () => {
      if (!pending.length) return;
      const applied = await this.storage.applyTagActions!(
        context.id,
        pending.map(({ action }) => action),
      );
      if (
        applied.length !== pending.length ||
        applied.some((result, index) => result.type !== pending[index]!.action.type)
      )
        throw new Error('Invalid rule tag action results');
      pending.forEach(({ index }, position) => {
        results[index] = applied[position]!;
      });
      pending = [];
    };
    for (const action of rule.actions) {
      if (batched && (action.type === 'add_tag' || action.type === 'remove_tag')) {
        pending.push({ index: results.length, action });
        results.push(null);
        continue;
      }
      // Tags have always been visible to subsequent external actions. Article fields
      // remain deferred until the rule finishes, as in the single-action path.
      if (batched && (action.type === 'webhook' || action.type === 'notify')) await flush();
      try {
        if (action.type === 'add_tag') await this.storage.addTag(context.id, action.tag);
        else if (action.type === 'remove_tag') await this.storage.removeTag(context.id, action.tag);
        else if (action.type === 'notify' || action.type === 'webhook')
          await externalRuleAction(action, rule, context, this.network, this.notifications);
        else changeArticle(action, changes, this.clock);
        results.push({ type: action.type, ok: true });
      } catch (error) {
        results.push({
          type: action.type,
          ok: false,
          error: error instanceof Error ? error.message : 'Action failed',
        });
      }
    }
    await flush();
    const completed = results.map((result) => {
      if (!result) throw new Error('Unfinished rule tag action');
      return result;
    });
    if (batched) {
      await this.storage.commitRule!({
        ruleId: rule.id,
        articleId: context.id,
        changes,
        results: completed,
      });
    } else {
      if (Object.keys(changes).length) await this.storage.updateArticle(context.id, changes);
      await this.storage.log(rule.id, context.id, completed);
    }
  }

  async evaluateArticle(articleId: number): Promise<number> {
    const context = await this.storage.context(articleId);
    if (!context) return 0;
    return this.evaluateContext(
      context,
      (await this.storage.definitions()).filter((rule) => rule.enabled),
    );
  }

  /** One definition snapshot and bounded context batches for newly ingested items. */
  async evaluateArticles(articleIds: number[]): Promise<number> {
    if (!articleIds.length) return 0;
    const rules = (await this.storage.definitions()).filter((rule) => rule.enabled);
    if (!rules.length) return 0;
    let matched = 0;
    for (let offset = 0; offset < articleIds.length; offset += 40) {
      const ids = articleIds.slice(offset, offset + 40);
      const contexts = new Map((await this.storage.contexts(ids)).map((row) => [row.id, row]));
      for (const id of ids) {
        const context = contexts.get(id);
        if (context) matched += await this.evaluateContext(context, rules);
      }
    }
    return matched;
  }

  private async evaluateContext(context: ArticleContext, rules: RuleRecord[]): Promise<number> {
    let matched = 0;
    for (const rule of rules) {
      if (
        rule.conditions.length > 10 ||
        !(await this.definitionMatches(context, rule.scope, rule.matchType, rule.conditions))
      )
        continue;
      await this.executeActions(rule, context);
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
      if (
        !context ||
        !(await this.definitionMatches(context, rule.scope, rule.matchType, rule.conditions))
      )
        continue;
      await this.executeActions(rule, context);
      matched++;
    }
    return matched;
  }

  async preview(
    draft: Pick<RuleDraft, 'scope' | 'matchType' | 'conditions'>,
  ): Promise<RulePreviewItem[]> {
    if (draft.conditions.length > 10) throw new Error('A rule may have at most 10 conditions');
    const matches: RulePreviewItem[] = [];
    for await (const context of this.previewMatches(draft, 50)) {
      const id = context.id;
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
    for await (const context of this.previewMatches(draft)) {
      const id = context.id;
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
