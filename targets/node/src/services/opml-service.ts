import { asc, eq } from 'drizzle-orm';
import type { BrewDatabase } from '../db/database.js';
import { feeds, folders } from '../db/schema.js';
import {
  readOpmlOutlines,
  previewOpml,
  exportOpml,
  type OpmlImportResult,
  type OpmlPreview,
} from '../../../../packages/core/src/opml.js';
export type { OpmlImportResult } from '../../../../packages/core/src/opml.js';

export class OpmlService {
  constructor(private readonly database: BrewDatabase) {}

  preview(xml: string): OpmlPreview {
    return previewOpml(
      readOpmlOutlines(xml),
      new Set(
        this.database.db
          .select({ url: feeds.url })
          .from(feeds)
          .all()
          .map((feed) => feed.url),
      ),
      new Set(
        this.database.db
          .select({ title: folders.title })
          .from(folders)
          .all()
          .map((folder) => folder.title),
      ),
    );
  }

  import(xml: string): OpmlImportResult {
    const outlines = readOpmlOutlines(xml);
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
    const allFeeds = this.database.db
      .select()
      .from(feeds)
      .where(eq(feeds.kind, 'rss'))
      .orderBy(asc(feeds.title))
      .all();
    return exportOpml(allFolders, allFeeds);
  }
}
