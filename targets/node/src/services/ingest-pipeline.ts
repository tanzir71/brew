import {
  IngestPipeline as CoreIngestPipeline,
  articleHash as hashArticle,
} from '../../../../packages/core/src/ingest-pipeline.js';
import type { BrewDatabase } from '../db/database.js';
import { NodeIngestStorage } from '../ports/ingest-storage.js';
import { nodeClock, nodeHash } from '../ports/runtime.js';
import type { RulesService } from './rules-service.js';
import type { IngestProcessingService } from '../../../../packages/core/src/ingest-processing.js';
export { trigramSimilarity } from '../../../../packages/core/src/ingest-pipeline.js';
export const articleHash = (url: string, title: string): string =>
  hashArticle(nodeHash, url, title);
export class IngestPipeline extends CoreIngestPipeline {
  private readonly processingService?: IngestProcessingService;
  constructor(database: BrewDatabase, rules?: RulesService) {
    const storage = new NodeIngestStorage(database, Boolean(rules)),
      processing = rules?.ingestProcessor(storage);
    super(
      storage,
      nodeHash,
      nodeClock,
      rules,
      processing
        ? {
            processInserted: async (feed, ids) => {
              await processing.drain(feed.id);
              if (!ids.length)
                await storage.prune(
                  feed.id,
                  nodeClock.now().getTime() - feed.retentionDays * 86_400_000,
                );
            },
          }
        : undefined,
    );
    this.processingService = processing;
  }
  async resumePending() {
    return this.processingService?.drain(undefined, 100) ?? 0;
  }
}
