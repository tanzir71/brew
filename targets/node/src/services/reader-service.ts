import type { BrewDatabase } from '../db/database.js';
import {
  navigationQueries,
  readerNavigation,
  readerArticlesQuery,
  readerPage,
  type ArticleSummaryRow,
  type NavigationFeedRow,
  type NavigationFolderRow,
  type ReaderArticleQuery,
} from '../../../../packages/db/src/reader-queries.js';
export type ReaderView = ReaderArticleQuery['view'];
export type ArticleQuery = ReaderArticleQuery;
export class ReaderService {
  constructor(
    private readonly database: BrewDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}
  navigation() {
    const rows = navigationQueries(this.now().getTime()).map(({ sql, values }) =>
      this.database.sqlite.prepare(sql).all(...values),
    );
    return readerNavigation(
      rows.slice(0, 3).map((result) => (result[0] as { count: number }).count),
      rows[3] as NavigationFeedRow[],
      rows[4] as NavigationFolderRow[],
    );
  }
  articles(query: ArticleQuery) {
    const plan = readerArticlesQuery(query, this.now().getTime());
    const total = query.includeTotal
      ? (
          this.database.sqlite.prepare(plan.count.sql).get(...plan.count.values) as {
            count: number;
          }
        ).count
      : undefined;
    return readerPage(
      this.database.sqlite.prepare(plan.page.sql).all(...plan.page.values) as ArticleSummaryRow[],
      plan.limit,
      total,
    );
  }
}
