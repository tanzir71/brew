import { brewIssuePath } from './brew-output-paths.js';
import { outputColors } from './output-colors.generated.js';
import {
  cleanOutputText as cleanText,
  escapeOutputHtml as escapeHtml,
  escapeMarkdown,
  outputBaseUrl,
  outputBodyText,
  outputHtml,
  outputImage,
  outputUrl,
} from './brew-output-content.js';
import { emailDocument } from './brew-output-email.js';
import type { BrewSnapshot } from './types/composition.js';
import type {
  BrewFeedInfo,
  BrewIssueDocument,
  BrewOutputOptions,
  BrewOutputs,
} from './types/outputs.js';

const briefWarning = 'Brief needs a configured AI provider. Source articles:';
const emptySection = 'No matching stories for this issue.';
const dateLabel = (issue: BrewIssueDocument) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeZone: issue.timezone,
  }).format(new Date(issue.generatedAt));
const date = (value: string) => new Date(value).toISOString();

function documentFor(
  snapshot: BrewSnapshot,
  options: BrewOutputOptions,
  local: boolean,
): BrewIssueDocument {
  const baseUrl = outputBaseUrl(options.baseUrl);
  return {
    version: 2,
    id: snapshot.id,
    brewConfigId: snapshot.brewConfigId,
    issueNumber: snapshot.issueNumber,
    configName: cleanText(snapshot.configName),
    generatedAt: date(snapshot.generatedAt),
    timezone: snapshot.timezone,
    sections: snapshot.sections.map((section) => {
      const htmlOptions = { baseUrl, local, images: section.images };
      const showBody = section.depth !== 'title' && section.depth !== 'brief';
      return {
        id: cleanText(section.id),
        kind: section.kind,
        title: cleanText(section.title),
        layout: section.layout,
        depth: section.depth,
        images: section.images,
        ...(section.kind === 'note' ? { noteHtml: outputHtml(section.noteHtml, htmlOptions) } : {}),
        items:
          section.kind !== 'items'
            ? []
            : section.items.map((item) => ({
                id: item.id,
                title: cleanText(item.title),
                url: outputUrl(item.url, baseUrl, local),
                author: item.author === null ? null : cleanText(item.author),
                publishedAt: date(item.publishedAt),
                feedTitle: cleanText(item.feedTitle),
                readTimeMinutes: item.readTimeMinutes,
                imageUrl:
                  section.images && item.imageUrl
                    ? outputImage(item.imageUrl, baseUrl, local)
                    : null,
                summaryHtml: showBody ? outputHtml(item.summaryHtml, htmlOptions) || null : null,
                ...(section.depth === 'full'
                  ? { contentHtml: outputHtml(item.contentHtml, htmlOptions) || null }
                  : {}),
              })),
      };
    }),
  };
}

function fragment(issue: BrewIssueDocument): string {
  const sections = issue.sections
    .map((section) => {
      const title = `<h2>${escapeHtml(section.title)}</h2>`;
      if (section.kind === 'divider') return `<hr>${title}`;
      if (section.kind === 'note') return `<section>${title}${section.noteHtml ?? ''}</section>`;
      const stories = section.items
        .map((item, index) => {
          const picture = item.imageUrl
            ? `<img alt="" src="${escapeHtml(item.imageUrl)}" loading="lazy">`
            : '';
          const title = item.url
            ? `<a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>`
            : escapeHtml(item.title);
          const body =
            section.depth === 'full' ? (item.contentHtml ?? item.summaryHtml) : item.summaryHtml;
          return `<article data-layout="${section.layout}"${index === 0 ? ' data-first="true"' : ''}>${picture}<p class="source">${escapeHtml(item.feedTitle)} · ${item.readTimeMinutes} min</p><h3>${title}</h3>${body ?? ''}</article>`;
        })
        .join('');
      return `<section>${title}${section.depth === 'brief' ? `<p>${briefWarning}</p>` : ''}<div class="layout-${section.layout}">${stories || `<p>${emptySection}</p>`}</div></section>`;
    })
    .join('');
  return `<p class="date">${escapeHtml(dateLabel(issue))} · No. ${issue.issueNumber}</p><h1>${escapeHtml(issue.configName)}</h1>${sections}`;
}

