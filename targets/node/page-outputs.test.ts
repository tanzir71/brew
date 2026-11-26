import { afterEach, describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { createApp } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { articles, feeds, folders, ruleLogs } from './src/db/schema.js';
import { BrewService } from './src/services/brew-service.js';
import { RulesService } from './src/services/rules-service.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';
import { createApi } from '../../packages/api/src/app.js';
import type { ApiServices } from '../../packages/api/src/ports.js';
import { nodeCapabilities } from './src/capabilities.js';
import {
  newsletterHref,
  newsletterListHref,
  newsletterLocation,
  rulePageLocation,
} from '../../packages/core/src/app-pages.js';

const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
async function setup() {
  const database = openDatabase(':memory:');
  let requests = 0;
  const app = await createApp({
    database,
    publicUrl: 'https://pages.example.test',
    fetcher: async () => {
      requests++;
      throw new Error('Unexpected network request');
    },
  });
  closes.push(() => app.close());
  const folder = database.db.insert(folders).values({ title: 'Design' }).returning().get();
  const feed = database.db
    .insert(feeds)
    .values({
      title: 'Journal',
      url: 'https://private.test/feed?key=private-feed-token',
      folderId: folder.id,
    })
    .returning()
    .get();
  const sender = database.db
    .insert(feeds)
    .values({
      title: 'Letters',
      kind: 'newsletter',
      url: 'mailto:private-address-token@example.test',
      settingsJson: '{"favorite":true}',
    })
    .returning()
    .get();
  const article = database.db
    .insert(articles)
    .values({
      feedId: feed.id,
      guid: 'one',
      hash: 'one',
      title: 'Needle [one]',
      url: 'https://journal.test/one',
      publishedAt: new Date(),
      contentHtml: '<p>Clean content.</p>',
      rawHtml: 'private-original-token',
    })
    .returning()
    .get();
  database.db
    .insert(articles)
    .values({
      feedId: sender.id,
      guid: 'letter',
      hash: 'letter',
      title: 'A private letter',
      url: '/a/2',
      publishedAt: new Date(),
      contentHtml: '<p>Clean letter.</p>',
      rawHtml: 'private-original-token',
      cleaningJson: '{"trackers":1}',
    })
    .run();
  const otherSender = database.db
    .insert(feeds)
    .values({ title: 'Other letters', kind: 'newsletter', url: 'mailto:other@example.test' })
    .returning()
    .get();
  for (let i = 0; i < 2; i++)
    database.db
      .insert(articles)
      .values({
        feedId: otherSender.id,
        guid: `other-${i}`,
        hash: `other-${i}`,
        title: `Other letter ${i}`,
        url: `https://other.test/${i}`,
        publishedAt: new Date(),
      })
      .run();
  database.db
    .insert(articles)
    .values({
      feedId: feed.id,
      guid: 'hidden',
      hash: 'hidden',
      title: 'Hidden story',
      url: 'https://journal.test/hidden',
      hidden: true,
      publishedAt: new Date(),
    })
    .run();
  const service = new RulesService(database);
  const rule = service.create({
    name: 'Check [later]',
    enabled: true,
    scope: { feedIds: [feed.id] },
    matchType: 'all',
    conditions: [{ field: 'title', operator: 'contains', value: 'Needle' }],
    actions: [
      { type: 'webhook', url: 'https://hook.test/private-webhook-token' },
      { type: 'star' },
    ],
    stopProcessing: false,
  });
  database.db
    .insert(ruleLogs)
    .values({
      ruleId: rule.id,
      articleId: article.id,
      actionsTakenJson: '[{"type":"webhook","ok":false,"error":"private-log-error-token"}]',
    })
    .run();
  // Unexpected nested fields can exist in old/imported records; the projection must omit them.
  database.sqlite
    .prepare('UPDATE rules SET scope_json=?,conditions_json=?,actions_json=? WHERE id=?')
    .run(
      JSON.stringify({ feedIds: [feed.id], providerKey: 'private-extra-token' }),
      JSON.stringify([
        {
          field: 'title',
          operator: 'contains',
          value: 'Needle',
          providerKey: 'private-extra-token',
        },
      ]),
      JSON.stringify([
        { type: 'star', providerKey: 'private-extra-token' },
        { type: 'webhook', url: 'https://hook.test/private-webhook-token' },
      ]),
      rule.id,
    );
  const brews = new BrewService(database);
  const config = brews.createComposition({
    name: 'Weekend',
    enabled: true,
    timezone: 'Asia/Dhaka',
    schedule: { kind: 'weekly', days: [6], time: '08:30' },
    delivery: {
      ...defaultDelivery(),
      email: { to: 'private-email-token@example.test' },
      webhook: { url: 'https://hook.test/private-webhook-token' },
    },
    sections: [
      { ...newBrewSection('stories'), title: 'Stories', sources: [{ kind: 'feed', id: feed.id }] },
      {
        ...newBrewSection('note'),
        kind: 'note',
        title: '<script>bad()</script>',
        note: 'A note\n```\n<script>bad()</script>\n*literal*',
      },
    ],
  });
  const get = (url: string, method: 'GET' | 'HEAD' = 'GET') =>
    app.inject({ method, url, headers: { host: 'ignored.example.test' } });
  return { database, app, feed, sender, rule, config, get, requests: () => requests };
}
describe('saved-page Markdown/JSON twins', () => {
  it('round-trips canonical newsletter identities and all-senders context while retaining query and rule aliases', () => {
    const base = 'https://pages.example.test';
    const route = newsletterLocation(
      new URL('/letters/7/42?view=favorites&scope=all&page=2&sort=name', base),
    );
    expect(route).toEqual({
      view: 'favorites',
      senderId: null,
      letterId: 42,
      letterSenderId: 7,
      page: 2,
      sort: 'name',
    });
    expect(newsletterHref(route)).toBe('/letters/7/42?view=favorites&scope=all&page=2&sort=name');
    expect(newsletterListHref(route)).toBe('/letters?view=favorites&page=2&sort=name');
    expect(
      newsletterHref(newsletterLocation(new URL('/letters/7/42?scope=all&agent=1', base))),
    ).toBe('/letters/7/42?scope=all&agent=1');
    const selected = newsletterLocation(new URL('/letters?sender=7&sort=unread', base));
    expect(newsletterHref(selected)).toBe('/letters/7?sort=unread');
    expect(newsletterLocation(new URL('/letters/7', base))).toMatchObject({
      senderId: 7,
      letterId: null,
    });
    expect(rulePageLocation(new URL('/?view=rules&rule=9&tab=log', base))).toEqual({
      id: 9,
      tab: 'log',
    });
    for (const path of [
      '/letters/0',
      '/letters/7/0',
      '/letters/7?scope=all',
      '/letters/7?sender=8',
      '/letters/7/42?scope=nope',
      '/letters?page=0',
    ])
      expect(() => newsletterLocation(new URL(path, base))).toThrow();
    expect(() => rulePageLocation(new URL('/rules?tab=log', base))).toThrow();
  });
  it('exports canonical sender lists with matching filters and canonical letter links', async () => {
    const f = await setup();
    const response = await f.get(`/letters/${f.sender.id}.json?view=favorites&sort=name`);
    expect(response.statusCode, response.body).toBe(200);
    const value = response.json();
    expect(value.state).toEqual({
      view: 'favorites',
      senderId: f.sender.id,
      page: 1,
      sort: 'name',
    });
    expect(value.url).toBe(
      `https://pages.example.test/letters/${f.sender.id}?view=favorites&sort=name`,
    );
    expect(value.sections[1].items[0].url).toBe(
      `https://pages.example.test/letters/${f.sender.id}/2?view=favorites&sort=name`,
    );
    expect(
      (await f.get(`/letters.json?sender=${f.sender.id}&view=favorites&sort=name`)).json(),
    ).toEqual(value);
    expect((await f.get(`/letters/${f.sender.id}.md?view=favorites`)).body).toContain(
      'A private letter',
    );
  });
  it('binds deep letter twins to their actual sender without reads, actions or fallback content', async () => {
    const f = await setup();
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    const path = `/letters/${f.sender.id}/2.json?scope=all`;
    const response = await f.get(path);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      id: 2,
      title: 'A private letter',
      contentHtml: '<p>Clean letter.</p>',
    });
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers.link).toContain('/a/2.md');
    expect(response.body).not.toMatch(/rawHtml|cleaning|private-original|readAt|starredAt/);
    expect((await f.get(path, 'HEAD')).body).toBe('');
    expect((await f.get(path.replace('.json', '.md'))).body).toContain('Clean letter.');
    for (const path of [
      `/letters/${f.sender.id}/3.json`,
      '/letters/999/2.md',
      `/letters/${f.sender.id}/999.json`,
      `/letters/${f.sender.id}/0.json`,
      `/letters/${f.sender.id}/1.json`,
    ])
      expect((await f.get(path)).statusCode, path).toBe(404);
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(f.requests()).toBe(0);
  });
  it('exports every remaining page as private, discoverable, read-only content without executing rules or leaking credentials', async () => {
    const f = await setup();
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    const paths = [
      '/index',
      '/reader',
      '/feeds',
      '/feeds?section=health',
      '/feeds?section=hidden',
      '/settings/runs?setup=agents',
      '/rules',
      `/rules/${f.rule.id}`,
      `/rules/${f.rule.id}?tab=log`,
      '/letters?view=favorites&sort=name',
      `/letters?sender=${f.sender.id}`,
      `/b/${f.config.id}/compose?section=stories&sheet=add-source`,
      `/b/${f.config.id}/read`,
    ];
    for (const path of paths) {
      const [pathname, query] = path.split('?');
      const url = `${pathname}.json${query ? `?${query}` : ''}`;
      const response = await f.get(url);
      expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
      expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['x-robots-tag']).toContain('noindex');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers.link).toContain('.md');
      expect(response.json()).toMatchObject({
        version: 1,
        url: expect.stringContaining('https://pages.example.test'),
        sections: expect.any(Array),
      });
      expect(response.body).not.toMatch(
        /private-(?:feed|webhook|email|original|extra|log-error|address)-token|rawHtml|cleaningJson|providerKey/,
      );
      expect((await f.get(url, 'HEAD')).body).toBe('');
      const markdown = await f.get(url.replace('.json', '.md'));
      expect(markdown.statusCode).toBe(200);
      expect(markdown.headers['content-type']).toBe('text/markdown; charset=utf-8');
      expect(markdown.body).toMatch(/^# /);
      expect(await marked.parse(markdown.body)).not.toContain('<script>');
    }
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(f.database.db.select().from(articles).get()!.starredAt).toBeNull();
    expect(f.requests()).toBe(0);
  });
  it('projects selected saved sections, rule previews/logs and newsletter filter totals accurately', async () => {
    const f = await setup();
    const compose = (
      await f.get(`/b/${f.config.id}/compose.json?section=stories&sheet=schedule`)
    ).json();
    expect(compose.state).toEqual({ brewId: f.config.id, section: 'stories', sheet: 'schedule' });
    expect(compose.sections[0].data).toMatchObject({
      timezone: 'Asia/Dhaka',
      schedule: { kind: 'weekly', time: '08:30' },
      delivery: { email: true, webhook: true },
    });
    expect(compose.sections[1].items).toHaveLength(2);
    const preview = (await f.get(`/rules/${f.rule.id}.json`)).json();
    expect(preview.kind).toBe('rules');
    expect(preview.state).toEqual({ ruleId: f.rule.id, tab: 'preview' });
    expect(preview.sections[1].items.map((item: { title: string }) => item.title)).toEqual([
      'Needle [one]',
    ]);
    const log = (await f.get(`/rules/${f.rule.id}.json?tab=log`)).json();
    expect(log.sections[1].title).toBe('Recent executions');
    expect(log.sections[1].items[0].details.actions).toEqual([{ type: 'webhook', ok: false }]);
    const letters = (
      await f.get(`/letters.json?sender=${f.sender.id}&view=favorites&page=1&sort=unread`)
    ).json();
    expect(letters.state).toEqual({
      senderId: f.sender.id,
      view: 'favorites',
      page: 1,
      sort: 'unread',
    });
    expect(letters.sections[1].data).toMatchObject({ total: 1, from: 1, to: 1, pageSize: 50 });
    expect(letters.sections[0].data.unreadCount).toBe(1);
    expect(letters.sections[1].items[0].title).toBe('A private letter');
    expect((await f.get('/feeds.json?section=hidden')).json().sections[0].items[0].title).toBe(
      'Hidden story',
    );
  });
  it('rejects invalid/missing identities, sections and filters without HTML/latest fallbacks', async () => {
    const f = await setup();
    for (const path of [
      '/rules/0.json',
      '/rules/01.json',
      '/rules/999.json',
      '/b/0/compose.json',
      '/b/999/compose.md',
      `/b/${f.config.id}/compose.json?section=missing`,
      '/letters.json?sender=999',
    ])
      expect((await f.get(path)).statusCode, path).toBe(404);
    for (const path of [
      '/feeds.json?section=nope',
      '/rules.json?tab=log',
      '/rules.json?tab=nope',
      '/letters.json?view=nope',
      '/letters.json?sort=nope',
      '/letters.json?page=0',
      '/settings/runs.json?setup=nope',
      `/b/${f.config.id}/compose.md?sheet=nope`,
    ])
      expect((await f.get(path)).statusCode, path).toBe(400);
  });
  it('gates formats and hides unexpected provider errors with private responses', async () => {
    const unavailable = createApi({
      capabilities: () => ({
        ...nodeCapabilities(),
        outputs: { twins: false, feed: false, webhook: false },
      }),
    } as ApiServices);
    const response = await unavailable.request('/rules.json');
    expect(response.status).toBe(501);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const broken = createApi({
      capabilities: () => {
        throw new Error('private-provider-token');
      },
    } as unknown as ApiServices);
    const failure = await broken.request('/settings/runs.json');
    expect(failure.status).toBe(500);
    expect(await failure.text()).not.toContain('private-provider-token');
    const caps = {
      ...nodeCapabilities(),
      providerKey: 'private-extra-token',
      ai: { ...nodeCapabilities().ai, apiKey: 'private-extra-token' },
    };
    const safe = createApi({ capabilities: () => caps } as ApiServices);
    expect(await (await safe.request('/settings/runs.json')).text()).not.toContain(
      'private-extra-token',
    );
  });
});
