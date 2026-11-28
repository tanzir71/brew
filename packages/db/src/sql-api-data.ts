import type { ApiDataPort } from '../../api/src/ports.js';
import type {
  HiddenArticleItem,
  HiddenArticleSummary,
} from '../../core/src/types/api.js';
import { hiddenArticlePageSize } from '../../core/src/app-pages.js';
import type { AsyncSqlStorage } from './async-storage.js';
import { libraryRevision } from './async-storage.js';

export class SqlApiData<Statement> implements ApiDataPort {
  constructor(private storage: AsyncSqlStorage<Statement>) {}
  async hiddenArticles() {
    return this.storage.all<HiddenArticleSummary>(
      'SELECT a.id,a.title,f.title AS feedTitle,a.published_at AS publishedAt FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE a.hidden=1 ORDER BY a.published_at DESC LIMIT 500',
    );
  }
  async hiddenArticlePage(page: number) {
    const result = await this.storage.batch([
      this.storage.statement(
        'SELECT count(*) AS n FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE a.hidden=1',
      ),
      this.storage.statement(
        "SELECT a.id,a.title,f.title AS feedTitle,a.published_at AS publishedAt,CASE WHEN f.kind='newsletter' THEN 'letter' ELSE 'article' END AS kind,a.read_at AS readAt,a.starred_at AS starredAt,a.highlight_color AS highlightColor FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE a.hidden=1 ORDER BY a.published_at DESC,a.id DESC LIMIT ? OFFSET ?",
        [hiddenArticlePageSize, (page - 1) * hiddenArticlePageSize],
      ),
    ]);
    type Row = Omit<HiddenArticleItem, 'readAt' | 'starredAt'> & {
      readAt: number | null;
      starredAt: number | null;
    };
    return {
      items: (result[1]!.results as Row[]).map((item) => ({
        ...item,
        readAt: item.readAt === null ? null : new Date(item.readAt).toISOString(),
        starredAt: item.starredAt === null ? null : new Date(item.starredAt).toISOString(),
      })),
      total: Number(result[0]!.results[0]!.n),
      page,
      pageSize: hiddenArticlePageSize,
    };
  }
  async unhideArticle(id: number) {
    return (
      Number.isSafeInteger(id) &&
      id > 0 &&
      (
        await this.storage.batch([
          this.storage.statement('UPDATE articles SET hidden=0 WHERE id=?', [id]),
          libraryRevision(this.storage),
        ])
      )[0]!.meta.changes > 0
    );
  }
  async duplicateFilterEnabled() {
    return (
      (
        await this.storage.first<{ value: string }>(
          "SELECT value FROM settings WHERE key='duplicate_filter_enabled'",
        )
      )?.value === 'true'
    );
  }
  async setDuplicateFilter(enabled: boolean) {
    await this.storage.run(
      "INSERT INTO settings(key,value) VALUES('duplicate_filter_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [String(enabled)],
    );
  }
}
