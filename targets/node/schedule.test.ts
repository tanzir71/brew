import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './src/app.js';
import { openDatabase } from './src/db/database.js';
import { NodeBrewStorage } from './src/ports/brew-storage.js';
import { BrewService } from './src/services/brew-service.js';
import { newBrewSection, defaultDelivery } from '../../packages/core/src/composition-model.js';
import type { BrewConfigDraft } from '../../packages/core/src/types/brew.js';
import type { OutboundMailPort } from '../../packages/core/src/types/delivery.js';
import { isCapabilities } from '../../packages/core/src/types/capabilities.js';
import { nodeCapabilities } from './src/capabilities.js';
import { articles, feeds } from './src/db/schema.js';

const fixed = new Date('2026-11-25T00:00:00Z');
const clock = { now: () => fixed, monotonic: () => performance.now() };
const draft = (): BrewConfigDraft => ({
  name: 'Morning',
  enabled: true,
  timezone: 'Asia/Dhaka',
  schedule: { kind: 'weekdays', time: '07:00', skipIfFewerThan: 5 },
  delivery: defaultDelivery(),
  sections: [newBrewSection('today')],
});
const closes: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0)) await close();
});
describe('Schedule API and transport-backed test email', () => {
  it.each([
    [{ kind: 'daily', time: '07:17' }, 'Asia/Dhaka', '2026-11-25T01:17:00.000Z'],
    [{ kind: 'weekly', time: '07:00', days: [5] }, 'Asia/Dhaka', '2026-11-27T01:00:00.000Z'],
    [{ kind: 'monthly', time: '07:00', dayOfMonth: 31 }, 'UTC', '2026-12-31T07:00:00.000Z'],
  ])(
    'calculates %j in %s without writing config or issue state',
    async (schedule, timezone, expected) => {
      const database = openDatabase(':memory:');
      const app = await createApp({ database, clock });
      closes.push(() => app.close());
      const before = database.sqlite.prepare('SELECT total_changes() AS count').get();
      const response = await app.inject({
        method: 'POST',
        url: '/api/brew-configs/1/schedule-preview',
        payload: { schedule, timezone, enabled: true },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json().nextAt).toBe(expected);
      expect(database.sqlite.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    },
  );
  it('rejects invalid weekly/monthly/zone inputs and returns a paused next time', async () => {
    const app = await createApp({ database: openDatabase(':memory:'), clock });
    closes.push(() => app.close());
    for (const partial of [
      { schedule: { kind: 'weekly', days: [], time: '07:00' } },
      { schedule: { kind: 'weekly', days: 'Monday', time: '07:00' } },
      { schedule: { kind: 'monthly', dayOfMonth: 32, time: '07:00' } },
      { timezone: 'Not/AZone' },
      { schedule: { kind: 'daily', time: '24:00' } },
      { schedule: { kind: 'daily', time: '07:00', skipIfFewerThan: 1.5 } },
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/brew-configs/1/schedule-preview',
            payload: { ...draft(), ...partial },
          })
        ).statusCode,
      ).toBe(422);
    const paused = await app.inject({
      method: 'POST',
      url: '/api/brew-configs/1/schedule-preview',
      payload: { ...draft(), enabled: false },
    });
    expect(paused.json().nextAt).toBeNull();
  });
  it('keeps test mail gated without a provider, and does not report success on provider failure', async () => {
    const unavailable = await createApp({ database: openDatabase(':memory:') });
    closes.push(() => unavailable.close());
    expect(
      (
        await unavailable.inject({
          method: 'POST',
          url: '/api/brew-configs/1/test-email',
          payload: { draft: draft() },
        })
      ).statusCode,
    ).toBe(501);
    const app = await createApp({
      database: openDatabase(':memory:'),
      clock,
      outboundMail: {
        kind: 'smtp',
        send: async () => {
          throw new Error('SMTP unavailable');
        },
      },
    });
    closes.push(() => app.close());
    const value = draft();
    value.delivery.email = { to: 'reader@example.test' };
    const response = await app.inject({
      method: 'POST',
      url: '/api/brew-configs/1/test-email',
      payload: { draft: value },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'SMTP unavailable' });
  });
  it('passes the actual unsaved email preview to the provider once, without saving an issue, schedule or issue number', async () => {
    const sent: Parameters<OutboundMailPort['send']>[0][] = [];
    const database = openDatabase(':memory:');
    const app = await createApp({
      database,
      clock,
      outboundMail: {
        kind: 'smtp',
        send: async (message) => {
          sent.push(message);
          return { messageId: 'receipt-1' };
        },
      },
    });
    closes.push(() => app.close());
    const config = new BrewService(database, clock).createComposition(draft());
    const value = {
      ...draft(),
      name: 'Unsaved name',
      sections: [{ ...newBrewSection('note', 'note'), note: 'A **real** preview.' }],
      delivery: { ...defaultDelivery(), email: { to: 'reader@example.test' } },
    };
    const before = database.sqlite.prepare('SELECT total_changes() AS count').get();
    const response = await app.inject({
      method: 'POST',
      url: `/api/brew-configs/${config.id}/test-email`,
      payload: { draft: value },
    });
    expect(response.json()).toEqual({
      sent: true,
      to: 'reader@example.test',
      messageId: 'receipt-1',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'reader@example.test', subject: 'Test · Unsaved name' });
    expect(sent[0]!.html).toContain('<strong>real</strong>');
    expect(database.sqlite.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    expect(new NodeBrewStorage(database).nextIssueNumber(config.id)).toBe(1);
    expect(new BrewService(database).composition(config.id)!.name).toBe('Morning');
    expect((await app.inject('/api/capabilities')).json().emailDelivery).toBe('smtp');
  });
  it('rejects malformed output capabilities instead of optimistically enabling controls', () => {
    expect(isCapabilities({ ...nodeCapabilities(), outputs: { feed: true, webhook: 'yes' } })).toBe(
      false,
    );
    expect(isCapabilities(nodeCapabilities())).toBe(true);
  });
});
describe('scheduled issue retention and thresholds', () => {
  it('keeps more than thirty recent v2 issues, prunes after thirty days, and preserves numbering after all issues expire', async () => {
    let now = new Date(fixed);
    const testClock = { now: () => now, monotonic: () => performance.now() };
    const database = openDatabase(':memory:');
    closes.push(database.close);
    const service = new BrewService(database, testClock);
    const config = service.createComposition({ ...draft(), enabled: false, sections: [] });
    for (let index = 0; index < 32; index++) await service.generateComposition(config.id);
    expect(service.history(config.id)).toHaveLength(32);
    // A pre-upgrade database has no persistent counter. Capture it before pruning.
    database.sqlite
      .prepare('DELETE FROM settings WHERE key=?')
      .run(`brew_issue_number_${config.id}`);
    now = new Date(fixed.getTime() + 31 * 86_400_000);
    expect(await service.runCompositionScheduled(now)).toBe(0);
    expect(service.history(config.id)).toHaveLength(0);
    expect(await service.generateComposition(config.id)).toMatchObject({ issueNumber: 33 });
  });
  it('does not count already-read stories toward the new-item threshold', async () => {
    const database = openDatabase(':memory:');
    closes.push(database.close);
    const service = new BrewService(database, clock);
    const feed = database.db
      .insert(feeds)
      .values({ title: 'Design', url: 'https://example.test/rss' })
      .returning()
      .get();
    database.db
      .insert(articles)
      .values({
        feedId: feed.id,
        guid: 'read',
        hash: 'read',
        url: 'https://example.test/read',
        title: 'Already read',
        publishedAt: fixed,
        readAt: fixed,
      })
      .run();
    const value = draft();
    value.schedule = { kind: 'daily', time: '06:00', skipIfFewerThan: 1 };
    value.sections = [
      { ...newBrewSection('all'), onlyUnread: false, sources: [{ kind: 'feed', id: feed.id }] },
    ];
    service.createComposition(value);
    expect(await service.runCompositionScheduled(fixed)).toBe(0);
  });
});
