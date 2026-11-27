import { BrewDeliveryRunner } from './brew-delivery.js';
import type { BrewDeliveryOptions } from './types/delivery.js';
import type { AsyncBrewStoragePort, ClockPort, RegexPort } from './ports.js';
import type {
  BrewConfigDraft as CompositionDraft,
  BrewSnapshot as CompositionSnapshot,
} from './types/brew.js';
import { validateBrewSchedule, BREW_RETENTION_DAYS } from './composition-model.js';
import { CompositionPreview, parsePreviewTime } from './composition-preview.js';
import { nextBrewAt } from './brew-schedule.js';

/** The same asynchronous composition and delivery policy runs on every target. */
export class BrewCompositionService {
  constructor(
    private readonly storage: AsyncBrewStoragePort,
    private readonly clock: ClockPort,
    private readonly regex: RegexPort = {
      test: async () => ({ matched: false, timedOut: false, error: 'Regex is unavailable.' }),
    },
    private readonly delivery: BrewDeliveryOptions = {},
  ) {}
  scheduleInfo(
    value: Pick<CompositionDraft, 'schedule' | 'timezone' | 'enabled'>,
  ): import('./types/delivery.js').ScheduleInfo {
    if (!value || typeof value.enabled !== 'boolean')
      throw new Error('Choose whether the schedule is enabled.');
    validateBrewSchedule(value.schedule, value.timezone);
    const now = this.clock.now();
    return {
      now: now.toISOString(),
      nextAt: value.enabled ? nextBrewAt(value.schedule, value.timezone, now).toISOString() : null,
      timezone: value.timezone,
    };
  }
  previewCompositionNow(draft: CompositionDraft, id: number) {
    return new CompositionPreview(this.storage, this.clock, this.regex).build(
      draft,
      id,
      this.clock.now(),
    );
  }
  previewComposition(draft: CompositionDraft, id = 0, at?: string) {
    return new CompositionPreview(this.storage, this.clock, this.regex).build(
      draft,
      id,
      at === undefined ? undefined : parsePreviewTime(at),
    );
  }
  async previewBrew(id: number, at?: string, draft?: CompositionDraft) {
    const config = Number.isSafeInteger(id) && id > 0 ? await this.storage.composition(id) : null;
    if (!config) return null;
    return this.previewComposition(draft === undefined ? config : draft, id, at);
  }
  async generateComposition(id: number) {
    const config = await this.storage.composition(id);
    if (!config) throw new Error('Brew not found');
    const { snapshot } = await new CompositionPreview(this.storage, this.clock, this.regex).build(
      config,
      id,
      this.clock.now(),
    );
    const issue = (await this.freezeComposition(snapshot)) as CompositionSnapshot;
    await new BrewDeliveryRunner(this.storage, this.clock, this.delivery).deliver(
      issue,
      config.delivery,
    );
    return issue;
  }
  private async freezeComposition(
    snapshot: CompositionSnapshot,
    receipt?: { key: string; value: string },
  ) {
    const payload = {
      version: snapshot.version,
      issueNumber: snapshot.issueNumber,
      configName: snapshot.configName,
      generatedAt: snapshot.generatedAt,
      timezone: snapshot.timezone,
      sections: snapshot.sections,
    };
    const issueId = receipt
      ? await this.storage.saveScheduled(snapshot.brewConfigId, payload, receipt)
      : await this.storage.save(snapshot.brewConfigId, payload);
    if (issueId === null) return null;
    await this.storage.pruneBefore(
      snapshot.brewConfigId,
      this.clock.now().getTime() - BREW_RETENTION_DAYS * 86_400_000,
    );
    return (await this.storage.snapshot(issueId))!;
  }
  async runCompositionScheduled(now = this.clock.now()): Promise<number> {
    let generated = 0;
    for (const legacy of await this.storage.listConfigs()) {
      if (!(await this.storage.usesComposition(legacy.id))) continue;
      await this.storage.pruneBefore(legacy.id, now.getTime() - BREW_RETENTION_DAYS * 86_400_000);
      if (!legacy.enabled) continue;
      const config = (await this.storage.composition(legacy.id))!;
      const scheduled = nextBrewAt(
        config.schedule,
        config.timezone,
        new Date(now.getTime() - 60_000),
      );
      if (scheduled.getTime() > now.getTime()) continue;
      const receipt = {
        key: `brew_composed_${legacy.id}_${scheduled.toISOString()}`,
        value: scheduled.toISOString(),
      };
      if (await this.storage.setting(receipt.key)) continue;
      const preview = await this.previewComposition(config, config.id, receipt.value);
      const count = new Set(
        preview.snapshot.sections.flatMap((section) =>
          section.items.filter((item) => !item.readAt).map((item) => item.id),
        ),
      ).size;
      if (count < (config.schedule.skipIfFewerThan ?? 0)) {
        await this.storage.claimSchedule(receipt.key, receipt.value);
        continue;
      }
      // The issue and receipt commit together before delivery. Concurrent invocations
      // may preview the same minute, but only one can freeze and send that issue.
      const issue = (await this.freezeComposition(
        preview.snapshot,
        receipt,
      )) as CompositionSnapshot | null;
      if (!issue) continue;
      generated++;
      await new BrewDeliveryRunner(this.storage, this.clock, this.delivery).deliver(
        issue,
        config.delivery,
      );
    }
    return generated;
  }
}
