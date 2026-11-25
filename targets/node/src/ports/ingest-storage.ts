import { and, eq, or } from 'drizzle-orm';
import type { IngestStoragePort, IngestCandidate } from '../../../../packages/core/src/ports.js';
import type { BrewDatabase } from '../db/database.js';
import { articles } from '../db/schema.js';

export class NodeIngestStorage implements IngestStoragePort {
  constructor(private readonly database: BrewDatabase) {}
  insertBatch(items: IngestCandidate[]): number[] {
    return this.database.sqlite.transaction(() => {
      const ids: number[] = [];
      for (const item of items) {
        const duplicate = this.database.db
          .select({ id: articles.id })
          .from(articles)
          .where(
            and(
              eq(articles.feedId, item.feedId),
              or(eq(articles.guid, item.guid), eq(articles.hash, item.hash)),
            ),
          )
          .get();
        if (duplicate) continue;
        ids.push(
          this.database.db
            .insert(articles)
            .values(item.prepare())
            .returning({ id: articles.id })
            .get().id,
        );
      }
      return ids;
    })();
  }
  duplicateFilterEnabled(): boolean {
    return (
      (
        this.database.sqlite
          .prepare("SELECT value FROM settings WHERE key = 'duplicate_filter_enabled'")
          .get() as { value: string } | undefined
      )?.value === 'true'
    );
  }
  title(id: number): string {
    return this.database.db
      .select({ title: articles.title })
      .from(articles)
      .where(eq(articles.id, id))
      .get()!.title;
  }
  recentTitles(excludeId: number, since: number): string[] {
    return (
      this.database.sqlite
        .prepare('SELECT title FROM articles WHERE id != ? AND published_at >= ?')
        .all(excludeId, since) as Array<{ title: string }>
    ).map((row) => row.title);
  }
  hide(id: number): void {
    this.database.db.update(articles).set({ hidden: true }).where(eq(articles.id, id)).run();
  }
  prune(feedId: number, before: number): void {
    this.database.sqlite
      .prepare(
        'DELETE FROM articles WHERE feed_id = ? AND published_at < ? AND starred_at IS NULL AND NOT EXISTS (SELECT 1 FROM article_tags WHERE article_id = articles.id)',
      )
      .run(feedId, before);
  }
}
