import { expect, it } from 'vitest';
import { openDatabase } from './src/db/database.js';
import { RulesService } from './src/services/rules-service.js';

function fixture(titles: string[]) {
  const database = openDatabase(':memory:');
  database.sqlite.exec(
    "INSERT INTO feeds(id,title,url) VALUES(1,'Source','https://example.test/rss')",
  );
  const insert = database.sqlite.prepare(
    'INSERT INTO articles(id,feed_id,guid,hash,url,title,published_at) VALUES(?,1,?,?,?,?,?)',
  );
  const at = Date.now();
  titles.forEach((title, index) =>
    insert.run(
      index + 1,
      `g-${index}`,
      `h-${index}`,
      `https://example.test/${index}`,
      title,
      at - index,
    ),
  );
  return { database, service: new RulesService(database) };
}
it('keeps valid neighbours when an actual regex batch times out and preserves all/any semantics', async () => {
  const { database, service } = fixture(['ok', 'a'.repeat(100000) + '!', 'ok']);
  const draft = {
    scope: {},
    matchType: 'all' as const,
    conditions: [
      { field: 'title' as const, operator: 'matches_regex' as const, value: '^(?:ok|(?:a+)+)$' },
    ],
  };
  try {
    const before = database.sqlite.prepare('SELECT total_changes() AS n').get();
    expect((await service.previewSummary(draft)).items.map((item) => item.id)).toEqual([1, 3]);
    expect(
      (
        await service.previewSummary({
          ...draft,
          matchType: 'any',
          conditions: [...draft.conditions, { field: 'feed', operator: 'equals', value: 'Source' }],
        })
      ).total,
    ).toBe(3);
    expect(database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
  } finally {
    database.close();
  }
});
it('preserves the first 50 matches, complete totals, visibility and scope with real batched Node regex', async () => {
  const { database, service } = fixture(
    Array.from({ length: 125 }, (_, index) => `Story ${index + 1}`),
  );
  database.sqlite.exec('UPDATE articles SET hidden=1 WHERE id=1');
  const draft = {
    scope: { feedIds: [1] },
    matchType: 'all' as const,
    conditions: [
      { field: 'title' as const, operator: 'matches_regex' as const, value: '(?<=Story )\\d+$' },
    ],
  };
  try {
    const summary = await service.previewSummary(draft);
    expect(summary.total).toBe(124);
    expect(summary.items).toHaveLength(50);
    expect(summary.items.map((item) => item.id)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 2),
    );
    expect(await service.preview(draft)).toEqual(summary.items);
    expect(await service.previewSummary({ ...draft, scope: { feedIds: [999] } })).toEqual({
      items: [],
      total: 0,
      limit: 50,
    });
  } finally {
    database.close();
  }
});
