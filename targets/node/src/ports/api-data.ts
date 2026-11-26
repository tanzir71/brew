import type { ApiDataPort } from '../../../../packages/api/src/ports.js';
import type { BrewDatabase } from '../db/database.js';
import type { HiddenArticlePage } from '../../../../packages/core/src/types/api.js';
import { hiddenArticlePageSize } from '../../../../packages/core/src/app-pages.js';

export class NodeApiData implements ApiDataPort {
  constructor(private readonly database: BrewDatabase) {}
  hiddenArticles(): Array<{ id: number; title: string; feedTitle: string; publishedAt: number }> {
    return this.database.sqlite
      .prepare(
        'SELECT a.id,a.title,f.title AS feedTitle,a.published_at AS publishedAt FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE a.hidden=1 ORDER BY a.published_at DESC LIMIT 500',
      )
      .all() as ReturnType<NodeApiData['hiddenArticles']>;
  }
  hiddenArticlePage(page: number): HiddenArticlePage {
    return this.database.sqlite.transaction(() => {
      const total = (
        this.database.sqlite
          .prepare(
            'SELECT count(*) AS n FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE a.hidden=1',
          )
          .get() as { n: number }
      ).n;
      const items = this.database.sqlite
        .prepare(
          'SELECT a.id,a.title,f.title AS feedTitle,a.published_at AS publishedAt FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE a.hidden=1 ORDER BY a.published_at DESC,a.id DESC LIMIT ? OFFSET ?',
        )
        .all(
          hiddenArticlePageSize,
          (page - 1) * hiddenArticlePageSize,
        ) as HiddenArticlePage['items'];
      return { items, total, page, pageSize: hiddenArticlePageSize };
    })();
  }
  unhideArticle(id: number): boolean {
    return (
      this.database.sqlite.prepare('UPDATE articles SET hidden=0 WHERE id=?').run(id).changes > 0
    );
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
  setDuplicateFilter(enabled: boolean): void {
    this.database.sqlite
      .prepare(
        "INSERT INTO settings(key, value) VALUES('duplicate_filter_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(enabled));
  }
}
