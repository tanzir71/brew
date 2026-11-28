import type { ApiServices } from '../../api/src/ports.js';
import {
  navigationQueries,
  readerNavigation,
  readerArticlesQuery,
  readerPage,
  type ReaderArticleQuery,
  type ArticleSummaryRow,
  type NavigationFeedRow,
  type NavigationFolderRow,
} from './reader-queries.js';
import type { AsyncSqlStorage } from './async-storage.js';

type ReaderPort = ApiServices['reader'];
export class SqlReader<Statement> implements ReaderPort {
  constructor(
    private storage: AsyncSqlStorage<Statement>,
    private now: () => Date = () => new Date(),
  ) {}
  async navigation() {
    const result = await this.storage.batch(
      navigationQueries(this.now().getTime()).map(({ sql, values }) =>
        this.storage.statement(sql, values),
      ),
    );
    return readerNavigation(
      result.slice(0, 3).map((row) => Number(row.results[0]!.count)),
      result[3]!.results as NavigationFeedRow[],
      result[4]!.results as NavigationFolderRow[],
    );
  }
  async articles(query: ReaderArticleQuery) {
    const plan = readerArticlesQuery(query, this.now().getTime());
    const statements = [
      ...(query.includeTotal ? [this.storage.statement(plan.count.sql, plan.count.values)] : []),
      this.storage.statement(plan.page.sql, plan.page.values),
    ];
    const result = await this.storage.batch(statements);
    const total = query.includeTotal ? Number(result[0]!.results[0]!.count) : undefined;
    return readerPage(result.at(-1)!.results as ArticleSummaryRow[], plan.limit, total);
  }
}
