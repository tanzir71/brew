import { marked } from 'marked';
import { Temporal } from '@js-temporal/polyfill';
import { outputColors } from './output-colors.generated.js';
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

export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const safeLink = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value, 'https://brew.invalid').protocol)
      ? escapeHtml(value)
      : '#';
  } catch {
    return '#';
  }
};
const imageUrl = (value: string) =>
  value.startsWith('/api/img?') || value.startsWith('/figma/')
    ? value
    : `/api/img?src=${encodeURIComponent(value)}`;
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

export function previewOutputs(snapshot: BrewSnapshot): BrewPreview['outputs'] {
  const date = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeZone: snapshot.timezone,
  }).format(new Date(snapshot.generatedAt));
  const sectionHtml = (section: BrewSnapshotSection, email: boolean): string => {
    const title = `<h2>${escapeHtml(section.title)}</h2>`;
    if (section.kind === 'divider') return `<hr>${title}`;
    if (section.kind === 'note') return `<section>${title}${section.noteHtml ?? ''}</section>`;
    const brief =
      section.depth === 'brief'
        ? '<p>Brief needs a configured AI provider. Source articles:</p>'
        : '';
    const stories = section.items
      .map((item, index) => {
        const picture =
          section.images && item.imageUrl
            ? `<img alt="" src="${safeLink(imageUrl(item.imageUrl))}" ${email ? 'width="528" style="max-width:100%;height:auto;display:block;border-radius:8px"' : 'loading="lazy"'}>`
            : '';
        return `<article data-layout="${section.layout}"${index === 0 ? ' data-first="true"' : ''}>${picture}<p class="source">${escapeHtml(item.feedTitle)} · ${item.readTimeMinutes} min</p><h3><a href="${safeLink(item.url)}">${escapeHtml(item.title)}</a></h3>${section.depth === 'title' || section.depth === 'brief' ? '' : section.depth === 'full' ? (item.contentHtml ?? item.summaryHtml ?? '') : (item.summaryHtml ?? '')}</article>`;
      })
      .join('');
    return `<section>${title}${brief}<div class="layout-${section.layout}">${stories || '<p>No matching stories for this issue.</p>'}</div></section>`;
  };
  const content = `<p class="date">${escapeHtml(date)} · No. ${snapshot.issueNumber}</p><h1>${escapeHtml(snapshot.configName)}</h1>${snapshot.sections.map((section) => sectionHtml(section, false)).join('')}`;
  const { light, dark } = outputColors;
  const base = `*{font-style:normal!important}body{margin:0;color:${light['text/primary']};background:${light['bg/surface']};font:15px/1.5 Arial,sans-serif}h1,h2,h3{font-family:Georgia,serif}a{color:inherit}img{max-width:100%;height:auto}article{padding:16px 0;border-bottom:1px solid ${light['border/default']}}h2{margin-top:28px}.source,.date{font-size:12px;color:${light['text/soft']}}`;
  const web = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.configName)}</title><style>${base}main{max-width:680px;margin:auto;padding:36px}.layout-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.layout-grid article{border:1px solid ${light['border/default']};border-radius:12px;padding:18px}.layout-headlines article>p,.layout-headlines img{display:none}.layout-lead article[data-first] h3{font-size:30px}</style></head><body><main>${content}</main></body></html>`;
  const email = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.configName)}</title><style>${base}@media(prefers-color-scheme:dark){body,td{background:${dark['bg/surface']}!important;color:${dark['text/primary']}!important}a{color:${dark['text/primary']}!important}}</style></head><body><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="600" style="max-width:100%;background:${light['bg/surface']}" cellpadding="0" cellspacing="0"><tr><td style="padding:36px;font:15px/1.5 Arial,sans-serif;color:${light['text/primary']}"><p style="font-size:12px">${escapeHtml(date)} · No. ${snapshot.issueNumber}</p><h1 style="font:30px/36px Georgia,serif">${escapeHtml(snapshot.configName)}</h1>${snapshot.sections.map((section) => sectionHtml(section, true)).join('')}</td></tr></table></td></tr></table></body></html>`;
  const feed = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>urn:brew:${snapshot.brewConfigId}</id><title>${escapeHtml(snapshot.configName)}</title><updated>${snapshot.generatedAt}</updated><entry><id>urn:brew:${snapshot.brewConfigId}:${snapshot.issueNumber}</id><title>${escapeHtml(snapshot.configName)} · ${snapshot.issueNumber}</title><updated>${snapshot.generatedAt}</updated><content type="html">${escapeHtml(content)}</content></entry></feed>`;
  return { web, email, feed };
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
