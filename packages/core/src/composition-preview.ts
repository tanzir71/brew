import { marked } from 'marked';
import { Temporal } from '@js-temporal/polyfill';
import { renderBrewOutputs as previewOutputs } from './brew-outputs.js';
import { escapeOutputHtml as escapeHtml } from './brew-output-content.js';
export { previewOutputs, escapeHtml };
import { sanitizeArticleHtml } from './html-sanitizer.js';
import { validateComposition } from './composition-model.js';
import { nextBrewAt, weekdayAt } from './brew-schedule.js';
import { matchingContexts } from './rule-matching.js';
import type { BrewPreviewStoragePort, ClockPort, RegexPort, BrewCandidate } from './ports.js';
import type {
  BrewConfigDraft,
  BrewPreview,
  BrewSnapshot,
  BrewSnapshotSection,
} from './types/brew.js';

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const newsletterSummary = (content: string): string => {
  const excerpt = content.replace(/\s+/g, ' ').trim();
  return `<p>${escapeHtml(excerpt.length > 180 ? `${excerpt.slice(0, 177).trimEnd()}…` : excerpt)}</p>`;
};

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
      if (section.days?.length && !section.days.includes(weekdayAt(when, draft.timezone))) continue;
      if (section.kind !== 'items') {
        sections.push({
          ...section,
          items: [],
          eligibleItems: 0,
          matchingItems: 0,
          ...(section.kind === 'note'
            ? {
                noteHtml:
                  sanitizeArticleHtml(marked.parse(section.note ?? '', { async: false })) ?? '',
              }
            : {}),
        });
        continue;
      }
      const unique = new Map<number, BrewCandidate>();
      for (const source of section.sources) {
        const search =
          source.kind === 'saved_search' ? this.storage.savedSourceSearch(source.id!) : undefined;
        if (source.kind === 'saved_search' && !search) {
          warnings.push(`${section.title}: Saved search is no longer available.`);
          continue;
        }
        const rows = this.storage.compositionItems({
          newsletters:
            source.kind === 'newsletters'
              ? { senderIds: source.senderIds, tagIds: source.tagIds }
              : undefined,
          searchQuery: search?.query,
          onlyUnread: section.onlyUnread,
          folderId: source.kind === 'folder' ? source.id : undefined,
          feedId: source.kind === 'feed' ? source.id : undefined,
          tagId: source.kind === 'tag' ? source.id : undefined,
          starred: source.kind === 'starred' || source.kind === 'weekly_review',
          featured: source.kind === 'featured',
          publishedSince:
            source.kind === 'today'
              ? when.getTime() - 86_400_000
              : source.kind === 'weekly_review'
                ? when.getTime() - 7 * 86_400_000
                : undefined,
          sort: section.sort,
        });
        for (const row of rows) if (row.publishedAt <= when.getTime()) unique.set(row.id, row);
      }
      const eligible = [...unique.values()];
      const matching = await matchingContexts(eligible, section.filter, this.regex);
      matching.sort((a, b) =>
        section.sort === 'longest'
          ? text(b.body ?? '').length - text(a.body ?? '').length || b.id - a.id
          : section.sort === 'oldest'
            ? a.publishedAt - b.publishedAt || a.id - b.id
            : b.publishedAt - a.publishedAt || b.id - a.id,
      );
      if (section.depth === 'brief')
        warnings.push(`${section.title}: Brief needs a configured AI provider.`);
      sections.push({
        ...section,
        eligibleItems: eligible.length,
        matchingItems: matching.length,
        items: matching.slice(0, section.maxItems).map((row) => ({
          id: row.id,
          feedId: row.feedId,
          ...(row.newsletter ? { newsletter: structuredClone(row.newsletter) } : {}),
          title: row.title,
          url: row.url,
          author: row.author || null,
          summaryHtml:
            section.depth === 'title'
              ? null
              : row.newsletter
                ? newsletterSummary(row.content)
                : sanitizeArticleHtml(row.summaryHtml, { images: section.images }),
          imageUrl: section.images ? row.imageUrl : null,
          publishedAt: new Date(row.publishedAt).toISOString(),
          readAt: row.readAt === null ? null : new Date(row.readAt).toISOString(),
          feedTitle: row.feed,
          readTimeMinutes: Math.max(
            1,
            Math.ceil(
              text(row.body ?? '')
                .split(/\s+/)
                .filter(Boolean).length / 220,
            ),
          ),
          ...(section.depth === 'full'
            ? { contentHtml: sanitizeArticleHtml(row.body, { images: section.images }) }
            : {}),
        })),
      });
    }
    const snapshot: BrewSnapshot = {
      version: 2,
      id: 0,
      issueNumber: configId ? this.storage.nextIssueNumber(configId) : 1,
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
