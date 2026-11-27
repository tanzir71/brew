import { NewsletterPipeline } from '../../../../packages/core/src/newsletter-pipeline.js';
import type { ClockPort } from '../../../../packages/core/src/ports.js';
import type { BrewDatabase } from '../db/database.js';
import { NodeNewsletterStorage } from '../ports/newsletter-storage.js';
import { nodeClock, nodeHash } from '../ports/runtime.js';
import { RulesService } from './rules-service.js';

export class NewsletterService extends NewsletterPipeline {
  constructor(
    database: BrewDatabase,
    clock: ClockPort = nodeClock,
    rules = new RulesService(database),
  ) {
    const storage = new NodeNewsletterStorage(database, true),
      processing = rules.ingestProcessor(storage, clock);
    super(storage, nodeHash, clock, rules, {
      processInserted: async (feed, ids) => {
        await processing.drain(feed.id);
        if (!ids.length)
          await storage.prune(feed.id, clock.now().getTime() - feed.retentionDays * 86_400_000);
      },
    });
  }
}
