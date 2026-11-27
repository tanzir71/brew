import type {
  AsyncPort,
  AsyncBrewStoragePort,
  BrewStoragePort,
  BrewCandidate,
  BrewItemQuery,
  ClockPort,
  RegexPort,
} from './ports.js';
import type { BrewSnapshotSection } from './types/brew.js';
import type { BrewSnapshotSection as LegacySection } from './types/legacy-brew.js';
import type { BrewDeliveryOptions, BrewDeliveryResults } from './types/delivery.js';
import {
  scheduledBrewRequests,
  type ScheduledBrewRequest,
  type ScheduledConfig,
} from './brew-scheduled-request.js';
import { legacyBrewQuery, legacyBrewItems } from './brew-model.js';
import {
  sectionActive,
  sectionSourceQuery,
  renderCompositionSection,
  compositionRank,
  compareCompositionRanks,
  type CompositionRank,
} from './composition-section.js';
import { matchingContexts } from './rule-matching.js';
import { BrewDeliveryRunner } from './brew-delivery.js';

export const SCHEDULE_LEASE_MS = 16 * 60_000;
export type ScheduledPayload = Parameters<BrewStoragePort['save']>[1];
export interface ScheduledSelection {
  after: number;
  eligible: number;
  matching: number;
  selected: CompositionRank[];
  done: boolean;
}
export const initialScheduledSelection = (): ScheduledSelection => ({
  after: 0,
  eligible: 0,
  matching: 0,
  selected: [],
  done: false,
});
export type ScheduledBrewState =
  | { phase: 'legacy'; index: number; sections: LegacySection[] }
  | {
      phase: 'composition';
      index: number;
      source: number;
      selection: ScheduledSelection;
      sections: BrewSnapshotSection[];
    }
  | { phase: 'delivery'; issueId: number; started: boolean };
