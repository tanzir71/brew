import type { RuleDraft, RuleRecord } from './types/rules.js';
import type {
  ClockPort,
  FetchPort,
  NotificationPort,
  RegexPort,
  RuleStoragePort,
} from './ports.js';
import { RuleExecutionService } from './rule-execution-service.js';
import { validateRuleDraft } from './rule-validation.js';

export class RulesService extends RuleExecutionService {
  constructor(
    private readonly syncStorage: RuleStoragePort,
    regex: RegexPort,
    network: FetchPort,
    notifications: NotificationPort,
    private readonly syncClock: ClockPort,
  ) {
    super(syncStorage, regex, network, notifications, syncClock);
  }

  list(): RuleRecord[] {
    return this.syncStorage.list(this.syncClock.now());
  }
  create(draft: RuleDraft): RuleRecord {
    validateRuleDraft(draft);
    const position = draft.position ?? (this.list().at(-1)?.position ?? -1) + 1;
    const id = this.syncStorage.create({ ...draft, name: draft.name.trim(), position });
    return this.list().find((rule) => rule.id === id)!;
  }
  update(id: number, draft: RuleDraft): RuleRecord | null {
    validateRuleDraft(draft);
    return this.syncStorage.update(id, { ...draft, name: draft.name.trim() }, this.syncClock.now())
      ? this.list().find((rule) => rule.id === id)!
      : null;
  }
  delete(id: number): boolean {
    return this.syncStorage.delete(id);
  }
  logs(ruleId: number) {
    return this.syncStorage.logs(ruleId);
  }
  logPage(ruleId: number, page = 1) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000)
      throw new Error('Invalid page number.');
    if (
      !Number.isSafeInteger(ruleId) ||
      ruleId < 1 ||
      !this.syncStorage.definitions().some((rule) => rule.id === ruleId)
    )
      return null;
    return this.syncStorage.logPage(ruleId, page);
  }
}
