import { BrewDeliveryRunner } from './brew-delivery.js';
import type { BrewDeliveryOptions } from './types/delivery.js';
import type {
  BrewConfig,
  BrewConfigDraft,
  BrewItem,
  BrewSection,
  BrewSnapshot,
} from './types/legacy-brew.js';
import type { BrewStoragePort, ClockPort, RegexPort } from './ports.js';
import type {
  BrewConfigDraft as CompositionDraft,
  BrewIssue,
  BrewSnapshot as CompositionSnapshot,
} from './types/brew.js';
import {
  validateComposition,
  validateBrewSchedule,
  BREW_RETENTION_DAYS,
} from './composition-model.js';
import { CompositionPreview, parsePreviewTime } from './composition-preview.js';
import { nextBrewAt } from './brew-schedule.js';

export class BrewService {
  constructor(
    private readonly storage: BrewStoragePort,
    private readonly clock: ClockPort,
    private readonly regex: RegexPort = {
      test: async () => ({ matched: false, timedOut: false, error: 'Regex is unavailable.' }),
    },
    private readonly delivery: BrewDeliveryOptions = {},
  ) {}
  listConfigs(): BrewConfig[] {
    return this.storage.listConfigs();
  }
  private validate(draft: BrewConfigDraft): void {
    if (!draft.name.trim()) throw new Error('Brew name is required');
    for (const section of draft.sections) {
      if (section.maxItems < 1 || section.maxItems > 20)
        throw new Error('Section size must be 1–20');
      if (['folder', 'feed', 'tag'].includes(section.source) && !section.sourceId)
        throw new Error('Choose a section source');
    }
  }
  create(draft: BrewConfigDraft): BrewConfig {
    this.validate(draft);
    const id = this.storage.create({ ...draft, name: draft.name.trim() });
    return this.listConfigs().find((config) => config.id === id)!;
  }
  update(id: number, draft: BrewConfigDraft): BrewConfig | null {
    this.validate(draft);
    return this.storage.update(id, { ...draft, name: draft.name.trim() })
      ? this.listConfigs().find((config) => config.id === id)!
      : null;
  }
  delete(id: number): boolean {
    return this.storage.delete(id);
  }
  generate(configId: number): BrewSnapshot {
    const config = this.listConfigs().find((config) => config.id === configId);
    if (!config) throw new Error('Brew not found');
    const now = this.clock.now();
    const payload = {
      configName: config.name,
      sections: config.sections.map((section) => ({
        ...section,
        items: this.items(section, now),
      })),
    };
    const id = this.storage.save(configId, payload);
    this.storage.prune(configId, 30);
    return this.snapshot(id)! as BrewSnapshot;
  }
  private items(section: BrewSection, now: Date): BrewItem[] {
    const rows = this.storage.items({
      onlyUnread: section.onlyUnread,
      folderId: section.source === 'folder' ? section.sourceId : undefined,
      feedId: section.source === 'feed' ? section.sourceId : undefined,
      tagId: section.source === 'tag' ? section.sourceId : undefined,
      starred: section.source === 'starred' || section.source === 'weekly_review',
      featured: section.source === 'featured',
      publishedSince:
        section.source === 'today'
          ? now.getTime() - 86_400_000
          : section.source === 'weekly_review'
            ? now.getTime() - 7 * 86_400_000
            : undefined,
      sort: section.sort,
      limit: section.maxItems,
    });
    return rows.map(({ body, ...row }) => ({
      ...row,
      publishedAt: new Date(row.publishedAt).toISOString(),
      readAt: row.readAt === null ? null : new Date(row.readAt).toISOString(),
      readTimeMinutes: Math.max(
        1,
        Math.ceil((body?.replace(/<[^>]+>/g, '').split(/\s+/).length ?? 0) / 220),
      ),
    }));
  }
  history(configId: number): BrewIssue[] {
    return this.storage.historyIds(configId).map((id) => this.snapshot(id)!);
  }
  snapshot(id: number): BrewIssue | null {
    return this.storage.snapshot(id);
  }
  composition(id: number) {
    return this.storage.composition(id);
  }
  usesComposition(id: number) {
    return this.storage.usesComposition(id);
  }
  createComposition(draft: CompositionDraft) {
    validateComposition(draft);
    return this.composition(this.storage.createComposition(draft))!;
  }
  updateComposition(id: number, draft: CompositionDraft) {
    validateComposition(draft);
    return this.storage.updateComposition(id, draft) ? this.composition(id) : null;
  }
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
    const config = Number.isSafeInteger(id) && id > 0 ? this.composition(id) : null;
    if (!config) return null;
    return this.previewComposition(draft === undefined ? config : draft, id, at);
  }
  async generateComposition(id: number) {
    const config = this.composition(id);
    if (!config) throw new Error('Brew not found');
    const { snapshot } = await new CompositionPreview(this.storage, this.clock, this.regex).build(
      config,
      id,
      this.clock.now(),
    );
    const issue = this.freezeComposition(snapshot) as CompositionSnapshot;
    await new BrewDeliveryRunner(this.storage, this.clock, this.delivery).deliver(
      issue,
      config.delivery,
    );
    return issue;
  }
  private freezeComposition(snapshot: CompositionSnapshot) {
    const payload = {
      version: snapshot.version,
      issueNumber: snapshot.issueNumber,
      configName: snapshot.configName,
      generatedAt: snapshot.generatedAt,
      timezone: snapshot.timezone,
      sections: snapshot.sections,
    };
    const issueId = this.storage.save(snapshot.brewConfigId, payload);
    this.storage.pruneBefore(
      snapshot.brewConfigId,
      this.clock.now().getTime() - BREW_RETENTION_DAYS * 86_400_000,
    );
    return this.snapshot(issueId)!;
  }
  private readonly runningCompositions = new Set<number>();
  async runCompositionScheduled(now = this.clock.now()): Promise<number> {
    let generated = 0;
    for (const legacy of this.listConfigs()) {
      if (this.usesComposition(legacy.id))
        this.storage.pruneBefore(legacy.id, now.getTime() - BREW_RETENTION_DAYS * 86_400_000);
      if (
        !this.usesComposition(legacy.id) ||
        !legacy.enabled ||
        this.runningCompositions.has(legacy.id)
      )
        continue;
      const config = this.composition(legacy.id)!;
      const scheduled = nextBrewAt(
        config.schedule,
        config.timezone,
        new Date(now.getTime() - 60_000),
      );
      if (scheduled.getTime() > now.getTime()) continue;
      const key = `brew_composed_${legacy.id}_${scheduled.toISOString()}`;
      if (this.storage.setting(key)) continue;
      this.runningCompositions.add(legacy.id);
      try {
        const preview = await this.previewComposition(config, config.id, scheduled.toISOString());
        const count = new Set(
          preview.snapshot.sections.flatMap((section) =>
            section.items.filter((item) => !item.readAt).map((item) => item.id),
          ),
        ).size;
        if (count >= (config.schedule.skipIfFewerThan ?? 0)) {
          const issue = this.freezeComposition(preview.snapshot) as CompositionSnapshot;
          // Commit the schedule receipt before delivery can wait on the network.
          this.storage.setSetting(key, scheduled.toISOString());
          generated++;
          await new BrewDeliveryRunner(this.storage, this.clock, this.delivery).deliver(
            issue,
            config.delivery,
          );
        } else {
          this.storage.setSetting(key, scheduled.toISOString());
        }
      } finally {
        this.runningCompositions.delete(legacy.id);
      }
    }
    return generated;
  }
  deliveryResults(id: number) {
    return this.storage.deliveryResults(id);
  }
  readState(id: number) {
    const issue = this.snapshot(id);
    if (!issue) return null;
    if (this.usesComposition(issue.brewConfigId)) {
      const config = this.composition(issue.brewConfigId)!;
      return {
        articles: this.storage.articleStates([
          ...new Set(issue.sections.flatMap((section) => section.items.map((item) => item.id))),
        ]),
        timeZone: config.timezone,
        nextAt: config.enabled
          ? nextBrewAt(config.schedule, config.timezone, this.clock.now()).toISOString()
          : null,
        scheduleLabel: config.enabled
          ? config.schedule.kind === 'weekdays'
            ? 'Weekdays'
            : config.schedule.kind === 'weekly'
              ? 'Weekly'
              : config.schedule.kind === 'monthly'
                ? 'Monthly'
                : 'Daily'
          : 'Schedule paused',
      };
    }
    const config = this.listConfigs().find((item) => item.id === issue.brewConfigId);
    const [minute, hour] = (config?.scheduleCron ?? '').split(/\s+/).map(Number);
    const next = new Date(this.clock.now());
    let nextAt: string | null = null;
    if (
      config?.enabled &&
      Number.isInteger(minute) &&
      Number.isInteger(hour) &&
      minute! >= 0 &&
      minute! < 60 &&
      hour! >= 0 &&
      hour! < 24
    ) {
      const now = next.getTime();
      next.setHours(hour!, minute!, 0, 0);
      if (next.getTime() <= now) next.setDate(next.getDate() + 1);
      nextAt = next.toISOString();
    }
    return {
      articles: this.storage.articleStates([
        ...new Set(issue.sections.flatMap((section) => section.items.map((item) => item.id))),
      ]),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      nextAt,
      scheduleLabel: config?.enabled ? 'Daily' : 'Schedule paused',
    };
  }
  saveScroll(id: number, position: number): void {
    this.storage.setSetting(`brew_scroll_${id}`, String(Math.max(0, position)));
  }
  runScheduled(now = this.clock.now()): number {
    let generated = 0;
    const date = now.toISOString().slice(0, 10);
    for (const config of this.listConfigs().filter(
      (config) => config.enabled && !this.usesComposition(config.id),
    )) {
      const [minute, hour] = config.scheduleCron.trim().split(/\s+/);
      if (minute !== String(now.getMinutes()) || hour !== String(now.getHours())) continue;
      const key = `brew_generated_${config.id}_${date}`;
      if (this.storage.setting(key)) continue;
      this.generate(config.id);
      this.storage.setSetting(key, now.toISOString());
      generated++;
    }
    return generated;
  }
}
