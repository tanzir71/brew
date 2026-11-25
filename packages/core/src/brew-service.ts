import type {
  BrewConfig,
  BrewConfigDraft,
  BrewItem,
  BrewSection,
  BrewSnapshot,
} from './types/brew.js';
import type { BrewStoragePort, ClockPort } from './ports.js';

export class BrewService {
  constructor(
    private readonly storage: BrewStoragePort,
    private readonly clock: ClockPort,
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
    return this.snapshot(id)!;
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
  history(configId: number): BrewSnapshot[] {
    return this.storage.historyIds(configId).map((id) => this.snapshot(id)!);
  }
  snapshot(id: number): BrewSnapshot | null {
    return this.storage.snapshot(id);
  }
  saveScroll(id: number, position: number): void {
    this.storage.setSetting(`brew_scroll_${id}`, String(Math.max(0, position)));
  }
  runScheduled(now = this.clock.now()): number {
    let generated = 0;
    const date = now.toISOString().slice(0, 10);
    for (const config of this.listConfigs().filter((config) => config.enabled)) {
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
