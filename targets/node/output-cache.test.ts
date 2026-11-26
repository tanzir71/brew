import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './src/db/database.js';
import { BrewService } from './src/services/brew-service.js';
import { NodeBrewStorage } from './src/ports/brew-storage.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';
import { renderBrewJson, renderBrewMarkdown } from '../../packages/core/src/brew-outputs.js';
import type { BrewSnapshot } from '../../packages/core/src/types/brew.js';

const closes: Array<() => void> = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
});
function setup() {
  const database = openDatabase(':memory:');
  closes.push(database.close);
  const service = new BrewService(database, { now: () => new Date('2026-11-25T01:00:00Z') });
  const config = service.createComposition({
    name: 'Weekend',
    enabled: false,
    timezone: 'UTC',
    schedule: { kind: 'daily', time: '07:00' },
    delivery: defaultDelivery(),
    sections: [{ ...newBrewSection('note', 'note'), note: 'Read **slowly**. [Library](/a/7)' }],
  });
  const row = (id: number) =>
    database.sqlite
      .prepare('SELECT payload_json,rendered_md,rendered_json FROM brews WHERE id=?')
      .get(id) as {
      payload_json: string;
      rendered_md: string | null;
      rendered_json: string | null;
    };
  return { database, service, config, row, storage: new NodeBrewStorage(database) };
}
describe('frozen output caches', () => {
  it('stores origin-neutral Markdown/JSON atomically with the final issue identity and keeps them frozen', async () => {
    const f = setup();
    const issue = (await f.service.generateComposition(f.config.id)) as BrewSnapshot;
    const stored = f.row(issue.id);
    expect(stored.rendered_md).toBe(renderBrewMarkdown(issue));
    expect(stored.rendered_json).toBe(renderBrewJson(issue));
    expect(JSON.parse(stored.rendered_json!)).toMatchObject({ id: issue.id, issueNumber: 1 });
    expect(stored.rendered_md).toContain('[Library](</a/7>)');
    expect(stored.rendered_json).not.toMatch(/scrollPosition|readAt|delivery|sources|filter/);
    f.service.saveScroll(issue.id, 500);
    f.service.updateComposition(f.config.id, { ...f.config, name: 'Changed', sections: [] });
    expect(f.row(issue.id)).toEqual(stored);
    expect(f.service.snapshot(issue.id)!.scrollPosition).toBe(500);
  });
  it('rolls back the issue and its number when cache rendering fails, and leaves legacy payloads untouched', async () => {
    const f = setup();
    const first = (await f.service.generateComposition(f.config.id)) as BrewSnapshot;
    const payload = {
      version: first.version,
      issueNumber: first.issueNumber,
      configName: first.configName,
      generatedAt: first.generatedAt,
      timezone: first.timezone,
      sections: first.sections,
    };
    const before = f.database.sqlite
      .prepare('SELECT id,payload_json,rendered_md,rendered_json FROM brews')
      .all();
    expect(() => f.storage.save(f.config.id, { ...payload, timezone: 'Not/A_Timezone' })).toThrow();
    expect(
      f.database.sqlite
        .prepare('SELECT id,payload_json,rendered_md,rendered_json FROM brews')
        .all(),
    ).toEqual(before);
    expect(((await f.service.generateComposition(f.config.id)) as BrewSnapshot).issueNumber).toBe(
      2,
    );
    const legacyId = f.storage.save(f.config.id, { configName: 'Old issue', sections: [] });
    expect(f.row(legacyId)).toEqual({
      payload_json: JSON.stringify({ configName: 'Old issue', sections: [] }),
      rendered_md: null,
      rendered_json: null,
    });
  });
});
