import type {
  ActionResult,
  ArticleChanges,
  ArticleContext,
  AsyncPort,
  AsyncRuleStoragePort,
  ClockPort,
  FetchPort,
  IngestStoragePort,
  NotificationPort,
  RegexPort,
  RuleCommit,
  RuleTagAction,
} from './ports.js';
import type { RuleRecord } from './types/rules.js';
import { duplicateArticleIds } from './ingest-duplicates.js';
import { matchesRule } from './rule-matching.js';
import { actionFailure, changeArticle, externalRuleAction } from './rule-actions.js';
import { PollInterruptedError } from './feed-polling.js';

export const INGEST_LEASE_MS = 16 * 60_000;
export interface PendingRuleActions {
  index: number;
  results: ActionResult[];
  changes: ArticleChanges;
  externalStarted: boolean;
}
export type IngestProcessingState =
  | { phase: 'duplicates' }
  | { phase: 'retention' }
  | {
      phase: 'rules';
      rules: RuleRecord[];
      after: number;
      context: ArticleContext | null;
      ruleIndex: number;
      actions: PendingRuleActions | null;
    };
export interface IngestJob {
  id: string;
  feedId: number;
  retentionDays: number;
  articleIds: number[];
  runner: string;
  version: number;
  state: IngestProcessingState;
  liveRuleIds: number[];
}
export interface IngestEffects {
  releaseArticle?: number;
  hidden?: number[];
  tag?: RuleTagAction;
  commit?: RuleCommit;
  complete?: boolean;
}
export interface IngestJobsPort {
  claim(runner: string, now: number, until: number, feedId?: number): IngestJob | null;
  /** Effects, next cursor and lease renewal commit together; returns real tag failure if rejected. */
  checkpoint(
    job: IngestJob,
    next: IngestProcessingState,
    effects: IngestEffects,
    now: number,
    until: number,
  ): ActionResult | null;
  release(id: string, runner: string): void;
}
export class IngestLeaseLost extends PollInterruptedError {}
export function decodeIngestState(value: string): IngestProcessingState {
  const state = JSON.parse(value) as IngestProcessingState;
  if (state.phase === 'rules' && state.actions) {
    for (const key of ['starredAt', 'readAt'] as const) {
      const value = state.actions.changes[key];
      if (value !== undefined) state.actions.changes[key] = new Date(value as unknown as string);
    }
  }
  return state;
}
export interface IngestStepBudget {
  remaining: number;
}
export function cloneIngestRuleState(state: Extract<IngestProcessingState, { phase: 'rules' }>) {
  return {
    ...state,
    actions: state.actions
      ? {
          ...state.actions,
          changes: { ...state.actions.changes },
          results: [...state.actions.results],
        }
      : null,
  };
}
/** Shared Node-first pending ingestion; no platform or provider policy is forked. */
export class IngestProcessingService {
  constructor(
    private readonly jobs: AsyncPort<IngestJobsPort>,
    private readonly storage: IngestStoragePort,
    private readonly rules: AsyncRuleStoragePort,
    private readonly regex: RegexPort,
    private readonly network: FetchPort,
    private readonly notifications: NotificationPort,
    private readonly clock: ClockPort,
    private readonly runner: () => string,
    private readonly budget: IngestStepBudget = { remaining: Infinity },
    private readonly canSend: (type: 'notify' | 'webhook') => boolean = () => true,
  ) {}
  async drain(feedId?: number, limit = Infinity): Promise<number> {
    let steps = 0;
    while (this.budget.remaining > 0 && steps < limit) {
      const runner = this.runner(),
        now = this.clock.now().getTime();
      const job = await this.jobs.claim(runner, now, now + INGEST_LEASE_MS, feedId);
      if (!job) break;
      try {
        while (this.budget.remaining > 0 && steps < limit) {
          const finishing = job.state.phase === 'retention';
          this.budget.remaining--;
          if (!(await this.step(job))) {
            this.budget.remaining++;
            return steps;
          }
          steps++;
          if (finishing) break;
        }
      } catch (error) {
        if (error instanceof IngestLeaseLost) return steps;
        throw error;
      } finally {
        await this.jobs.release(job.id, runner);
      }
    }
    return steps;
  }
  private async save(job: IngestJob, next: IngestProcessingState, effects: IngestEffects = {}) {
    const now = this.clock.now().getTime();
    const failure = await this.jobs.checkpoint(job, next, effects, now, now + INGEST_LEASE_MS);
    if (failure && next.phase === 'rules' && next.actions)
      next.actions.results[next.actions.results.length - 1] = failure;
    job.state = next;
    job.version++;
  }
  private async step(job: IngestJob): Promise<boolean> {
    const state = job.state;
    if (state.phase === 'retention') {
      await this.save(job, state, { complete: true });
      return true;
    }
    if (state.phase === 'duplicates') {
      const titles = await this.storage.duplicateTitles(
        job.articleIds,
        this.clock.now().getTime() - 3 * 86_400_000,
      );
      const rules = (await this.rules.definitions()).filter((rule) => rule.enabled);
      job.liveRuleIds = rules.map((rule) => rule.id);
      await this.save(
        job,
        rules.length
          ? { phase: 'rules', rules, after: 0, context: null, ruleIndex: 0, actions: null }
          : { phase: 'retention' },
        { hidden: titles ? duplicateArticleIds(job.articleIds, titles) : [] },
      );
      return true;
    }
    const next = cloneIngestRuleState(state);
    if (next.context && !job.articleIds.includes(next.context.id)) {
      next.after = next.context.id;
      next.context = null;
      next.ruleIndex = 0;
      next.actions = null;
    }
    if (!next.context) {
      const id = job.articleIds.find((id) => id > next.after);
      if (id === undefined) {
        await this.save(job, { phase: 'retention' });
        return true;
      }
      next.context = await this.rules.context(id);
      if (!next.context) next.after = id;
      await this.save(job, next);
      return true;
    }
    const rule = next.rules[next.ruleIndex];
    if (!rule) {
      const completedArticle = next.context.id;
      next.after = next.context.id;
      next.context = null;
      next.ruleIndex = 0;
      next.actions = null;
      await this.save(job, next, { releaseArticle: completedArticle });
      return true;
    }
    if (!job.liveRuleIds.includes(rule.id)) {
      next.actions = null;
      next.ruleIndex++;
      await this.save(job, next);
      return true;
    }
    if (!next.actions) {
      const matches =
        rule.conditions.length <= 10 &&
        (await matchesRule(this.regex, next.context, rule.scope, rule.matchType, rule.conditions));
      if (!matches) next.ruleIndex++;
      else next.actions = { index: 0, results: [], changes: {}, externalStarted: false };
      await this.save(job, next);
      return true;
    }
    const actions = next.actions,
      action = rule.actions[actions.index];
    if (!action) {
      const commit = {
        ruleId: rule.id,
        articleId: next.context.id,
        changes: actions.changes,
        results: actions.results,
      };
      next.actions = null;
      next.ruleIndex = rule.stopProcessing ? next.rules.length : next.ruleIndex + 1;
      await this.save(job, next, { commit });
      return true;
    }
    if (action.type === 'notify' || action.type === 'webhook') {
      if (actions.externalStarted) {
        actions.results.push({
          type: action.type,
          ok: false,
          error:
            'This action was interrupted; its delivery outcome is unknown. It was not replayed.',
        });
        actions.externalStarted = false;
        actions.index++;
        await this.save(job, next);
        return true;
      }
      if (!this.canSend(action.type)) return false;
      actions.externalStarted = true;
      await this.save(job, next);
      // Never yield intentionally between the durable start and its result.
      let result: ActionResult;
      try {
        await externalRuleAction(action, rule, next.context, this.network, this.notifications);
        result = { type: action.type, ok: true };
      } catch (error) {
        result = actionFailure(action, error);
      }
      const finished = cloneIngestRuleState(next);
      finished.actions!.results.push(result);
      finished.actions!.index++;
      finished.actions!.externalStarted = false;
      await this.save(job, finished);
      return true;
    }
    try {
      changeArticle(action, actions.changes, this.clock);
      actions.results.push({ type: action.type, ok: true });
    } catch (error) {
      actions.results.push(actionFailure(action, error));
    }
    actions.index++;
    await this.save(
      job,
      next,
      action.type === 'add_tag' || action.type === 'remove_tag' ? { tag: action } : {},
    );
    return true;
  }
}
