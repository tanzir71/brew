import { BrewService as CoreBrewService } from '../../../../packages/core/src/brew-service.js';
import type { BrewDatabase } from '../db/database.js';
import { NodeBrewStorage } from '../ports/brew-storage.js';
import type { ClockPort } from '../../../../packages/core/src/ports.js';
import { nodeClock, nodeRegex } from '../ports/runtime.js';
export class BrewService extends CoreBrewService {
  constructor(database: BrewDatabase, clock: ClockPort = nodeClock) {
    super(new NodeBrewStorage(database), clock, nodeRegex);
  }
}
