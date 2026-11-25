import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { articles, feeds } from './src/db/schema.js';
import { BrewService } from './src/services/brew-service.js';
import { NodeBrewStorage } from './src/ports/brew-storage.js';
import { CompositionPreview } from '../../packages/core/src/composition-preview.js';
import { defaultDelivery, newBrewSection } from '../../packages/core/src/composition-model.js';
import type { BrewConfigDraft, BrewPreview } from '../../packages/core/src/types/brew.js';

const now = new Date('2026-11-25T00:00:00Z');
const clock = { now: () => now };
const closes: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});

async function setup() {
  const database = openDatabase(':memory:');
  const sent: unknown[] = [];
  const app = await createApp({
    database,
    clock,
    outboundMail: {
      kind: 'smtp',
      send: async (message) => {
        sent.push(message);
        return { messageId: 'unexpected-send' };
      },
    },
  });
  closes.push(() => app.close());
  const feed = database.db
    .insert(feeds)
    .values({ title: 'Design', url: 'https://example.test/rss' })
    .returning()
    .get();
  for (const [title, date] of [
    ['Old', '2026-11-17T00:00:00Z'],
    ['This week', '2026-11-20T00:00:00Z'],
    ['Yesterday', '2026-11-24T01:00:00Z'],
    ['Boundary', '2026-11-25T00:00:00Z'],
    ['Future', '2026-11-26T20:30:00Z'],
  ])
    database.db
      .insert(articles)
      .values({
        feedId: feed.id,
        guid: title!,
        hash: title!,
        title: title!,
        url: `https://example.test/${encodeURIComponent(title!)}`,
        publishedAt: new Date(date!),
        starredAt: now,
        summaryHtml: `<p>${title}</p>`,
      })
      .run();
  const value: BrewConfigDraft = {
    name: 'Morning',
    enabled: false,
    timezone: 'Asia/Dhaka',
    schedule: { kind: 'daily', time: '07:00', skipIfFewerThan: 99 },
    delivery: { ...defaultDelivery(), email: { to: 'reader@example.test' } },
    sections: [
      {
        ...newBrewSection('day'),
        title: 'Last day',
        sources: [{ kind: 'today' }],
        onlyUnread: false,
        sort: 'oldest',
        maxItems: 20,
      },
      {
        ...newBrewSection('week'),
        title: 'Last week',
        sources: [{ kind: 'weekly_review' }],
        onlyUnread: false,
        sort: 'oldest',
        maxItems: 20,
      },
      {
        ...newBrewSection('all'),
        title: 'All design',
        sources: [{ kind: 'feed', id: feed.id }],
        onlyUnread: false,
        sort: 'oldest',
        maxItems: 20,
      },
      {
        ...newBrewSection('friday', 'note'),
        title: 'Friday note',
        days: [5],
        note: 'A **Friday** note.',
      },
    ],
  };
  const service = new BrewService(database, clock);
  const config = service.createComposition(value);
  const changes = () => database.sqlite.prepare('SELECT total_changes() AS count').get();
  const preview = (payload: Record<string, unknown>, id: string | number = config.id) =>
    app.inject({
      method: 'POST',
      url: `/api/brew-configs/${id}/preview`,
      payload,
    });
  return { database, app, service, config, value, sent, changes, preview };
}

