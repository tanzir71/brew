import { DOMParser } from 'linkedom';
export const opmlDocumentLimit = 1_000_000;
export interface OpmlImportResult {
  imported: number;
  skipped: number;
  foldersCreated: number;
}
export interface OpmlPreview extends OpmlImportResult {
  outlines: Array<{
    title: string;
    source: string;
    folder: string | null;
    status: 'add' | 'subscribed' | 'duplicate';
  }>;
}
export function opmlDocument(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('OPML document is required.');
  if (new TextEncoder().encode(value).byteLength > opmlDocumentLimit)
    throw new Error('Choose an OPML file smaller than 1 MB.');
  return value;
}

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
const outlineTitle = (element: Element): string =>
  element.getAttribute('title')?.trim() || element.getAttribute('text')?.trim() || '';
const normalizeFeedUrl = (value: string): string => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('OPML contains an unsupported feed URL');
  url.hash = '';
  return url.toString();
};

export interface ImportedOutline {
  title: string;
  url: string;
  siteUrl: string | null;
  folderTitle: string | null;
  position: number;
}

export function readOpmlOutlines(xml: string): ImportedOutline[] {
  const document = new DOMParser().parseFromString(opmlDocument(xml), 'text/xml');
  if (!document?.querySelector('opml > body')) throw new Error('Invalid OPML document');
  const output: ImportedOutline[] = [];
  let position = 0;
  const visit = (element: Element, parents: string[]) => {
    const xmlUrl = element.getAttribute('xmlUrl') ?? element.getAttribute('xmlurl');
    const title = outlineTitle(element);
    if (xmlUrl) {
      output.push({
        title: title || xmlUrl,
        url: normalizeFeedUrl(xmlUrl),
        siteUrl: element.getAttribute('htmlUrl') ?? element.getAttribute('htmlurl'),
        folderTitle: parents.length ? parents.join(' / ') : null,
        position: position++,
      });
      return;
    }
    const nextParents = title ? [...parents, title] : parents;
    for (const child of element.children)
      if (child.localName.toLowerCase() === 'outline') visit(child, nextParents);
  };
  const body = document.querySelector('opml > body')!;
  for (const child of body.children)
    if (child.localName.toLowerCase() === 'outline') visit(child, []);
  return output;
}

export function previewOpml(
  outlines: ImportedOutline[],
  existing: Set<string>,
  folderNames: Set<string>,
): OpmlPreview {
  const seen = new Set<string>();
  let imported = 0;
  let skipped = 0;
  let foldersCreated = 0;
  return {
    outlines: outlines.map((outline) => {
      const status = existing.has(outline.url)
        ? 'subscribed'
        : seen.has(outline.url)
          ? 'duplicate'
          : 'add';
      seen.add(outline.url);
      if (status === 'add') {
        imported++;
        if (outline.folderTitle && !folderNames.has(outline.folderTitle)) {
          folderNames.add(outline.folderTitle);
          foldersCreated++;
        }
      } else skipped++;
      const url = new URL(outline.url);
      let title = outline.title;
      try {
        if (normalizeFeedUrl(title) === outline.url) title = url.hostname;
      } catch {
        /* Authored titles stay as content. */
      }
      return {
        title,
        source: `${url.origin}${url.pathname}`,
        folder: outline.folderTitle,
        status,
      };
    }),
    imported,
    skipped,
    foldersCreated,
  };
}
export interface OpmlFeed {
  title: string;
  url: string;
  siteUrl: string | null;
  folderId: number | null;
}
export interface OpmlFolder {
  id: number;
  title: string;
}
export function exportOpml(allFolders: OpmlFolder[], allFeeds: OpmlFeed[]): string {
  const renderFeed = (feed: OpmlFeed, indent: string) =>
    `${indent}<outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.url)}"${feed.siteUrl ? ` htmlUrl="${escapeXml(feed.siteUrl)}"` : ''}/>`;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head><title>Brew subscriptions</title></head>',
    '  <body>',
  ];
  for (const feed of allFeeds.filter((feed) => feed.folderId === null))
    lines.push(renderFeed(feed, '    '));
  for (const folder of allFolders) {
    lines.push(
      `    <outline text="${escapeXml(folder.title)}" title="${escapeXml(folder.title)}">`,
    );
    for (const feed of allFeeds.filter((feed) => feed.folderId === folder.id))
      lines.push(renderFeed(feed, '      '));
    lines.push('    </outline>');
  }
  lines.push('  </body>', '</opml>');
  return `${lines.join('\n')}\n`;
}
