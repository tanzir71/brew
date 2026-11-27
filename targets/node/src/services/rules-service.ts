import { RulesService as CoreRulesService } from '../../../../packages/core/src/rules-service.js';
import type { BrewDatabase } from '../db/database.js';
import { NodeRuleStorage } from '../ports/rule-storage.js';
import { nodeClock, nodeRegex } from '../ports/runtime.js';
import type { ClockPort } from '../../../../packages/core/src/ports.js';
export class RulesService extends CoreRulesService {
  constructor(
    database: BrewDatabase,
    fetcher: typeof fetch = globalThis.fetch,
    notify: (article: { id: number; title: string; url: string }) => void = () => undefined,
    clock: ClockPort = nodeClock,
  ) {
    super(new NodeRuleStorage(database), nodeRegex, { fetch: fetcher }, { notify }, clock);
  }
}