describe('arbitrary-time Brew dry runs', () => {
  it.each([
    ['2026-11-18T00:00:00Z', ['Old'], ['Old'], ['Old'], false],
    [
      '2026-11-25T00:00:00Z',
      ['Yesterday', 'Boundary'],
      ['This week', 'Yesterday', 'Boundary'],
      ['Old', 'This week', 'Yesterday', 'Boundary'],
      false,
    ],
    [
      '2026-11-26T20:30:00Z',
      ['Future'],
      ['This week', 'Yesterday', 'Boundary', 'Future'],
      ['Old', 'This week', 'Yesterday', 'Boundary', 'Future'],
      true,
    ],
  ] as const)(
    'builds the saved Brew at %s without scheduling, delivery or writes',
    async (at, day, week, all, friday) => {
      const fixture = await setup();
      const before = fixture.changes();
      const response = await fixture.preview({ at });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const result = response.json<BrewPreview>();
      expect(result.snapshot).toMatchObject({
        id: 0,
        issueNumber: 1,
        generatedAt: new Date(at).toISOString(),
        timezone: 'Asia/Dhaka',
      });
      const titles = (id: string) =>
        result.snapshot.sections
          .find((section) => section.id === id)!
          .items.map((item) => item.title);
      expect(titles('day')).toEqual(day);
      expect(titles('week')).toEqual(week);
      expect(titles('all')).toEqual(all);
      expect(result.snapshot.sections.some((section) => section.id === 'friday')).toBe(friday);
      expect(result.outputs.feed).toContain(result.snapshot.generatedAt);
      if (friday)
        expect(parseHTML(result.outputs.email).document.querySelector('strong')?.textContent).toBe(
          'Friday',
        );
      expect(fixture.changes()).toEqual(before);
      expect(fixture.service.history(fixture.config.id)).toEqual([]);
      expect(fixture.service.composition(fixture.config.id)).toEqual(fixture.config);
      expect(fixture.sent).toEqual([]);
    },
  );

  it('treats offset timestamps as the same instant and defaults to the proposed next scheduled time', async () => {
    const fixture = await setup();
    const utc = await fixture.preview({ at: '2026-11-26T20:30:00Z' });
    const local = await fixture.preview({ at: '2026-11-27T02:30:00+06:00' });
    expect(local.json()).toEqual(utc.json());
    const next = await fixture.preview({});
    expect(next.json().snapshot.generatedAt).toBe('2026-11-25T01:00:00.000Z');
    expect(
      await fixture.service.previewBrew(fixture.config.id, '2026-11-27T02:30:00+06:00'),
    ).toEqual(utc.json());
  });

  it('previews an unsaved draft without replacing the saved configuration', async () => {
    const fixture = await setup();
    const draft = {
      ...fixture.value,
      name: 'Unsaved draft',
      sections: [{ ...newBrewSection('draft', 'note'), note: 'Only a preview.' }],
    };
    const before = fixture.changes();
    const response = await fixture.preview({ at: '2026-11-25T00:00:00Z', draft });
    expect(response.json().snapshot.configName).toBe('Unsaved draft');
    expect(response.json().outputs.web).toContain('Only a preview.');
    expect(fixture.service.composition(fixture.config.id)).toEqual(fixture.config);
    expect(fixture.changes()).toEqual(before);
  });

  it('rejects coercible, ambiguous and impossible timestamps without writes or cacheable errors', async () => {
    const fixture = await setup();
    const before = fixture.changes();
    for (const at of [
      null,
      0,
      true,
      [],
      {},
      '',
      '2026-11-25',
      '2026-11-25T07:00:00',
      '2026-02-30T07:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-11-25T25:00:00Z',
      'not a time',
    ]) {
      const response = await fixture.preview({ at });
      expect(response.statusCode, JSON.stringify(at)).toBe(422);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json().error).toBe('Choose a valid preview time with Z or a UTC offset.');
    }
    expect(fixture.changes()).toEqual(before);
  });

  it('returns 404 for absent or invalid Brew IDs even when an unsaved draft is supplied', async () => {
    const fixture = await setup();
    const before = fixture.changes();
    for (const id of [999, 0, -1, 1.5, 'invalid']) {
      const response = await fixture.preview({ at: now.toISOString(), draft: fixture.value }, id);
      expect(response.statusCode).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(fixture.changes()).toEqual(before);
  });

  it('does not partly commit an issue or consume its number when a filter fails', async () => {
    const fixture = await setup();
    const draft = structuredClone(fixture.value);
    draft.sections[0]!.filter = {
      match: 'all',
      conditions: [{ field: 'title', operator: 'matches_regex', value: '[' }],
    };
    const before = fixture.changes();
    expect((await fixture.preview({ draft, at: now.toISOString() })).statusCode).toBe(422);
    expect(fixture.changes()).toEqual(before);
    expect(fixture.service.history(fixture.config.id)).toEqual([]);
    expect(await fixture.service.generateComposition(fixture.config.id)).toMatchObject({
      issueNumber: 1,
    });
  });

  it('keeps stored issue bytes frozen through preview, config/library edits and subsequent generation', async () => {
    const fixture = await setup();
    const issue = await fixture.service.generateComposition(fixture.config.id);
    const frozen = fixture.database.sqlite
      .prepare('SELECT payload_json FROM brews WHERE id=?')
      .get(issue.id);
    const originalResponse = await fixture.app.inject(`/api/brews/${issue.id}`);
    fixture.database.sqlite
      .prepare("UPDATE articles SET title='Changed in Reader', read_at=?, starred_at=NULL")
      .run(now.getTime());
    fixture.database.sqlite.prepare("UPDATE feeds SET title='Renamed feed'").run();
    fixture.service.updateComposition(fixture.config.id, {
      ...fixture.value,
      name: 'Updated config',
      timezone: 'UTC',
      sections: [{ ...newBrewSection('new-note', 'note'), note: 'New edition only.' }],
    });
    const before = fixture.changes();
    const response = await fixture.preview({ at: '2026-11-27T02:30:00+06:00' });
    const result = response.json<BrewPreview>();
    expect(result.snapshot).toMatchObject({ id: 0, issueNumber: 2, configName: 'Updated config' });
    result.snapshot.sections[0]!.title = 'Changed preview result';
    expect(fixture.changes()).toEqual(before);
    expect((await fixture.app.inject(`/api/brews/${issue.id}`)).body).toBe(originalResponse.body);
    expect(fixture.service.snapshot(issue.id)).toEqual(issue);
    expect(await fixture.service.generateComposition(fixture.config.id)).toMatchObject({
      issueNumber: 2,
    });
    expect(
      fixture.database.sqlite.prepare('SELECT payload_json FROM brews WHERE id=?').get(issue.id),
    ).toEqual(frozen);
    expect(fixture.sent).toEqual([]);
  });

  it('captures a detached draft and time before an asynchronous filter so later edits cannot alter the snapshot', async () => {
    const fixture = await setup();
    const draft = structuredClone(fixture.value);
    draft.sections[0]!.filter = {
      match: 'all',
      conditions: [{ field: 'title', operator: 'matches_regex', value: '.' }],
    };
    let release!: () => void;
    let entered!: () => void;
    const filtering = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const preview = new CompositionPreview(new NodeBrewStorage(fixture.database), clock, {
      test: async () => ({ matched: true, timedOut: false }),
      testMany: async (_pattern, values) => {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { matches: values.map(() => true), timedOut: false };
      },
    });
    const at = new Date('2026-11-26T20:30:00Z');
    const pending = preview.build(draft, fixture.config.id, at);
    await filtering;
    at.setUTCFullYear(2000);
    draft.name = 'Changed during filtering';
    draft.timezone = 'UTC';
    draft.sections[0]!.title = 'Changed title';
    draft.sections[0]!.sources[0]!.kind = 'starred';
    draft.sections[0]!.filter!.conditions[0]!.value = 'changed';
    draft.sections[3]!.note = 'Changed note';
    release();
    const result = await pending;
    expect(result.snapshot).toMatchObject({
      configName: 'Morning',
      timezone: 'Asia/Dhaka',
      generatedAt: '2026-11-26T20:30:00.000Z',
    });
    expect(result.snapshot.sections[0]).toMatchObject({
      title: 'Last day',
      sources: [{ kind: 'today' }],
      filter: { conditions: [{ value: '.' }] },
    });
    expect(result.snapshot.sections[3]!.noteHtml).toContain('<strong>Friday</strong>');
    result.snapshot.sections[0]!.filter!.conditions[0]!.value = 'changed result';
    expect(draft.sections[0]!.filter!.conditions[0]!.value).toBe('changed');
  });
});
