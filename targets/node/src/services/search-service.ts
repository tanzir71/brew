import { SearchService as CoreSearchService } from '../../../../packages/core/src/search-service.js';
import type { BrewDatabase } from '../db/database.js';
import { NodeSearch } from '../ports/search.js';
import { nodeClock } from '../ports/runtime.js';
export { compileFtsQuery } from '../../../../packages/core/src/search-service.js';
export type { SearchScope } from '../../../../packages/core/src/ports.js';
export class SearchService extends CoreSearchService {
  constructor(database: BrewDatabase) {
    super(new NodeSearch(database), nodeClock);
  }
}
