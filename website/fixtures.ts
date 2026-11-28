/** Build-time only: sample API payloads from the same native fixtures used for Figma checks. */
import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { newsletterExitFixture } from '../web/e2e/newsletter-exit-fixture';

const page = {
  addInitScript: async () => {},
  route: async () => {},
  context: () => ({ route: async () => {} }),
  clock: { setFixedTime: async () => {} },
} as unknown as Page;
const fixture = await newsletterExitFixture(page);
const paths = new Set([
  '/api/capabilities',
  '/api/brew-configs',
  '/api/reader/navigation',
  '/api/tags',
  '/api/feeds',
  '/api/folders',
  '/api/newsletters/overview',
  '/api/sources/mailbox',
  '/api/newsletters/letters?view=inbox&page=1',
  '/api/articles?limit=50',
  '/api/rules',
]);
try {
  for (const [index, title] of ['Design', 'Engineering', 'Independent', 'Video'].entries())
    fixture.database.sqlite
      .prepare('INSERT INTO folders (id,title,position,created_at) VALUES (?,?,?,?)')
      .run(index + 1, title, index, Date.parse('2026-11-25T01:00:00Z'));
  const rss = fixture.database.sqlite
    .prepare("SELECT id FROM feeds WHERE kind='rss' ORDER BY id")
    .all() as { id: number }[];
  for (const [index, feed] of rss.entries())
    fixture.database.sqlite
      .prepare('UPDATE feeds SET folder_id=? WHERE id=?')
      .run(index < 4 ? 1 : 2, feed.id);
  await fixture.app.inject({
    method: 'POST',
    url: '/api/rules',
    payload: {
      name: 'Figma mentions',
      enabled: true,
      matchType: 'any',
      scope: { folderIds: [], feedIds: [] },
      conditions: [{ field: 'title', operator: 'contains', value: 'Figma' }],
      actions: [{ type: 'highlight', color: '#6e9278' }],
      stopProcessing: false,
      position: 0,
    },
  });
  for (const row of fixture.database.sqlite.prepare('SELECT id FROM articles').all() as {
    id: number;
  }[]) {
    paths.add('/api/articles/' + row.id);
    paths.add('/api/newsletters/letters/' + row.id);
  }
  for (const row of fixture.database.sqlite.prepare('SELECT id FROM brew_configs').all() as {
    id: number;
  }[]) {
    paths.add(`/api/brew-configs/${row.id}/composition`);
    paths.add(`/api/brew-configs/${row.id}/history`);
  }
  for (const row of fixture.database.sqlite.prepare('SELECT id FROM brews').all() as {
    id: number;
  }[])
    paths.add(`/api/brews/${row.id}/state`);
  const payloads: Record<string, unknown> = {};
  for (const url of paths) {
    const response = await fixture.app.inject({ method: 'GET', url });
    if (
      response.statusCode === 200 &&
      response.headers['content-type']?.includes('application/json')
    )
      payloads[url] = response.json();
  }
  await writeFile('website/demo/fixtures.json', JSON.stringify(payloads, null, 2) + '\n');
  const outputs: Record<string, { body: string; type: string }> = {};
  const exportPaths = new Set<string>();
  for (const row of fixture.database.sqlite
    .prepare('SELECT id,brew_config_id FROM brews')
    .all() as { id: number; brew_config_id: number }[]) {
    for (const extension of ['md', 'json'])
      exportPaths.add(`/b/${row.brew_config_id}/${row.id}.${extension}`);
    exportPaths.add(`/b/${row.brew_config_id}.atom`);
  }
  for (const row of fixture.database.sqlite.prepare('SELECT id FROM articles').all() as {
    id: number;
  }[])
    for (const extension of ['md', 'json']) exportPaths.add(`/a/${row.id}.${extension}`);
  for (const url of exportPaths) {
    const response = await fixture.app.inject({ method: 'GET', url });
    if (response.statusCode === 200)
      outputs[url] = { body: response.body, type: String(response.headers['content-type']) };
  }
  await writeFile('website/demo/outputs.json', JSON.stringify(outputs, null, 2) + '\n');
  console.log(`Exported ${Object.keys(payloads).length} native demo payloads.`);
} finally {
  await fixture.close();
}
