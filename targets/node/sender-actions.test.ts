import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { openDatabase } from './src/db/database';
import { schema } from './src/db/schema';
import { ActionsService } from '../../packages/core/src/actions';
import { NodeActionStorage } from './src/ports/action-storage';
import { NewsletterService } from './src/services/newsletter-service';
import { NewsletterLibrary } from './src/services/newsletter-library';
import { BrewService } from './src/services/brew-service';
import { defaultDelivery } from '../../packages/core/src/composition-model';
import { createApp } from './src/app';

const closes: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
async function setup() {
  const database = openDatabase(':memory:');
  closes.push(database.close);
  let now = Date.parse('2026-11-26T01:00:00Z');
  const clock = { now: () => new Date(now), monotonic: () => 0 };
  const brews = new BrewService(database, clock);
  const morning = brews.createComposition({
    name: 'Morning',
    enabled: false,
    timezone: 'UTC',
    schedule: { kind: 'daily', time: '08:00' },
    delivery: defaultDelivery(),
    sections: [],
  });
  const target = Number(
    database.sqlite
      .prepare("INSERT INTO brew_configs(name,sections_json) VALUES('Weekend','[]')")
      .run().lastInsertRowid,
  );
  const pipeline = new NewsletterService(database, clock);
  const ingest = (subject: string, date = '2026-09-20T12:00:00Z') =>
    pipeline.ingestMessage({
      from: { address: 'private-address@news.test', name: 'Dispatch' },
      subject,
      messageId: subject,
      date,
      html: `<p>${subject} original-private-token</p>`,
    });
  const dropped = await ingest('Dropped dispatch');
  const starred = await ingest('Starred dispatch');
  const tagged = await ingest('Tagged dispatch');
  database.sqlite
    .prepare('UPDATE articles SET starred_at=? WHERE id=?')
    .run(now, starred.articleId);
  const tag = Number(
    database.sqlite.prepare("INSERT INTO tags(name,color) VALUES('Keep','#a0471d')").run()
      .lastInsertRowid,
  );
  database.sqlite
    .prepare('INSERT INTO article_tags(article_id,tag_id) VALUES(?,?)')
    .run(tagged.articleId, tag);
  const rule = Number(
    database.sqlite
      .prepare(
        "INSERT INTO rules(name,match_type,scope_json,conditions_json,actions_json) VALUES('Old attribution','all','{}','[]','[]')",
      )
      .run().lastInsertRowid,
  );
  database.sqlite
    .prepare("INSERT INTO rule_logs(rule_id,article_id,actions_taken_json) VALUES(?,?,'[]')")
    .run(rule, dropped.articleId);
  const library = new NewsletterLibrary(database, clock);
  library.updateSender(dropped.feedId, { brewId: morning.id });
  let fetches = 0;
  const actions = new ActionsService(
    new NodeActionStorage(database, clock, async () => {
      fetches++;
      throw new Error('Sender actions do not fetch.');
    }),
  );
  const patch = {
    brewId: target,
    retentionDays: 1,
    blocked: true,
    onlyInBrew: true,
    skipInbox: true,
    cleaning: { sponsorSelectors: ['.private-selector'], footerSelectors: ['footer'] },
  };
  const snapshot = (sql = database.sqlite) =>
    Object.fromEntries(
      [
        'feeds',
        'articles',
        'article_tags',
        'tags',
        'rules',
        'rule_logs',
        'brew_configs',
        'brews',
      ].map((table) => [table, sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
    );
  return {
    database,
    clock,
    library,
    actions,
    pipeline,
    ingest,
    id: dropped.feedId,
    dropped: dropped.articleId!,
    starred: starred.articleId!,
    tagged: tagged.articleId!,
    morning,
    target,
    patch,
    snapshot,
    fetches: () => fetches,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('reviewed newsletter owner actions', () => {
  it('previews exact retention/routing effects without writes, bodies, addresses or fetches', async () => {
    const f = await setup();
    const before = f.snapshot();
    const changes = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    const preview = f.library.previewSenderSettings(f.id, f.patch)!;
    expect(preview).toMatchObject({
      senderTitle: 'Dispatch',
      lettersRemoved: 1,
      originalsRemoved: 3,
      requiresConfirmation: true,
      blocksMail: true,
    });
    expect(preview.revision).toMatch(/^[a-f\d]{64}$/);
    expect(preview.changes).toContainEqual({
      label: 'Goes to Brew',
      before: 'Morning',
      after: 'Weekend',
    });
    expect(JSON.stringify(preview)).not.toMatch(
      /original-private|private-address|private-selector|raw_html/,
    );
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
    expect(f.snapshot()).toEqual(before);
    expect(f.library.previewSenderSettings(f.id, { favorite: true })!.requiresConfirmation).toBe(
      false,
    );
    expect(f.fetches()).toBe(0);
  });
  it('journals pruning and v1/v2 routing, replays reordered patches and restores actual rows/FTS on a new connection', async () => {
    const f = await setup();
    const before = f.snapshot();
    const revision = f.library.previewSenderSettings(f.id, f.patch)!.revision;
    f.advance(5_000);
    const request = {
      kind: 'update_sender',
      id: f.id,
      patch: f.patch,
      revision,
      confirm: true,
      requestId: 'sender-reviewed-request-001',
    } as const;
    const pending = f.actions.run(request);
    expect(
      f.actions.run({
        ...request,
        patch: {
          ...f.patch,
          cleaning: { footerSelectors: ['footer'], sponsorSelectors: ['.private-selector'] },
        },
      }),
    ).toBe(pending);
    const action = await pending;
    expect(action).toMatchObject({
      kind: 'update_sender',
      status: 'complete',
      targetId: f.id,
      lettersRemoved: 1,
      originalsRemoved: 3,
      canUndo: true,
      externalEffects: false,
    });
    expect(
      f.database.sqlite.prepare('SELECT id FROM articles WHERE id=?').get(f.dropped),
    ).toBeUndefined();
    for (const id of [f.starred, f.tagged])
      expect(
        f.database.sqlite.prepare('SELECT raw_html AS raw FROM articles WHERE id=?').get(id),
      ).toEqual({ raw: null });
    expect(
      f.database.sqlite
        .prepare('SELECT composition_version AS version FROM brew_configs WHERE id=?')
        .get(f.target),
    ).toEqual({ version: 2 });
    expect((await f.ingest('Rejected while blocked', '2026-11-26T00:00:00Z')).outcome).toBe(
      'blocked',
    );
    expect(
      JSON.stringify(
        f.database.sqlite
          .prepare('SELECT args_json,result_json,undo_json FROM agent_actions')
          .all(),
      ),
    ).not.toMatch(/private-selector|original-private|private-address/);
    const sqlite = new Database(f.database.sqlite.serialize());
    sqlite.pragma('foreign_keys=ON');
    closes.push(() => sqlite.close());
    expect(sqlite.prepare('SELECT name FROM sqlite_temp_master').all()).toEqual([]);
    sqlite.prepare("UPDATE brew_configs SET name='Weekend renamed later' WHERE id=?").run(f.target);
    const reopened = new ActionsService(
      new NodeActionStorage(
        { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() },
        f.clock,
      ),
    );
    expect(reopened.undo(action.id).status).toBe('undone');
    const restored = f.snapshot(sqlite);
    const expected = structuredClone(before);
    (expected.brew_configs as Array<{ id: number; name: string }>).find(
      (row) => row.id === f.target,
    )!.name = 'Weekend renamed later';
    expect(restored).toEqual(expected);
    expect(
      sqlite.prepare("SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'Dropped'").all(),
    ).toEqual([{ rowid: f.dropped }]);
    expect((await reopened.run(request)).status).toBe('undone');
    expect(f.snapshot(sqlite)).toEqual(expected);
    expect(f.fetches()).toBe(0);
  });
  it.each(['content', 'settings', 'Brew'])(
    'rejects a stale review after later %s changes without action writes',
    async (change) => {
      const f = await setup();
      const revision = f.library.previewSenderSettings(f.id, f.patch)!.revision;
      if (change === 'content') await f.ingest('Late old dispatch');
      if (change === 'settings') f.library.updateSender(f.id, { favorite: true });
      if (change === 'Brew')
        f.database.sqlite
          .prepare("UPDATE brew_configs SET name='New name' WHERE id=?")
          .run(f.target);
      const before = f.snapshot();
      await expect(
        f.actions.run({ kind: 'update_sender', id: f.id, patch: f.patch, revision, confirm: true }),
      ).rejects.toThrow('review the settings again');
      expect(f.snapshot()).toEqual(before);
      expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
        n: 0,
      });
    },
  );
  it('requires a real assigned Brew when enabling Only in Brew and permits disabling a stale assignment', async () => {
    const f = await setup();
    const patch = { onlyInBrew: true };
    const revision = f.library.previewSenderSettings(f.id, patch)!.revision;
    f.database.sqlite
      .prepare("UPDATE brew_configs SET name='Changed after review' WHERE id=?")
      .run(f.morning.id);
    await expect(
      f.actions.run({ kind: 'update_sender', id: f.id, patch, revision, confirm: true }),
    ).rejects.toThrow('review the settings again');
    f.database.sqlite.prepare('DELETE FROM brew_configs WHERE id=?').run(f.morning.id);
    const before = f.snapshot();
    expect(() => f.library.previewSenderSettings(f.id, patch)).toThrow('no longer exists');
    expect(f.snapshot()).toEqual(before);
    // Older saved preferences may refer to a removed Brew. Keep the exit usable.
    f.library.updateSender(f.id, patch);
    const exit = { onlyInBrew: false };
    const preview = f.library.previewSenderSettings(f.id, exit)!;
    const result = await f.actions.run({
      kind: 'update_sender',
      id: f.id,
      patch: exit,
      revision: preview.revision,
      confirm: true,
    });
    expect(result.canUndo).toBe(true);
    expect(f.library.letter(f.starred)!.sender.settings.onlyInBrew).toBe(false);
  });
  it('rolls back pruning, settings, routing and the audit if one database write fails', async () => {
    const f = await setup();
    const revision = f.library.previewSenderSettings(f.id, f.patch)!.revision;
    f.database.sqlite.exec(
      `CREATE TEMP TRIGGER stop_prune BEFORE DELETE ON articles WHEN OLD.feed_id=${f.id} BEGIN SELECT RAISE(ABORT,'prune blocked'); END;`,
    );
    const before = f.snapshot();
    await expect(
      f.actions.run({ kind: 'update_sender', id: f.id, patch: f.patch, revision, confirm: true }),
    ).rejects.toThrow('prune blocked');
    expect(f.snapshot()).toEqual(before);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
    expect(
      f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_action_changes').get(),
    ).toEqual({ n: 0 });
  });
  it('refuses overlapping Undo atomically, reports no-op truthfully and expires private recovery', async () => {
    const f = await setup();
    const revision = f.library.previewSenderSettings(f.id, f.patch)!.revision;
    const action = await f.actions.run({
      kind: 'update_sender',
      id: f.id,
      patch: f.patch,
      revision,
      confirm: true,
    });
    const unchanged = await f.actions.run({
      kind: 'update_sender',
      id: f.id,
      patch: f.patch,
      revision: f.library.previewSenderSettings(f.id, f.patch)!.revision,
      confirm: true,
    });
    expect(unchanged).toMatchObject({
      canUndo: false,
      expiresAt: null,
      lettersRemoved: 0,
      originalsRemoved: 0,
    });
    f.library.updateSender(f.id, { favorite: true });
    const later = f.snapshot();
    expect(() => f.actions.undo(action.id)).toThrow('changed after');
    expect(f.snapshot()).toEqual(later);
    f.advance(30_001);
    f.actions.cleanup();
    expect(() => f.actions.undo(action.id)).toThrow('expired');
    expect(
      f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_action_changes').get(),
    ).toEqual({ n: 0 });
  });
  it('requires confirmation/review and validates private HTTP previews while preserving legacy PATCH', async () => {
    const f = await setup();
    closes.pop();
    const app = await createApp({ database: f.database, clock: f.clock });
    closes.push(() => app.close());
    const before = f.database.sqlite.prepare('SELECT total_changes() AS n').get();
    const preview = await app.inject({
      method: 'POST',
      url: `/api/newsletters/senders/${f.id}/preview`,
      payload: f.patch,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.headers['cache-control']).toBe('private, no-store');
    expect(preview.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(f.database.sqlite.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/actions',
          payload: {
            kind: 'update_sender',
            id: f.id,
            patch: f.patch,
            revision: preview.json().revision,
          },
        })
      ).statusCode,
    ).toBe(428);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/actions',
          payload: { kind: 'update_sender', id: f.id, patch: f.patch, confirm: true },
        })
      ).statusCode,
    ).toBe(400);
    for (const patch of [
      {},
      { blocked: 'yes' },
      { retentionDays: 0 },
      { retentionDays: 3651 },
      { id: 1 },
      { cleaning: { sponsorSelectors: ['['] } },
    ])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/newsletters/senders/${f.id}/preview`,
            payload: patch,
          })
        ).statusCode,
      ).toBe(400);
    const legacy = await app.inject({
      method: 'PATCH',
      url: `/api/newsletters/senders/${f.id}`,
      payload: { favorite: true },
    });
    expect(legacy.json().settings.favorite).toBe(true);
    expect(f.database.sqlite.prepare('SELECT count(*) AS n FROM agent_actions').get()).toEqual({
      n: 0,
    });
  });
});
