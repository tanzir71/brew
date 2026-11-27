import { RulesService as CoreRulesService } from '../../../../packages/core/src/rules-service.js';
import type { BrewDatabase } from '../db/database.js';
import { NodeRuleStorage } from '../ports/rule-storage.js';
import { nodeClock, nodeRegex } from '../ports/runtime.js';
import type { ClockPort, IngestStoragePort } from '../../../../packages/core/src/ports.js';
import { IngestProcessingService } from '../../../../packages/core/src/ingest-processing.js';
import { NodeIngestJobs } from '../ports/ingest-jobs.js';
import { randomUUID } from 'node:crypto';
const processingRuns = new WeakMap<BrewDatabase, Promise<number>>();
export class RulesService extends CoreRulesService {
  constructor(
    private readonly processingDatabase: BrewDatabase,
    private readonly processingFetch: typeof fetch = globalThis.fetch,
    private readonly processingNotify: (article: {
      id: number;
      title: string;
      url: string;
    }) => void = () => undefined,
    private readonly processingClock: ClockPort = nodeClock,
  ) {
    super(
      new NodeRuleStorage(processingDatabase),
      nodeRegex,
      { fetch: processingFetch },
      { notify: processingNotify },
      processingClock,
    );
  }
  ingestProcessor(storage: IngestStoragePort, clock = this.processingClock) {
    const processor = new IngestProcessingService(
      new NodeIngestJobs(this.processingDatabase),
      storage,
      new NodeRuleStorage(this.processingDatabase),
      nodeRegex,
      { fetch: this.processingFetch },
      { notify: this.processingNotify },
      clock,
      randomUUID,
    );
    const drain = processor.drain.bind(processor),
      database = this.processingDatabase;
    processor.drain = (feedId, limit) => {
      const task = (processingRuns.get(database) ?? Promise.resolve(0))
        .catch(() => 0)
        .then(() => drain(feedId, limit));
      processingRuns.set(database, task);
      return task.finally(() => {
        if (processingRuns.get(database) === task) processingRuns.delete(database);
      });
    };
    return processor;
  }
}
