import { expect, it } from 'vitest';
import { createApp } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { articles, feeds, ruleLogs, rules } from './src/db/schema.js';
import { BrewService } from './src/services/brew-service.js';

it('loads live read/star/rule state for issue members without changing frozen content', async () => {
  const database = openDatabase(':memory:');
  const feed = database.db
    .insert(feeds)
    .values({ url: 'https://example.test/feed', title: 'Notes' })
    .returning()
    .get();
  const article = database.db
    .insert(articles)
    .values({
      feedId: feed.id,
      guid: 'one',
      url: 'https://example.test/one',
      title: 'Frozen title',
      publishedAt: new Date(),
      hash: 'one',
    })
    .returning()
    .get();
  const service = new BrewService(database);
  const config = service.create({
    name: 'Morning',
    scheduleCron: '0 7 * * *',
    enabled: true,
    sections: [
      {
        id: 'lead',
        title: 'Design',
        source: 'today',
        maxItems: 5,
        layout: 'lead',
        sort: 'newest',
        onlyUnread: false,
      },
      {
        id: 'grid',
        title: 'Grid',
        source: 'today',
        maxItems: 5,
        layout: 'grid',
        sort: 'newest',
        onlyUnread: false,
      },
    ],
  });
  const issue = service.generate(config.id);
  const original = JSON.stringify(service.snapshot(issue.id));
  const rule = database.db
    .insert(rules)
    .values({
      name: 'Design notes',
      matchType: 'all',
      scopeJson: '{}',
      conditionsJson: '[]',
      actionsJson: '[]',
    })
    .returning()
    .get();
  database.db
    .insert(ruleLogs)
    .values([
      {
        articleId: article.id,
        ruleId: rule.id,
        actionsTakenJson: '[{"type":"highlight","ok":true}]',
      },
      {
        articleId: article.id,
        ruleId: rule.id,
        actionsTakenJson: '[{"type":"highlight","ok":true}]',
      },
    ])
    .run();
  database.sqlite
    .prepare('UPDATE articles SET title=?, read_at=?, starred_at=?, highlight_color=? WHERE id=?')
    .run('Changed title', 1_000, 2_000, '#6e9278', article.id);
  const app = await createApp({ database });
  try {
    const response = await app.inject(`/api/brews/${issue.id}/state`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const state = response.json();
    expect(state.articles).toEqual([
      {
        id: article.id,
        feedId: feed.id,
        available: true,
        readAt: new Date(1_000).toISOString(),
        starredAt: new Date(2_000).toISOString(),
        highlightColor: '#6e9278',
        rules: [{ id: rule.id, name: rule.name }],
      },
    ]);
    expect(new Date(state.nextAt).getTime()).toBeGreaterThan(Date.now());
    expect(state.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(JSON.stringify(service.snapshot(issue.id))).toBe(original);
    database.sqlite.prepare('DELETE FROM articles WHERE id=?').run(article.id);
    expect((await app.inject(`/api/brews/${issue.id}/state`)).json().articles).toEqual([
      {
        id: article.id,
        feedId: null,
        available: false,
        readAt: null,
        starredAt: null,
        highlightColor: null,
        rules: [],
      },
    ]);
    expect((await app.inject('/api/brews/999/state')).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
