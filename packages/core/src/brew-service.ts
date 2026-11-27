import { BrewCompositionService } from './brew-composition-service.js';
import type { BrewDeliveryOptions } from './types/delivery.js';
import type {
  BrewConfig,
  BrewConfigDraft,
  BrewItem,
  BrewSection,
  BrewSnapshot,
} from './types/legacy-brew.js';
import type { BrewStoragePort, ClockPort, RegexPort } from './ports.js';
import type { BrewConfigDraft as CompositionDraft, BrewIssue } from './types/brew.js';
import { validateComposition } from './composition-model.js';
import {
  validateLegacyBrew,
  legacyBrewQuery,
  legacyBrewItems,
  brewReadInfo,
} from './brew-model.js';

export class BrewService extends BrewCompositionService {
  constructor(
    private readonly legacyStorage: BrewStoragePort,
    private readonly legacyClock: ClockPort,
    regex: RegexPort = {
      test: async () => ({ matched: false, timedOut: false, error: 'Regex is unavailable.' }),
    },
    delivery: BrewDeliveryOptions = {},
  ) {
    super(legacyStorage, legacyClock, regex, delivery);
  }
  listConfigs(): BrewConfig[] {
    return this.legacyStorage.listConfigs();
  }
  create(draft: BrewConfigDraft): BrewConfig {
    validateLegacyBrew(draft);
    const id = this.legacyStorage.create({ ...draft, name: draft.name.trim() });
    return this.listConfigs().find((config) => config.id === id)!;
  }
  update(id: number, draft: BrewConfigDraft): BrewConfig | null {
    validateLegacyBrew(draft);
    return this.legacyStorage.update(id, { ...draft, name: draft.name.trim() })
      ? this.listConfigs().find((config) => config.id === id)!
      : null;
  }
  delete(id: number): boolean {
    return this.legacyStorage.delete(id);
  }
  generate(configId: number): BrewSnapshot {
    const config = this.listConfigs().find((config) => config.id === configId);
    if (!config) throw new Error('Brew not found');
    const now = this.legacyClock.now();
    const payload = {
      configName: config.name,
      sections: config.sections.map((section) => ({
        ...section,
        items: this.items(section, now),
      })),
    };
    const id = this.legacyStorage.save(configId, payload);
    this.legacyStorage.prune(configId, 30);
    return this.snapshot(id)! as BrewSnapshot;
  }
  private items(section: BrewSection, now: Date): BrewItem[] {
    return legacyBrewItems(this.legacyStorage.items(legacyBrewQuery(section, now)));
  }
  history(configId: number): BrewIssue[] {
    return this.legacyStorage.historyIds(configId).map((id) => this.snapshot(id)!);
  }
  snapshot(id: number): BrewIssue | null {
    return this.legacyStorage.snapshot(id);
  }
  composition(id: number) {
    return this.legacyStorage.composition(id);
  }
  usesComposition(id: number) {
    return this.legacyStorage.usesComposition(id);
  }
  createComposition(draft: CompositionDraft) {
    validateComposition(draft);
    return this.composition(this.legacyStorage.createComposition(draft))!;
  }
  updateComposition(id: number, draft: CompositionDraft) {
    validateComposition(draft);
    return this.legacyStorage.updateComposition(id, draft) ? this.composition(id) : null;
  }
  deliveryResults(id: number) {
    return this.legacyStorage.deliveryResults(id);
  }
  readState(id: number) {
    const issue = this.snapshot(id);
    if (!issue) return null;
    const config = this.usesComposition(issue.brewConfigId)
      ? (this.composition(issue.brewConfigId) ?? undefined)
      : this.listConfigs().find((item) => item.id === issue.brewConfigId);
    return {
      ...brewReadInfo(config, this.legacyClock.now()),
      articles: this.legacyStorage.articleStates([
        ...new Set(issue.sections.flatMap((section) => section.items.map((item) => item.id))),
      ]),
    };
  }
  saveScroll(id: number, position: number): void {
    this.legacyStorage.setSetting(`brew_scroll_${id}`, String(Math.max(0, position)));
  }
  runScheduled(now = this.legacyClock.now()): number {
    let generated = 0;
    const date = now.toISOString().slice(0, 10);
    for (const config of this.listConfigs().filter(
      (config) => config.enabled && !this.usesComposition(config.id),
    )) {
      const [minute, hour] = config.scheduleCron.trim().split(/\s+/);
      if (minute !== String(now.getMinutes()) || hour !== String(now.getHours())) continue;
      const key = `brew_generated_${config.id}_${date}`;
      if (this.legacyStorage.setting(key)) continue;
      this.generate(config.id);
      this.legacyStorage.setSetting(key, now.toISOString());
      generated++;
    }
    return generated;
  }
}