export interface ScheduledBrewJob {
  id: string;
  runner: string;
  version: number;
  request: ScheduledBrewRequest;
  state: ScheduledBrewState;
}
export function initialScheduledState(request: ScheduledBrewRequest): ScheduledBrewState {
  return request.kind === 'legacy'
    ? { phase: 'legacy', index: 0, sections: [] }
    : {
        phase: 'composition',
        index: 0,
        source: 0,
        selection: initialScheduledSelection(),
        sections: [],
      };
}
export class ScheduleLeaseLost extends Error {}
export interface ScheduledBrewJobsPort {
  captureAfter(now: number): number | null;
  configs(): ScheduledConfig[];
  enqueue(requests: ScheduledBrewRequest[], now: number): void;
  claim(runner: string, now: number, until: number): ScheduledBrewJob | null;
  checkpoint(
    job: ScheduledBrewJob,
    state: ScheduledBrewState | null,
    now: number,
    until: number,
    skipped?: boolean,
  ): void;
  /** Capture source rows and advance its cursor in the same fenced transaction. */
  captureSource(
    job: ScheduledBrewJob,
    query: BrewItemQuery | null,
    when: number,
    next: ScheduledBrewState,
    now: number,
    until: number,
  ): void;
  candidates(
    job: ScheduledBrewJob,
    after: number,
    limit: number,
    includeContent: boolean,
    now: number,
  ): BrewCandidate[];
  selectedCandidates(job: ScheduledBrewJob, ids: number[], now: number): BrewCandidate[];
  /** Freeze, receipt and the delivery cursor commit together; null cancels a claimed minute. */
  freeze(
    job: ScheduledBrewJob,
    payload: ScheduledPayload,
    now: number,
    until: number,
  ): number | null;
  claimDelivery(
    job: ScheduledBrewJob,
    id: number,
    results: BrewDeliveryResults,
    now: number,
  ): boolean;
  saveDelivery(job: ScheduledBrewJob, id: number, results: BrewDeliveryResults, now: number): void;
  deliveryResults(job: ScheduledBrewJob, id: number, now: number): BrewDeliveryResults | null;
  release(id: string, runner: string): void;
}
export interface ScheduledWorkBudget {
  remaining: number;
  reserve?: (kind: 'job' | 'build' | 'delivery') => (() => void) | null;
  canDeliver?: (request: ScheduledBrewRequest) => boolean;
  candidatePageSize?: number;
}
/** The same durable minute, section/source cursor and delivery policy runs on Node and Workers. */
export class ScheduledBrewProcessor {
  constructor(
    private readonly jobs: AsyncPort<ScheduledBrewJobsPort>,
    private readonly storage: AsyncBrewStoragePort,
    private readonly clock: ClockPort,
    private readonly regex: RegexPort,
    private readonly delivery: BrewDeliveryOptions = {},
    private readonly runner: () => string = () => crypto.randomUUID(),
    private readonly budget: ScheduledWorkBudget = { remaining: Infinity },
  ) {}
  async capture(now = this.clock.now()) {
    const saved = await this.jobs.captureAfter(now.getTime());
    const after = Math.min(
      saved !== null && Number.isSafeInteger(saved) ? saved : now.getTime() - 60_000,
      now.getTime() - 60_000,
    );
    const through = Math.min(now.getTime(), after + 86_400_000);
    const requests = (await this.jobs.configs()).flatMap((value) => {
      const created = Date.parse(value.config.createdAt);
      const start =
        Number.isFinite(created) && created <= now.getTime()
          ? Math.max(after, Math.floor(created / 60_000) * 60_000 - 1)
          : after;
      const requests = scheduledBrewRequests(value, new Date(start), new Date(through));
      if (through < now.getTime())
        requests.push(
          ...scheduledBrewRequests(value, new Date(Math.max(start, now.getTime() - 60_000)), now),
        );
      return [...new Map(requests.map((request) => [request.receipt.key, request])).values()];
    });
    await this.jobs.enqueue(requests, through);
  }
  async drain(limit = Infinity) {
    let steps = 0;
    while (this.budget.remaining > 0 && steps < limit) {
      const releaseJob = this.budget.reserve?.('job');
      if (releaseJob === null) break;
      const runner = this.runner();
      let job: ScheduledBrewJob | null = null;
      try {
        const at = this.clock.now().getTime();
        job = await this.jobs.claim(runner, at, at + SCHEDULE_LEASE_MS);
        if (!job) break;
        while (this.budget.remaining > 0 && steps < limit) {
          const delivering = job.state.phase === 'delivery';
          if (delivering && this.budget.canDeliver?.(job.request) === false) return steps;
          const releaseStep = this.budget.reserve?.(delivering ? 'delivery' : 'build');
          if (releaseStep === null) return steps;
          try {
            this.budget.remaining--;
            steps++;
            if (await this.step(job)) break;
          } finally {
            releaseStep?.();
          }
        }
      } catch (error) {
        if (error instanceof ScheduleLeaseLost) return steps;
        throw error;
      } finally {
        try {
          if (job) await this.jobs.release(job.id, job.runner);
        } finally {
          releaseJob?.();
        }
      }
    }
    return steps;
  }
  private async save(job: ScheduledBrewJob, state: ScheduledBrewState | null, skipped = false) {
    const at = this.clock.now().getTime();
    await this.jobs.checkpoint(job, state, at, at + SCHEDULE_LEASE_MS, skipped);
    if (state) job.state = state;
    job.version++;
  }
  private async freeze(job: ScheduledBrewJob, payload: ScheduledPayload) {
    const at = this.clock.now().getTime();
    const id = await this.jobs.freeze(job, payload, at, at + SCHEDULE_LEASE_MS);
    if (id !== null && job.request.kind === 'composition') {
      job.state = { phase: 'delivery', issueId: id, started: false };
      job.version++;
      return false;
    }
    return true;
  }
  private async step(job: ScheduledBrewJob): Promise<boolean> {
    const state = job.state,
      request = job.request,
      when = new Date(request.receipt.value);
    if (state.phase === 'delivery') {
      if (request.kind !== 'composition') throw new Error('Invalid scheduled delivery.');
      const interrupted = state.started;
      if (!interrupted) await this.save(job, { ...state, started: true });
      const issue = await this.storage.snapshot(state.issueId);
      if (issue && 'version' in issue)
        await new BrewDeliveryRunner(
          {
            claimDelivery: (id, results) =>
              this.jobs.claimDelivery(job, id, results, this.clock.now().getTime()),
            saveDelivery: (id, results) =>
              this.jobs.saveDelivery(job, id, results, this.clock.now().getTime()),
            deliveryResults: (id) => this.jobs.deliveryResults(job, id, this.clock.now().getTime()),
          },
          this.clock,
          this.delivery,
        ).deliver(issue, request.config.delivery, interrupted);
      await this.save(job, null);
      return true;
    }
    if (request.kind === 'legacy' && state.phase === 'legacy') {
      const section = request.config.sections[state.index];
      if (!section)
        return this.freeze(job, { configName: request.config.name, sections: state.sections });
      const items = legacyBrewItems(await this.storage.items(legacyBrewQuery(section, when)));
      await this.save(job, {
        ...state,
        index: state.index + 1,
        sections: [...state.sections, { ...section, items }],
      });
      return false;
    }
    if (request.kind !== 'composition' || state.phase !== 'composition')
      throw new Error('Invalid scheduled composition.');
    const config = request.config,
      section = config.sections[state.index];
    if (!section) {
      const count = new Set(
        state.sections.flatMap((value) =>
          value.items.filter((item) => !item.readAt).map((item) => item.id),
        ),
      ).size;
      if (count < (config.schedule.skipIfFewerThan ?? 0)) {
        await this.save(job, null, true);
        return true;
      }
      return this.freeze(job, {
        version: 2,
        issueNumber: 0,
        configName: config.name,
        generatedAt: request.receipt.value,
        timezone: config.timezone,
        sections: state.sections,
      });
    }
    if (!sectionActive(section, when, config.timezone)) {
      await this.save(job, {
        ...state,
        index: state.index + 1,
        source: 0,
        selection: initialScheduledSelection(),
      });
      return false;
    }
    const source = section.kind === 'items' ? section.sources[state.source] : undefined;
    if (source) {
      const search =
        source.kind === 'saved_search'
          ? await this.storage.savedSourceSearch(source.id!)
          : undefined;
      const query =
        source.kind === 'saved_search' && !search
          ? null
          : sectionSourceQuery(section, source, when, search);
      const at = this.clock.now().getTime(),
        next = { ...state, source: state.source + 1 };
      await this.jobs.captureSource(job, query, when.getTime(), next, at, at + SCHEDULE_LEASE_MS);
      job.state = next;
      job.version++;
      return false;
    }
    const selection = state.selection;
    if (section.kind === 'items' && !selection.done) {
      const limit = Math.max(1, Math.min(100, this.budget.candidatePageSize ?? 32));
      const page = await this.jobs.candidates(
        job,
        selection.after,
        limit,
        section.filter?.conditions.some((condition) => condition.field === 'content') ?? false,
        this.clock.now().getTime(),
      );
      if (page.length) {
        const matching = await matchingContexts(page, section.filter, this.regex);
        const selected = [
          ...selection.selected,
          ...matching.map((row) => compositionRank(section, row)),
        ];
        selected.sort((a, b) => compareCompositionRanks(section, a, b));
        await this.save(job, {
          ...state,
          selection: {
            after: page.at(-1)!.id,
            eligible: selection.eligible + page.length,
            matching: selection.matching + matching.length,
            selected: selected.slice(0, section.maxItems),
            done: page.length < limit,
          },
        });
        return false;
      }
    }
    const ids = selection.selected.map((value) => value.id);
    const selected = await this.jobs.selectedCandidates(job, ids, this.clock.now().getTime());
    const byId = new Map(selected.map((row) => [row.id, row]));
    const completed = renderCompositionSection(
      section,
      ids.map((id) => {
        const row = byId.get(id);
        if (!row) throw new Error('A captured Brew candidate is unavailable.');
        return row;
      }),
      selection.eligible,
      selection.matching,
    );
    await this.save(job, {
      ...state,
      index: state.index + 1,
      source: 0,
      selection: initialScheduledSelection(),
      sections: [...state.sections, completed.section],
    });
    return false;
  }
}
