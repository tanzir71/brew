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
    super(new NodeNewsletterStorage(database), nodeHash, clock, rules);
  }
}
