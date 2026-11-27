import { BrewService as CoreBrewService } from '../../../../packages/core/src/brew-service.js';
import type { BrewDatabase } from '../db/database.js';
import { NodeBrewStorage } from '../ports/brew-storage.js';
import type { BrewDeliveryOptions } from '../../../../packages/core/src/types/delivery.js';
import type { ClockPort } from '../../../../packages/core/src/ports.js';
import { nodeClock, nodeRegex } from '../ports/runtime.js';
import { ScheduledBrewProcessor } from '../../../../packages/core/src/brew-scheduled-processing.js';
import { NodeScheduledBrewJobs } from '../ports/brew-scheduled-jobs.js';
const scheduledRuns = new WeakMap<BrewDatabase, Promise<number>>();
export class BrewService extends CoreBrewService {
  private readonly pendingSchedule: ScheduledBrewProcessor;
  private readonly scheduledDatabase: BrewDatabase;
  constructor(
    database: BrewDatabase,
    clock: ClockPort = nodeClock,
    delivery: BrewDeliveryOptions = {},
  ) {
    super(new NodeBrewStorage(database), clock, nodeRegex, delivery);
    this.scheduledDatabase = database;
    this.pendingSchedule = new ScheduledBrewProcessor(
      new NodeScheduledBrewJobs(database),
      new NodeBrewStorage(database),
      clock,
      nodeRegex,
      delivery,
    );
  }
  runPendingScheduled(capture = true) {
    const run = (scheduledRuns.get(this.scheduledDatabase) ?? Promise.resolve(0))
      .catch(() => 0)
      .then(async () => {
        if (capture) await this.pendingSchedule.capture();
        return this.pendingSchedule.drain(100);
      });
    scheduledRuns.set(this.scheduledDatabase, run);
    return run;
  }
}
