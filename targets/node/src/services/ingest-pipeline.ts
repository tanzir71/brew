import {
  IngestPipeline as CoreIngestPipeline,
  articleHash as hashArticle,
} from '../../../../packages/core/src/ingest-pipeline.js';
import type { BrewDatabase } from '../db/database.js';
import { NodeIngestStorage } from '../ports/ingest-storage.js';
import { nodeClock, nodeHash } from '../ports/runtime.js';
import type { RulesService } from './rules-service.js';
export { trigramSimilarity } from '../../../../packages/core/src/ingest-pipeline.js';
export const articleHash = (url: string, title: string): string =>
  hashArticle(nodeHash, url, title);
export class IngestPipeline extends CoreIngestPipeline {
  constructor(database: BrewDatabase, rules?: RulesService) {
    super(new NodeIngestStorage(database), nodeHash, nodeClock, rules);
  }
}
