import { BrewService as CoreBrewService } from '../../../../packages/core/src/brew-service.js';
import type { BrewDatabase } from '../db/database.js';
import { NodeBrewStorage } from '../ports/brew-storage.js';
import { nodeClock, nodeRegex } from '../ports/runtime.js';
export class BrewService extends CoreBrewService {
  constructor(database: BrewDatabase) {
    super(new NodeBrewStorage(database), nodeClock, nodeRegex);
  }
}
