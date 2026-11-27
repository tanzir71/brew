import { marked } from 'marked';
import { escapeOutputHtml } from './brew-output-content.js';
import { sanitizeArticleHtml } from './html-sanitizer.js';
import { weekdayAt } from './brew-schedule.js';
import { matchingContexts } from './rule-matching.js';
import type { BrewCandidate, BrewItemQuery, RegexPort } from './ports.js';
import type { BrewSection, BrewSourceRef, BrewSnapshotSection } from './types/brew.js';

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const newsletterSummary = (content: string) => {
  const excerpt = content.replace(/\s+/g, ' ').trim();
  return `<p>${escapeOutputHtml(excerpt.length > 180 ? `${excerpt.slice(0, 177).trimEnd()}…` : excerpt)}</p>`;
};
export interface CompositionRank {
  id: number;
  publishedAt: number;
  length: number;
}
export function compositionRank(section: BrewSection, row: BrewCandidate): CompositionRank {
  return {
    id: row.id,
    publishedAt: row.publishedAt,
    length: section.sort === 'longest' ? text(row.body ?? '').length : 0,
  };
}
export function compareCompositionRanks(
  section: BrewSection,
  a: CompositionRank,
  b: CompositionRank,
) {
  return section.sort === 'longest'
    ? b.length - a.length || b.id - a.id
    : section.sort === 'oldest'
      ? a.publishedAt - b.publishedAt || a.id - b.id
      : b.publishedAt - a.publishedAt || b.id - a.id;
}
export function sectionActive(section: BrewSection, when: Date, timezone: string) {
  return !section.days?.length || section.days.includes(weekdayAt(when, timezone));
}
export function sectionSourceQuery(
  section: BrewSection,
  source: BrewSourceRef,
  when: Date,
  search?: { query: string },
): BrewItemQuery {
  return {
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
  };
}
/** Manual previews and durable scheduled work share selection, rendering and filters. */
export async function finishCompositionSection(
  section: BrewSection,
  eligible: BrewCandidate[],
  regex: RegexPort,
): Promise<{ section: BrewSnapshotSection; warnings: string[] }> {
  if (section.kind !== 'items') return renderCompositionSection(section, [], 0, 0);
  const matching = await matchingContexts(eligible, section.filter, regex);
  const ranked = matching.map((row) => ({ row, rank: compositionRank(section, row) }));
  ranked.sort((a, b) => compareCompositionRanks(section, a.rank, b.rank));
  return renderCompositionSection(
    section,
    ranked.slice(0, section.maxItems).map((value) => value.row),
    eligible.length,
    matching.length,
  );
}
/** Render an already selected page without evaluating its conditions again. */
export function renderCompositionSection(
  section: BrewSection,
  selected: BrewCandidate[],
  eligibleItems: number,
  matchingItems: number,
): { section: BrewSnapshotSection; warnings: string[] } {
  if (section.kind !== 'items')
    return {
      section: {
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
      },
      warnings: [],
    };
  return {
    warnings:
      section.depth === 'brief' ? [`${section.title}: Brief needs a configured AI provider.`] : [],
    section: {
      ...section,
      eligibleItems,
      matchingItems,
      items: selected.slice(0, section.maxItems).map((row) => ({
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
    },
  };
}