function webDocument(issue: BrewIssueDocument): string {
  const { light, dark } = outputColors;
  const theme = (palette: typeof light | typeof dark) =>
    `--ink:${palette['text/primary']};--surface:${palette['bg/surface']};--soft:${palette['text/soft']};--border:${palette['border/default']}`;
  const style = `:root{color-scheme:light dark;${theme(light)}}@media(prefers-color-scheme:dark){:root{${theme(dark)}}}*{box-sizing:border-box;font-style:normal!important}body{margin:0;color:var(--ink);background:var(--surface);font:15px/1.6 Arial,sans-serif}main{max-width:752px;margin:auto;padding:36px}h1,h2,h3{font-family:Georgia,serif;font-weight:500;line-height:1.2}h1{font-size:44px}h2{margin-top:28px}a{color:inherit;overflow-wrap:anywhere}img{display:block;max-width:100%;height:auto}article{min-width:0;padding:16px 0;border-bottom:1px solid var(--border)}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{max-width:100%;table-layout:fixed;overflow-wrap:anywhere}.source,.date{font-size:12px;color:var(--soft)}.layout-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.layout-grid article{border:1px solid var(--border);border-radius:12px;padding:18px}.layout-magazine article{display:flow-root}.layout-magazine article>img{float:right;width:120px;margin:0 0 12px 20px}.layout-headlines article>p,.layout-headlines img{display:none}.layout-headlines article{padding:12px 0}.layout-lead article[data-first] h3{font-size:30px}@media(max-width:520px){main{padding:20px}.layout-grid{grid-template-columns:1fr}h1{font-size:36px}}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(issue.configName)} · No. ${issue.issueNumber}</title><style>${style}</style></head><body><main>${fragment(issue)}</main></body></html>`;
}

function textDocument(issue: BrewIssueDocument, markdown: boolean): string {
  const title = (value: string, level: number) =>
    (markdown ? '#'.repeat(level) + ' ' : '') +
    (markdown ? escapeMarkdown(value) : value.replace(/\s+/g, ' '));
  const parts = [title(issue.configName, 1), `${dateLabel(issue)} · No. ${issue.issueNumber}`];
  for (const section of issue.sections) {
    if (section.kind === 'divider') parts.push('---');
    parts.push(title(section.title, 2));
    if (section.kind === 'note') parts.push(outputBodyText(section.noteHtml ?? '', markdown));
    if (section.kind !== 'items') continue;
    if (section.depth === 'brief') parts.push(briefWarning);
    for (const item of section.items) {
      const label = markdown ? escapeMarkdown(item.title) : item.title.replace(/\s+/g, ' ');
      parts.push(
        markdown
          ? `### ${item.url ? `[${label}](<${item.url}>)` : label}`
          : `${label}${item.url ? `\n${item.url}` : ''}`,
      );
      parts.push(
        `${markdown ? escapeMarkdown(item.feedTitle) : item.feedTitle} · ${item.readTimeMinutes} min`,
      );
      if (markdown && item.imageUrl) parts.push(`![](<${item.imageUrl}>)`);
      parts.push(
        outputBodyText(
          section.depth === 'full'
            ? (item.contentHtml ?? item.summaryHtml ?? '')
            : (item.summaryHtml ?? ''),
          markdown,
        ),
      );
    }
    if (!section.items.length) parts.push(emptySection);
  }
  return parts.filter(Boolean).join('\n\n') + '\n';
}

export const renderBrewWeb = (snapshot: BrewSnapshot, options: BrewOutputOptions = {}): string =>
  webDocument(documentFor(snapshot, options, true));
export const renderBrewEmail = (
  snapshot: BrewSnapshot,
  options: BrewOutputOptions = {},
): { html: string; text: string } => {
  // Without an origin this is an in-app preview. Delivery adapters supply baseUrl.
  const issue = documentFor(snapshot, options, true);
  return { html: emailDocument(issue, dateLabel(issue)), text: textDocument(issue, false) };
};
export const renderBrewMarkdown = (
  snapshot: BrewSnapshot,
  options: BrewOutputOptions = {},
): string => textDocument(documentFor(snapshot, options, true), true);
export const renderBrewJson = (snapshot: BrewSnapshot, options: BrewOutputOptions = {}): string =>
  JSON.stringify(documentFor(snapshot, options, true), null, 2) + '\n';

function feedDocuments(
  info: BrewFeedInfo,
  snapshots: readonly BrewSnapshot[],
  options: BrewOutputOptions,
) {
  const seen = new Set<number>();
  for (const issue of snapshots) {
    if (issue.brewConfigId !== info.id || seen.has(issue.id || issue.issueNumber))
      throw new Error('A Brew feed needs distinct issues from the same Brew.');
    seen.add(issue.id || issue.issueNumber);
  }
  return snapshots
    .map((issue) => documentFor(issue, options, false))
    .sort(
      (a, b) =>
        b.generatedAt.localeCompare(a.generatedAt) ||
        (b.id || b.issueNumber) - (a.id || a.issueNumber),
    );
}

