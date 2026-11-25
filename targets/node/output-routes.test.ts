import { afterEach, describe, expect, it } from 'vitest';
import Parser from 'rss-parser';
import { createApp } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { BrewService } from './src/services/brew-service.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';
import { brewOutputSnapshot } from '../../packages/core/src/brew-output-snapshot.js';
import { renderBrewJson } from '../../packages/core/src/brew-outputs.js';
import type { BrewIssueDocument } from '../../packages/core/src/types/outputs.js';

const now = new Date('2026-11-25T01:00:00Z');
const closes: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
async function setup(publicUrl?: string) {
  const database = openDatabase(':memory:');
  const app = await createApp({ database, clock: { now: () => now }, publicUrl });
  closes.push(() => app.close());
  const service = new BrewService(database, { now: () => now });
  const draft = {
    name: 'Weekend & reading',
    enabled: false,
    timezone: 'Asia/Dhaka',
    schedule: { kind: 'daily' as const, time: '07:00' },
    delivery: { ...defaultDelivery(), feed: true },
    sections: [
      {
        ...newBrewSection('note', 'note'),
        title: 'Frozen note',
        note: 'Read **slowly**. [Library](/a/7)',
      },
    ],
  };
  const first = service.createComposition(draft);
  const other = service.createComposition({ ...draft, name: 'Other Brew' });
  await service.generateComposition(other.id);
  const older = await service.generateComposition(first.id);
  await service.generateComposition(other.id);
  const latest = await service.generateComposition(first.id);
  const get = (path: string, method: 'GET' | 'HEAD' = 'GET') =>
    app.inject({ method, url: path, headers: { host: 'reader.example.test:4401' } });
  return { app, database, service, first, other, older, latest, get };
}

