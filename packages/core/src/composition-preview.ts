import { Temporal } from '@js-temporal/polyfill';
import { renderBrewOutputs as previewOutputs } from './brew-outputs.js';
import { escapeOutputHtml as escapeHtml } from './brew-output-content.js';
export { previewOutputs, escapeHtml };
import { validateComposition } from './composition-model.js';
import { nextBrewAt } from './brew-schedule.js';
import {
  sectionActive,
  sectionSourceQuery,
  finishCompositionSection,
} from './composition-section.js';
import type { BrewPreviewStoragePort, ClockPort, RegexPort, BrewCandidate } from './ports.js';
import type {
  BrewConfigDraft,
  BrewPreview,
  BrewSnapshot,
  BrewSnapshotSection,
} from './types/brew.js';

export function parsePreviewTime(at: unknown): Date {
  try {
    if (typeof at !== 'string') throw new Error();
    const value = new Date(Temporal.Instant.from(at).epochMilliseconds);
    if (!Number.isFinite(value.getTime())) throw new Error();
    return value;
  } catch {
    throw new Error('Choose a valid preview time with Z or a UTC offset.');
  }
}

export class CompositionPreview {
  constructor(
    private storage: BrewPreviewStoragePort,
    private clock: ClockPort,
    private regex: RegexPort,
  ) {}
  async build(draft: BrewConfigDraft, configId = 0, at?: Date): Promise<BrewPreview> {
    validateComposition(draft);
    // A caller can keep editing while an asynchronous section filter is running.
    draft = structuredClone(draft);
    const when = new Date(
      (at ?? nextBrewAt(draft.schedule, draft.timezone, this.clock.now())).getTime(),
    );
    if (!Number.isFinite(when.getTime())) throw new Error('Choose a valid preview time.');
    const warnings: string[] = [];
    const sections: BrewSnapshotSection[] = [];
    for (const section of draft.sections) {
      if (!sectionActive(section, when, draft.timezone)) continue;
      const unique = new Map<number, BrewCandidate>();
      if (section.kind === 'items')
        for (const source of section.sources) {
          const search =
            source.kind === 'saved_search'
              ? await this.storage.savedSourceSearch(source.id!)
              : undefined;
          if (source.kind === 'saved_search' && !search) {
            warnings.push(`${section.title}: Saved search is no longer available.`);
            continue;
          }
          const rows = await this.storage.compositionItems(
            sectionSourceQuery(section, source, when, search),
          );
          for (const row of rows) if (row.publishedAt <= when.getTime()) unique.set(row.id, row);
        }
      const completed = await finishCompositionSection(section, [...unique.values()], this.regex);
      warnings.push(...completed.warnings);
      sections.push(completed.section);
    }
    const snapshot: BrewSnapshot = {
      version: 2,
      id: 0,
      issueNumber: configId ? await this.storage.nextIssueNumber(configId) : 1,
      brewConfigId: configId,
      configName: draft.name,
      generatedAt: when.toISOString(),
      timezone: draft.timezone,
      sections,
      scrollPosition: 0,
    };
    return { snapshot, outputs: previewOutputs(snapshot), warnings: [...new Set(warnings)] };
  }
}
