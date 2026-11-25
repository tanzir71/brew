import Database from 'better-sqlite3';
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, migrateDatabase } from './src/db/database.js';
import { articles, feeds, folders } from './src/db/schema.js';
import { NodeBrewStorage } from './src/ports/brew-storage.js';
import { nodeRegex } from './src/ports/runtime.js';
import { BrewService } from '../../packages/core/src/brew-service.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';
import { nextBrewAt } from '../../packages/core/src/brew-schedule.js';
import { createApp } from './src/app.js';
import { safeRegexMany } from './src/services/safe-regex.js';
import type { BrewConfigDraft, BrewPreview } from '../../packages/core/src/types/brew.js';

const now = new Date('2026-11-25T01:00:00Z');
const draft = (): BrewConfigDraft => ({
  name: 'Morning',
  enabled: true,
  timezone: 'Asia/Dhaka',
  schedule: { kind: 'daily', time: '07:00' },
  delivery: defaultDelivery(),
  sections: [{ ...newBrewSection('design'), onlyUnread: false }],
});
const closers: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
function setup() {
  const database = openDatabase(':memory:');
  closers.push(database.close);
  const storage = new NodeBrewStorage(database);
  const service = new BrewService(storage, { now: () => now }, nodeRegex);
  const folder = database.db.insert(folders).values({ title: 'Design' }).returning().get();
  const feed = database.db
    .insert(feeds)
    .values({ title: 'Ideas', url: 'https://example.test/feed', folderId: folder.id })
    .returning()
    .get();
  for (let index = 0; index < 28; index++)
    database.db
      .insert(articles)
      .values({
        feedId: feed.id,
        guid: String(index),
        hash: String(index),
        url: `https://example.test/${index}`,
        title: index < 24 ? 'Other idea' : `Figma ${index}`,
        author: index === 26 ? 'Jo Park' : null,
        summaryHtml: '<p>A &amp; B</p>',
        contentHtml: '<p>A &amp; B</p><img src="https://example.test/large.png" alt="Body art">',
        publishedAt: new Date(now.getTime() - (index + 1) * 60_000),
        imageUrl: 'https://example.test/image.png',
      })
      .run();
  return { database, storage, service, feed, folder };
}
describe('Compose model, storage and previews', () => {
  it('migrates a real v1 database losslessly without changing frozen payloads', () => {
    const sqlite = new Database(':memory:');
    closers.push(() => sqlite.close());
    sqlite.exec(
      'CREATE TABLE __brew_migrations(name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)',
    );
    const directory = new URL('../../packages/db/migrations/', import.meta.url);
    for (const file of fs
      .readdirSync(directory)
      .filter((file) => file.endsWith('.sql') && file < '0006')) {
      sqlite.exec(fs.readFileSync(new URL(file, directory), 'utf8'));
      sqlite.prepare('INSERT INTO __brew_migrations VALUES(?,0)').run(file);
    }
    const original =
      '[ {"id":"a","title":"Design","source":"folder","sourceId":7,"layout":"hero","maxItems":4,"onlyUnread":false,"sort":"longest","divider":"Keep **reading**"}, {"id":"a:note","title":"Links","source":"starred","layout":"list","maxItems":3,"onlyUnread":true,"sort":"newest"} ]';
    const payload = '{ "configName":"Morning", "sections":[] }';
    sqlite
      .prepare('INSERT INTO brew_configs(id,name,schedule_cron,sections_json) VALUES(1,?,?,?)')
      .run('Morning', '15 8 * * 1-5', original);
    sqlite.prepare('INSERT INTO brews(brew_config_id,payload_json) VALUES(1,?)').run(payload);
    migrateDatabase(sqlite);
    migrateDatabase(sqlite);
    const row = sqlite.prepare('SELECT * FROM brew_configs').get() as Record<string, string>;
    expect(row.legacy_sections_json).toBe(original);
    expect(row.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(JSON.parse(row.schedule_json!)).toEqual({ kind: 'weekdays', time: '08:15' });
    const sections = JSON.parse(row.sections_json!);
    expect(sections.map((section: { id: string }) => section.id)).toEqual([
      'a:note:note',
      'a',
      'a:note',
    ]);
    expect(sections[0]).toMatchObject({ kind: 'note', note: 'Keep **reading**' });
    expect(sections[1]).toMatchObject({
      kind: 'items',
      sources: [{ kind: 'folder', id: 7 }],
      layout: 'lead',
      maxItems: 4,
      onlyUnread: false,
      sort: 'longest',
      depth: 'excerpt',
    });
    expect(sections[2]).toMatchObject({
      layout: 'headlines',
      depth: 'title',
      images: false,
      onlyUnread: true,
    });
    expect(sqlite.prepare('SELECT payload_json FROM brews').get()).toEqual({
      payload_json: payload,
    });
  });
  it('unions sources, applies Rules filters before limiting and reports truthful counts without writes', async () => {
    const { database, service, folder, feed } = setup();
    const value = draft();
    value.sections[0] = {
      ...value.sections[0]!,
      sources: [
        { kind: 'folder', id: folder.id },
        { kind: 'feed', id: feed.id },
      ],
      maxItems: 2,
      filter: {
        match: 'any',
        conditions: [
          { field: 'title', operator: 'contains', value: 'FIGMA' },
          { field: 'author', operator: 'equals', value: 'Jo Park' },
        ],
      },
    };
    const config = service.createComposition(value);
    const before = database.sqlite.prepare('SELECT total_changes() AS count').get();
    const preview = await service.previewComposition(value, config.id, now.toISOString());
    expect(preview.snapshot.sections[0]).toMatchObject({ eligibleItems: 28, matchingItems: 4 });
    expect(preview.snapshot.sections[0]!.items.map((item) => item.title)).toEqual([
      'Figma 24',
      'Figma 25',
    ]);
    expect(preview.snapshot.issueNumber).toBe(1);
    expect(database.sqlite.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    value.sections[0]!.filter = {
      match: 'all',
      conditions: [
        { field: 'content', operator: 'equals', value: 'A & B' },
        { field: 'author', operator: 'equals', value: 'Jo Park' },
      ],
    };
    const filtered = await service.previewComposition(value, config.id, now.toISOString());
    expect(filtered.snapshot.sections[0]!.items.map((item) => item.title)).toEqual(['Figma 26']);
    expect(service.history(config.id)).toEqual([]);
  });
  it('preserves all section settings, sanitizes Notes and full text, and freezes generated issues', async () => {
    const { database, service, feed } = setup();
    const value = draft();
    value.sections = [
      {
        ...value.sections[0]!,
        sources: [{ kind: 'feed', id: feed.id }],
        sort: 'oldest',
        depth: 'full',
        images: false,
        maxItems: 1,
      },
      {
        ...newBrewSection('note', 'note'),
        note: 'Hello **reader** <script>alert(1)</script> [bad](javascript:alert(1))',
      },
      { ...newBrewSection('friday'), days: [5] },
    ];
    const config = service.createComposition(value);
    const preview = await service.previewComposition(value, config.id, now.toISOString());
    expect(preview.snapshot.sections.map((section) => section.id)).toEqual(['design', 'note']);
    expect(preview.snapshot.sections[0]!.items[0]).toMatchObject({
      title: 'Figma 27',
      imageUrl: null,
      contentHtml: '<p>A &amp; B</p>',
    });
    expect(preview.snapshot.sections[1]!.noteHtml).toContain('<strong>reader</strong>');
    expect(preview.snapshot.sections[1]!.noteHtml).not.toMatch(/<script|javascript:/i);
    for (const output of Object.values(preview.outputs)) {
      expect(output).toContain('Morning');
      expect(output).toContain('Figma 27');
      expect(output).not.toContain('alert(1)');
    }
    const [first, second] = await Promise.all([
      service.generateComposition(config.id),
      service.generateComposition(config.id),
    ]);
    expect(
      [first, second].map((issue) => ('issueNumber' in issue ? issue.issueNumber : 0)).sort(),
    ).toEqual([1, 2]);
    const frozen = JSON.stringify(service.snapshot(first.id));
    database.db.update(articles).set({ title: 'Changed', readAt: now }).run();
    service.updateComposition(config.id, {
      ...value,
      name: 'Weekend',
      sections: [newBrewSection('replacement')],
    });
    expect(JSON.stringify(service.snapshot(first.id))).toBe(frozen);
  });
  it('surfaces invalid regex instead of silently returning no matches', async () => {
    const { service } = setup();
    const value = draft();
    value.sections[0]!.filter = {
      match: 'all',
      conditions: [{ field: 'title', operator: 'matches_regex', value: '[' }],
    };
    await expect(service.previewComposition(value, 0, now.toISOString())).rejects.toThrow();
  });
  it('retains scheduled generation after v2 edits, skips small issues and freezes the checked preview only once', async () => {
    const { service, feed } = setup();
    const value = draft();
    value.sections[0]!.sources = [{ kind: 'feed', id: feed.id }];
    value.schedule.skipIfFewerThan = 30;
    const skipped = service.createComposition(value);
    expect(await service.runCompositionScheduled(now)).toBe(0);
    expect(service.history(skipped.id)).toEqual([]);
    const ready = service.createComposition({
      ...value,
      schedule: { ...value.schedule, skipIfFewerThan: 1 },
    });
    const at = new Date(now.getTime() + 15_000);
    expect(service.runScheduled(at)).toBe(0);
    expect(await service.runCompositionScheduled(at)).toBe(1);
    expect(await service.runCompositionScheduled(at)).toBe(0);
    expect(service.history(ready.id)[0]!.generatedAt).toBe(now.toISOString());
  });
  it('terminates a slow regex batch and propagates unavailable portable regex errors', async () => {
    expect(await safeRegexMany('(a+)+$', ['a'.repeat(30_000) + '!'], 50)).toMatchObject({
      timedOut: true,
      matches: [],
    });
    const { storage } = setup();
    const service = new BrewService(
      storage,
      { now: () => now },
      { test: async () => ({ matched: false, timedOut: true, error: 'Regex timed out' }) },
    );
    const value = draft();
    value.sections[0]!.filter = {
      match: 'all',
      conditions: [{ field: 'title', operator: 'matches_regex', value: '.*' }],
    };
    await expect(service.previewComposition(value, 0, now.toISOString())).rejects.toThrow(
      'Regex timed out',
    );
  });
  it('validates canonical REST writes and uses the same dry builder for live previews and generation', async () => {
    const database = openDatabase(':memory:');
    const app = await createApp({ database });
    closers.push(() => app.close());
    const created = await app.inject({
      method: 'POST',
      url: '/api/brew-configs/composition',
      payload: draft(),
    });
    expect(created.statusCode).toBe(201);
    const config = created.json();
    const preview = await app.inject({
      method: 'POST',
      url: `/api/brew-configs/${config.id}/preview`,
      payload: { draft: draft(), at: now.toISOString() },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['cache-control']).toBe('no-store');
    expect((preview.json() as BrewPreview).snapshot.issueNumber).toBe(1);
    expect((await app.inject({ url: `/api/brew-configs/${config.id}/history` })).json()).toEqual(
      [],
    );
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/brew-configs/${config.id}/composition`,
          payload: { ...draft(), timezone: 'Not/AZone' },
        })
      ).statusCode,
    ).toBe(400);
    const generated = await app.inject({
      method: 'POST',
      url: `/api/brew-configs/${config.id}/generate`,
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json()).toMatchObject({ version: 2, issueNumber: 1 });
  });
});
describe('IANA scheduled issue time', () => {
  it.each([
    ['daily', '07:00', 'Asia/Dhaka', '2026-11-25T00:00:00Z', '2026-11-25T01:00:00.000Z'],
    ['weekdays', '07:00', 'Asia/Dhaka', '2026-11-27T02:00:00Z', '2026-11-30T01:00:00.000Z'],
    ['daily', '02:30', 'America/New_York', '2026-03-08T05:00:00Z', '2026-03-08T07:30:00.000Z'],
    ['daily', '01:30', 'America/New_York', '2026-11-01T04:00:00Z', '2026-11-01T05:30:00.000Z'],
  ] as const)('%s %s in %s', (kind, time, zone, after, expected) =>
    expect(nextBrewAt({ kind, time }, zone, new Date(after)).toISOString()).toBe(expected),
  );
  it('skips months without the selected date', () =>
    expect(
      nextBrewAt(
        { kind: 'monthly', dayOfMonth: 31, time: '07:00' },
        'UTC',
        new Date('2026-02-01'),
      ).toISOString(),
    ).toBe('2026-03-31T07:00:00.000Z'));
});
