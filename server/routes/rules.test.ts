import { describe, expect, it } from 'vitest';
import type { RuleDraft } from '../../shared/rules.js';
import { createApp } from '../app.js';
import { openDatabase } from '../db/database.js';
import { articles, feeds, folders } from '../db/schema.js';

const draft: RuleDraft = {
  name: 'Design tools',
  enabled: true,
  matchType: 'all',
  scope: {},
  conditions: [{ field: 'title', operator: 'contains', value: 'figma' }],
  actions: [{ type: 'add_tag', tag: 'Tools' }, { type: 'star' }],
  stopProcessing: false,
};

describe('rules CRUD and preview routes', () => {
  it('creates, previews, updates, lists, and deletes a sentence rule', async () => {
    const database = openDatabase(':memory:');
    const folder = database.db.insert(folders).values({ title: 'Design' }).returning().get();
    const feed = database.db
      .insert(feeds)
      .values({ title: 'Design feed', url: 'https://rules.test/feed', folderId: folder.id })
      .returning()
      .get();
    database.db
      .insert(articles)
      .values({
        feedId: feed.id,
        guid: 'match',
        url: 'https://rules.test/figma',
        title: 'Figma releases variables',
        publishedAt: new Date(),
        hash: 'rule-preview-match',
      })
      .run();
    database.db
      .insert(articles)
      .values({
        feedId: feed.id,
        guid: 'miss',
        url: 'https://rules.test/other',
        title: 'Typography notes',
        publishedAt: new Date(Date.now() - 1_000),
        hash: 'rule-preview-miss',
      })
      .run();
    const app = await createApp({ database });
    const created = await app.inject({ method: 'POST', url: '/api/rules', payload: draft });
    expect(created.statusCode).toBe(201);
    const rule = created.json();
    expect(rule).toMatchObject({ name: 'Design tools', position: 0, conditions: draft.conditions });
    const preview = await app.inject({
      method: 'POST',
      url: '/api/rules/preview',
      payload: { scope: {}, matchType: 'all', conditions: draft.conditions },
    });
    expect(preview.json().items).toEqual([
      expect.objectContaining({ title: 'Figma releases variables', feedTitle: 'Design feed' }),
    ]);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/rules/${rule.id}`,
          payload: { ...draft, name: 'Renamed', enabled: false },
        })
      ).json(),
    ).toMatchObject({ name: 'Renamed', enabled: false });
    expect((await app.inject('/api/rules')).json()).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/rules',
          payload: { ...draft, conditions: Array.from({ length: 11 }, () => draft.conditions[0]) },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/rules',
          payload: {
            ...draft,
            conditions: [{ field: 'title', operator: 'matches_regex', value: '[' }],
          },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/rules/${rule.id}` })).statusCode).toBe(
      204,
    );
    await app.close();
  });
});