const feedId = (configId: number, baseUrl?: string) =>
  baseUrl ? `${baseUrl}/b/${configId}` : `urn:brew:${configId}`;
const issueId = (issue: BrewIssueDocument, baseUrl?: string) =>
  baseUrl
    ? `${baseUrl}${brewIssuePath({ ...issue, id: issue.id || issue.issueNumber })}`
    : `${feedId(issue.brewConfigId)}:${issue.id || issue.issueNumber}`;
const issueTitle = (issue: BrewIssueDocument) => `${issue.configName} · No. ${issue.issueNumber}`;
const issueUrl = (issue: BrewIssueDocument, baseUrl?: string) =>
  baseUrl
    ? `${baseUrl}${brewIssuePath({ ...issue, id: issue.id || issue.issueNumber })}`
    : undefined;

function atomDocument(info: BrewFeedInfo, issues: BrewIssueDocument[], baseUrl?: string): string {
  const updated = [date(info.updatedAt), ...issues.map((issue) => issue.generatedAt)]
    .sort()
    .at(-1)!;
  const links = baseUrl
    ? `<link rel="self" type="application/atom+xml" href="${escapeHtml(`${baseUrl}/b/${info.id}.atom`)}"/><link rel="alternate" type="text/html" href="${escapeHtml(`${baseUrl}/b/${info.id}`)}"/>`
    : '';
  const entries = issues
    .map(
      (issue) =>
        `<entry><id>${escapeHtml(issueId(issue, baseUrl))}</id><title>${escapeHtml(issueTitle(issue))}</title><published>${issue.generatedAt}</published><updated>${issue.generatedAt}</updated>${baseUrl ? `<link rel="alternate" type="text/html" href="${escapeHtml(issueUrl(issue, baseUrl)!)}"/>` : ''}<content type="html">${escapeHtml(fragment(issue))}</content></entry>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${escapeHtml(feedId(info.id, baseUrl))}</id><title>${escapeHtml(info.name)}</title><updated>${updated}</updated><author><name>${escapeHtml(info.name)}</name></author>${links}${entries}</feed>`;
}

function jsonFeedDocument(
  info: BrewFeedInfo,
  issues: BrewIssueDocument[],
  baseUrl?: string,
): string {
  return (
    JSON.stringify(
      {
        version: 'https://jsonfeed.org/version/1.1',
        title: cleanText(info.name),
        language: 'en',
        ...(baseUrl
          ? { home_page_url: `${baseUrl}/b/${info.id}`, feed_url: `${baseUrl}/b/${info.id}.json` }
          : {}),
        authors: [{ name: cleanText(info.name) }],
        items: issues.map((issue) => ({
          id: issueId(issue, baseUrl),
          ...(baseUrl ? { url: issueUrl(issue, baseUrl) } : {}),
          title: issueTitle(issue),
          date_published: issue.generatedAt,
          date_modified: issue.generatedAt,
          content_html: fragment(issue),
          content_text: textDocument(issue, false),
        })),
      },
      null,
      2,
    ) + '\n'
  );
}

export const renderBrewAtom = (
  info: BrewFeedInfo,
  snapshots: readonly BrewSnapshot[],
  options: BrewOutputOptions = {},
): string =>
  atomDocument(info, feedDocuments(info, snapshots, options), outputBaseUrl(options.baseUrl));
export const renderBrewJsonFeed = (
  info: BrewFeedInfo,
  snapshots: readonly BrewSnapshot[],
  options: BrewOutputOptions = {},
): string =>
  jsonFeedDocument(info, feedDocuments(info, snapshots, options), outputBaseUrl(options.baseUrl));

/** Compose and target adapters use the same frozen-content renderers. No I/O or clock reads. */
export function renderBrewOutputs(
  snapshot: BrewSnapshot,
  options: BrewOutputOptions = {},
): BrewOutputs {
  const local = documentFor(snapshot, options, true);
  const external = documentFor(snapshot, options, false);
  const info = {
    id: snapshot.brewConfigId,
    name: snapshot.configName,
    updatedAt: snapshot.generatedAt,
  };
  const baseUrl = outputBaseUrl(options.baseUrl);
  return {
    web: webDocument(local),
    email: emailDocument(local, dateLabel(local)),
    text: textDocument(local, false),
    markdown: textDocument(local, true),
    json: JSON.stringify(local, null, 2) + '\n',
    feed: atomDocument(info, [external], baseUrl),
    jsonFeed: jsonFeedDocument(info, [external], baseUrl),
  };
}
