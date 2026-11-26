import { RulesService } from '../../targets/node/src/services/rules-service';
import { articles, ruleLogs } from '../../targets/node/src/db/schema';
import { newsletterNow, type newslettersFixture } from './newsletters-fixture';

export function seedRuleHistory(f: Awaited<ReturnType<typeof newslettersFixture>>, count = 126) {
  const service = new RulesService(f.database);
  const rule = service.create({
    name: 'History rule',
    enabled: false,
    matchType: 'all',
    scope: {},
    conditions: [{ field: 'title', operator: 'contains', value: 'Unmatched preview' }],
    actions: [{ type: 'star' }],
    stopProcessing: false,
  });
  f.database.sqlite.transaction(() => {
    for (let i = 1; i <= count; i++) {
      const article = f.database.db
        .insert(articles)
        .values({
          feedId: 1,
          guid: `history-${i}`,
          hash: `history-${i}`,
          title: `Execution ${String(i).padStart(3, '0')}`,
          url: `https://history.test/${i}`,
          publishedAt: newsletterNow,
        })
        .returning()
        .get();
      f.database.db
        .insert(ruleLogs)
        .values({
          ruleId: rule.id,
          articleId: article.id,
          executedAt: newsletterNow,
          actionsTakenJson: '[{"type":"star","ok":true}]',
        })
        .run();
    }
  })();
  return { service, rule };
}
