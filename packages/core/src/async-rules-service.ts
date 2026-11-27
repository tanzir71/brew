import type { RuleDraft, RuleRecord } from './types/rules.js';
import type {
  AsyncRuleStoragePort,
  ClockPort,
  FetchPort,
  NotificationPort,
  RegexPort,
} from './ports.js';
import { RuleExecutionService } from './rule-execution-service.js';
import { validateRuleDraft } from './rule-validation.js';

export class AsyncRulesService extends RuleExecutionService {
  constructor(
    private readonly asyncStorage: AsyncRuleStoragePort,
    regex: RegexPort,
    network: FetchPort,
    notifications: NotificationPort,
    private readonly asyncClock: ClockPort,
  ) {
    super(asyncStorage, regex, network, notifications, asyncClock);
  }
  async list(): Promise<RuleRecord[]> {
    return this.asyncStorage.list(this.asyncClock.now());
  }
  async create(draft: RuleDraft): Promise<RuleRecord> {
    validateRuleDraft(draft);
    const position = draft.position ?? ((await this.list()).at(-1)?.position ?? -1) + 1;
    const id = await this.asyncStorage.create({ ...draft, name: draft.name.trim(), position });
    return (await this.list()).find((rule) => rule.id === id)!;
  }
  async update(id: number, draft: RuleDraft): Promise<RuleRecord | null> {
    validateRuleDraft(draft);
    return (await this.asyncStorage.update(
      id,
      { ...draft, name: draft.name.trim() },
      this.asyncClock.now(),
    ))
      ? (await this.list()).find((rule) => rule.id === id)!
      : null;
  }
  async delete(id: number): Promise<boolean> {
    return this.asyncStorage.delete(id);
  }
  async logs(ruleId: number) {
    return this.asyncStorage.logs(ruleId);
  }
  async logPage(ruleId: number, page = 1) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000)
      throw new Error('Invalid page number.');
    if (
      !Number.isSafeInteger(ruleId) ||
      ruleId < 1 ||
      !(await this.asyncStorage.definitions()).some((rule) => rule.id === ruleId)
    )
      return null;
    return this.asyncStorage.logPage(ruleId, page);
  }
}
