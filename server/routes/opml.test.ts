import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/database.js';
import { feeds, folders } from '../db/schema.js';
import { OpmlService } from '../services/opml-service.js';

const fixture = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/opml-100.xml'), 'utf8');

describe('OPML import and export', () => {
  it('round-trips a 100-feed foldered fixture and remains idempotent', async () => {
    const database = openDatabase(':memory:');
    const app = await createApp({ database });
    const first = await app.inject({ method: 'POST', url: '/api/opml/import', headers: { 'content-type': 'text/x-opml' }, payload: fixture });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ imported: 100, skipped: 0, foldersCreated: 10 });
    const second = await app.inject({ method: 'POST', url: '/api/opml/import', headers: { 'content-type': 'text/x-opml' }, payload: fixture });
    expect(second.json()).toEqual({ imported: 0, skipped: 100, foldersCreated: 0 });
    expect(database.db.select().from(feeds).all()).toHaveLength(100);
    expect(database.db.select().from(folders).all()).toHaveLength(10);

    const exported = await app.inject('/api/opml/export');
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-disposition']).toContain('brew-subscriptions.opml');
    const restored = openDatabase(':memory:');
    expect(new OpmlService(restored).import(exported.body)).toEqual({ imported: 100, skipped: 0, foldersCreated: 10 });
    expect(restored.db.select().from(feeds).all()).toHaveLength(100);
    expect(restored.db.select().from(folders).all().map((folder) => folder.title)).toEqual(Array.from({ length: 10 }, (_, index) => `Folder ${index + 1}`));
    restored.close();
    await app.close();
  });

  it('escapes exported attributes and rejects invalid documents', async () => {
    const database = openDatabase(':memory:');
    database.db.insert(feeds).values({ title: 'Rock & <Roll>', url: 'https://example.test/feed?a=1&b=2' }).run();
    const service = new OpmlService(database);
    const xml = service.export();
    expect(xml).toContain('Rock &amp; &lt;Roll&gt;');
    expect(xml).toContain('a=1&amp;b=2');
    expect(() => service.import('<html>not opml</html>')).toThrow('Invalid OPML');
    database.close();
  });
});