describe('Node output URLs through the portable API', () => {
  it('serves the selected frozen issue as Markdown/JSON with correct media types, safe headers and HEAD', async () => {
    const f = await setup();
    expect(f.older.id).not.toBe('issueNumber' in f.older && f.older.issueNumber);
    const before = f.database.sqlite.prepare('SELECT total_changes() AS count').get();
    const json = await f.get(`/b/${f.first.id}/${f.older.id}.json`);
    expect(json.statusCode).toBe(200);
    expect(json.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(json.headers['cache-control']).toBe('private, no-store');
    expect(json.headers['x-robots-tag']).toContain('noindex');
    expect(json.headers['x-content-type-options']).toBe('nosniff');
    expect(json.headers.link).toContain(
      `</b/${f.first.id}/${f.older.id}.md>; rel="alternate"; type="text/markdown"`,
    );
    expect(json.json<BrewIssueDocument>()).toMatchObject({
      id: f.older.id,
      issueNumber: 1,
      configName: f.first.name,
    });
    expect(json.body).toBe(
      renderBrewJson(brewOutputSnapshot(f.older), { baseUrl: 'http://reader.example.test:4401' }),
    );
    const md = await f.get(`/b/${f.first.id}/${f.older.id}.md`);
    expect(md.statusCode).toBe(200);
    expect(md.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(md.body).toContain('Read **slowly**. [Library](<http://reader.example.test:4401/a/7>)');
    expect(md.body).toContain('No. 1');
    const head = await f.get(`/b/${f.first.id}/${f.older.id}.md`, 'HEAD');
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-type']).toBe(md.headers['content-type']);
    expect(f.database.sqlite.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    f.service.updateComposition(f.first.id, { ...f.first, name: 'Changed', sections: [] });
    expect((await f.get(`/b/${f.first.id}/${f.older.id}.json`)).body).toBe(json.body);
  });

  it('never substitutes the latest or a different Brew for a missing/malformed issue', async () => {
    const f = await setup();
    for (const path of [
      `/b/${f.other.id}/${f.older.id}.json`,
      `/b/${f.first.id}/9999.md`,
      '/b/0/1.json',
      '/b/1/01.md',
      '/b/1/9007199254740992.json',
      '/b/nope/1.md',
      '/b/1/2.atom',
      '/b/nope.atom',
    ]) {
      const response = await f.get(path);
      expect(response.statusCode, path).toBe(404);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body).not.toContain('<!doctype html>');
    }
  });

  it('serves whole-issue Atom/JSON feeds in archive order with real instance URLs and private caching', async () => {
    const f = await setup();
    const response = await f.get(`/b/${f.first.id}.atom`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/atom+xml; charset=utf-8');
    expect(response.headers['cache-control']).toBe('private, no-store');
    const atom = await new Parser().parseString(response.body);
    expect(atom.items.map((item) => item.link)).toEqual(
      [f.latest, f.older].map(
        (issue) => `http://reader.example.test:4401/b/${f.first.id}/${issue.id}`,
      ),
    );
    expect(response.body).not.toContain('brew.internal');
    const json = await f.get(`/b/${f.first.id}.json`);
    expect(json.headers['content-type']).toBe('application/feed+json; charset=utf-8');
    expect(json.json().items.map((item: { id: string }) => item.id)).toEqual(
      atom.items.map((item) => item.id),
    );
    expect(json.json().items[1].content_html).toContain('Frozen note');
    expect((await f.get(`/b/${f.first.id}.atom`, 'HEAD')).body).toBe('');
  });

  it('uses an explicit canonical HTTPS origin behind proxies and validates it before opening the app', async () => {
    const f = await setup('https://personal.example.test/');
    expect((await f.get(`/b/${f.first.id}.json`)).json().feed_url).toBe(
      `https://personal.example.test/b/${f.first.id}.json`,
    );
    expect((await f.get(`/b/${f.first.id}/${f.latest.id}.md`)).body).toContain(
      'https://personal.example.test/a/7',
    );
    await expect(createApp({ publicUrl: 'https://user:secret@brew.test' })).rejects.toThrow(
      'without credentials',
    );
  });

  it('enforces the saved feed toggle independently of twins, supports empty feeds, and preserves legacy frozen content', async () => {
    const f = await setup();
    f.service.updateComposition(f.first.id, {
      ...f.first,
      delivery: { ...f.first.delivery, feed: false },
    });
    expect((await f.get(`/b/${f.first.id}.atom`)).statusCode).toBe(404);
    expect((await f.get(`/b/${f.first.id}.json`)).statusCode).toBe(404);
    expect((await f.get(`/b/${f.first.id}/${f.latest.id}.md`)).statusCode).toBe(200);
    const empty = f.service.createComposition({ ...f.first, sections: [] });
    expect(
      (await new Parser().parseString((await f.get(`/b/${empty.id}.atom`)).body)).items,
    ).toEqual([]);
    const legacy = f.service.create({
      name: 'Legacy',
      enabled: false,
      scheduleCron: '0 7 * * *',
      sections: [
        {
          id: 'legacy',
          title: 'Legacy stories',
          divider: 'An **old** note.',
          source: 'today',
          maxItems: 2,
          layout: 'hero',
          sort: 'newest',
          onlyUnread: false,
        },
      ],
    });
    const issue = f.service.generate(legacy.id);
    const frozen = f.database.sqlite
      .prepare('SELECT payload_json FROM brews WHERE id=?')
      .get(issue.id);
    const legacyConfig = f.service.composition(legacy.id)!;
    f.service.updateComposition(legacy.id, {
      ...legacyConfig,
      delivery: { ...legacyConfig.delivery, feed: true },
    });
    await f.service.generateComposition(legacy.id);
    const old = await f.get(`/b/${legacy.id}/${issue.id}.md`);
    expect(old.statusCode).toBe(200);
    expect(old.body).toContain('An **old** note.');
    expect((await f.get(`/b/${legacy.id}/${issue.id}.json`)).json().sections[1].layout).toBe(
      'lead',
    );
    expect(
      (await new Parser().parseString((await f.get(`/b/${legacy.id}.atom`)).body)).items,
    ).toHaveLength(2);
    expect(
      f.database.sqlite.prepare('SELECT payload_json FROM brews WHERE id=?').get(issue.id),
    ).toEqual(frozen);
  });
});
