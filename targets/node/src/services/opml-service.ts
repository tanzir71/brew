import { asc, eq } from 'drizzle-orm';
import { DOMParser } from 'linkedom';
import type { BrewDatabase } from '../db/database.js';
import { feeds, folders } from '../db/schema.js';
import {
  opmlDocument,
  type OpmlImportResult,
  type OpmlPreview,
} from '../../../../packages/core/src/opml.js';
export type { OpmlImportResult } from '../../../../packages/core/src/opml.js';

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

interface ImportedOutline {
  title: string;
  url: string;
  siteUrl: string | null;
  folderTitle: string | null;
  position: number;
}

function readOutlines(xml: string): ImportedOutline[] {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
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

export class OpmlService {
  constructor(private readonly database: BrewDatabase) {}

  preview(xml: string): OpmlPreview {
    const outlines = readOutlines(opmlDocument(xml));
    const existing = new Set(
      this.database.db
        .select({ url: feeds.url })
        .from(feeds)
        .all()
        .map((feed) => feed.url),
    );
    const seen = new Set<string>();
    const folderNames = new Set(
      this.database.db
        .select({ title: folders.title })
        .from(folders)
        .all()
        .map((folder) => folder.title),
    );
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

  import(xml: string): OpmlImportResult {
    const outlines = readOutlines(xml);
    return this.database.sqlite.transaction(() => {
      let imported = 0;
      let skipped = 0;
      let foldersCreated = 0;
      const folderIds = new Map(
        this.database.db
          .select()
          .from(folders)
          .all()
          .map((folder) => [folder.title, folder.id]),
      );
      for (const outline of outlines) {
        if (
          this.database.db
            .select({ id: feeds.id })
            .from(feeds)
            .where(eq(feeds.url, outline.url))
            .get()
        ) {
          skipped++;
          continue;
        }
        let folderId: number | null = null;
        if (outline.folderTitle) {
          folderId = folderIds.get(outline.folderTitle) ?? null;
          if (folderId === null) {
            const folder = this.database.db
              .insert(folders)
              .values({ title: outline.folderTitle, position: folderIds.size })
              .returning()
              .get();
            folderId = folder.id;
            folderIds.set(folder.title, folder.id);
            foldersCreated++;
          }
        }
        this.database.db
          .insert(feeds)
          .values({ folderId, url: outline.url, siteUrl: outline.siteUrl, title: outline.title })
          .run();
        imported++;
      }
      return { imported, skipped, foldersCreated };
    })();
  }

  export(): string {
    const allFolders = this.database.db
      .select()
      .from(folders)
      .orderBy(asc(folders.position), asc(folders.title))
      .all();
    const allFeeds = this.database.db.select().from(feeds).orderBy(asc(feeds.title)).all();
    const renderFeed = (feed: (typeof allFeeds)[number], indent: string) =>
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
}
