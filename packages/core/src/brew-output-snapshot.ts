import { marked } from 'marked';
import { upgradeLegacySections } from './composition-model.js';
import { sanitizeArticleHtml } from './html-sanitizer.js';
import type { BrewIssue, BrewSnapshot } from './types/composition.js';

/** Adapt legacy frozen content in memory; never regenerate it from today's library/config. */
export function brewOutputSnapshot(issue: BrewIssue, legacyTimezone = 'UTC'): BrewSnapshot {
  if ('version' in issue) return issue;
  const itemsBySection = new Map(issue.sections.map((section) => [section.id, section.items]));
  return {
    ...issue,
    version: 2,
    issueNumber: issue.id,
    timezone: legacyTimezone,
    sections: upgradeLegacySections(issue.sections).map((section) => ({
      ...section,
      items: section.kind === 'items' ? itemsBySection.get(section.id)! : [],
      matchingItems: section.kind === 'items' ? itemsBySection.get(section.id)!.length : 0,
      eligibleItems: section.kind === 'items' ? itemsBySection.get(section.id)!.length : 0,
      ...(section.kind === 'note'
        ? {
            noteHtml: sanitizeArticleHtml(marked.parse(section.note ?? '', { async: false })) ?? '',
          }
        : {}),
    })),
  };
}
