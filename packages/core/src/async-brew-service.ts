import { BrewCompositionService } from './brew-composition-service.js';
import { legacyScheduleReceipt } from './brew-scheduled-request.js';
import { validateComposition } from './composition-model.js';
import {
  validateLegacyBrew,
  legacyBrewQuery,
  legacyBrewItems,
  brewReadInfo,
} from './brew-model.js';
import type { AsyncBrewStoragePort, ClockPort, RegexPort } from './ports.js';
import type { BrewDeliveryOptions } from './types/delivery.js';
import type { BrewConfig, BrewConfigDraft, BrewSnapshot } from './types/legacy-brew.js';
import type { BrewConfigDraft as CompositionDraft } from './types/brew.js';

/** Async facade over the same composition, selection, validation and delivery policies. */
export class AsyncBrewService extends BrewCompositionService {
  constructor(
    private readonly asyncStorage: AsyncBrewStoragePort,
    private readonly asyncClock: ClockPort,
    regex?: RegexPort,
    delivery?: BrewDeliveryOptions,
  ) {
    super(asyncStorage, asyncClock, regex, delivery);
  }
  async listConfigs() {
    return this.asyncStorage.listConfigs();
  }
  async create(draft: BrewConfigDraft) {
    validateLegacyBrew(draft);
    const id = await this.asyncStorage.create({ ...draft, name: draft.name.trim() });
    return (await this.listConfigs()).find((config) => config.id === id)!;
  }
  async update(id: number, draft: BrewConfigDraft) {
    validateLegacyBrew(draft);
    return (await this.asyncStorage.update(id, { ...draft, name: draft.name.trim() }))
      ? (await this.listConfigs()).find((config) => config.id === id)!
      : null;
  }
  async delete(id: number) {
    return this.asyncStorage.delete(id);
  }
  private async generateLegacy(config: BrewConfig, receipt?: { key: string; value: string }) {
    const now = this.asyncClock.now();
    const sections = [];
    for (const section of config.sections) {
      sections.push({
        ...section,
        items: legacyBrewItems(await this.asyncStorage.items(legacyBrewQuery(section, now))),
      });
    }
    const payload = { configName: config.name, sections };
    const id = receipt
      ? await this.asyncStorage.saveScheduled(config.id, payload, receipt)
      : await this.asyncStorage.save(config.id, payload);
    if (id === null) return null;
    await this.asyncStorage.prune(config.id, 30);
    return (await this.snapshot(id)) as BrewSnapshot;
  }
  async generate(id: number) {
    const config = (await this.listConfigs()).find((config) => config.id === id);
    if (!config) throw new Error('Brew not found');
    return (await this.generateLegacy(config))!;
  }
  async history(id: number) {
    const issues = [];
    for (const issueId of await this.asyncStorage.historyIds(id)) {
      const issue = await this.snapshot(issueId);
      if (issue) issues.push(issue);
    }
    return issues;
  }
  async snapshot(id: number) {
    return this.asyncStorage.snapshot(id);
  }
  async composition(id: number) {
    return this.asyncStorage.composition(id);
  }
  async usesComposition(id: number) {
    return this.asyncStorage.usesComposition(id);
  }
  async createComposition(draft: CompositionDraft) {
    validateComposition(draft);
    return (await this.composition(await this.asyncStorage.createComposition(draft)))!;
  }
  async updateComposition(id: number, draft: CompositionDraft) {
    validateComposition(draft);
    return (await this.asyncStorage.updateComposition(id, draft)) ? this.composition(id) : null;
  }
  async deliveryResults(id: number) {
    return this.asyncStorage.deliveryResults(id);
  }
  async readState(id: number) {
    const issue = await this.snapshot(id);
    if (!issue) return null;
    const config = (await this.usesComposition(issue.brewConfigId))
      ? ((await this.composition(issue.brewConfigId)) ?? undefined)
      : (await this.listConfigs()).find((config) => config.id === issue.brewConfigId);
    return {
      ...brewReadInfo(config, this.asyncClock.now()),
      articles: await this.asyncStorage.articleStates([
        ...new Set(issue.sections.flatMap((section) => section.items.map((item) => item.id))),
      ]),
    };
  }
  async saveScroll(id: number, position: number) {
    await this.asyncStorage.setSetting(`brew_scroll_${id}`, String(Math.max(0, position)));
  }
  async runScheduled(now = this.asyncClock.now()) {
    let generated = 0;
    for (const config of await this.listConfigs()) {
      if (!config.enabled || (await this.usesComposition(config.id))) continue;
      const receipt = legacyScheduleReceipt(config, now);
      if (!receipt) continue;
      if (await this.asyncStorage.setting(receipt.key)) continue;
      if (await this.generateLegacy(config, receipt)) generated++;
    }
    return generated;
  }
}
