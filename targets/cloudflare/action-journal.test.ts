import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { openDatabase } from '../node/src/db/database.js';
import { ActionJournal } from '../node/src/ports/action-journal.js';
import { CloudflareStorage } from './src/storage.js';
import {
  CloudflareActionJournal,
  type JournalSql,
  type JournalTransaction,
} from './src/action-journal.js';
import {
  journalTables,
  journalTriggers,
  type JournalColumn,
} from '../../packages/db/src/action-journal.js';

const now = Date.parse('2026-11-27T12:00:00Z');
const server = createTestHarness({
  workers: [
    {
      config: {
        name: 'brew-journal-test',
        main: fileURLToPath(new URL('./test/action-journal-worker.ts', import.meta.url)),
        compatibility_date: '2026-07-01',
        compatibility_flags: ['nodejs_compat'],
        workers_dev: false,
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'journal-test',
            database_id: '00000000-0000-0000-0000-000000000001',
            migrations_dir: fileURLToPath(
              new URL('../../packages/db/migrations/', import.meta.url),
            ),
          },
        ],
      },
    },
  ],
});
const worker = server.getWorker<{ DB: D1Database }>('brew-journal-test');
let db: D1Database, node: ReturnType<typeof openDatabase>, native: ActionJournal;
beforeAll(async () => {
  await server.listen();
  await worker.applyD1Migrations('DB');
  db = (await worker.getEnv()).DB;
}, 30000);
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await db.exec(
    'DELETE FROM agent_actions; DELETE FROM settings; DELETE FROM feeds; DELETE FROM folders; DELETE FROM tags; DELETE FROM rules; DELETE FROM brew_configs; DELETE FROM sqlite_sequence;',
  );
  node = openDatabase(':memory:');
  native = new ActionJournal(node);
  const seed = [
    "INSERT INTO folders(id,title,created_at) VALUES(1,'Research',1795780800000)",
    "INSERT INTO feeds(id,url,title,folder_id,created_at) VALUES(1,'https://source.example.test/rss','Source',1,1795780800000)",
    "INSERT INTO tags(id,name,color) VALUES(1,'Saved','#000000')",
    `INSERT INTO articles(id,feed_id,guid,hash,title,url,published_at,content_html,fetched_at) VALUES(1,1,'g1','h1','First','https://source.example.test/1',${now},'<p>Original.</p>',${now}),(2,1,'g2','h2','Second','https://source.example.test/2',${now},'<p>Second.</p>',${now})`,
    'INSERT INTO article_tags(article_id,tag_id) VALUES(1,1)',
    "INSERT INTO rules(id,name,match_type,scope_json,conditions_json,actions_json,created_at,updated_at) VALUES(1,'Original','all','{}','[]','[]',1795780800000,1795780800000)",
    `INSERT INTO rule_logs(id,rule_id,article_id,actions_taken_json,executed_at) VALUES(1,1,1,'[]',${now})`,
  ];
  for (const sql of seed) node.sqlite.exec(sql);
  await db.batch(seed.map((sql) => db.prepare(sql)));
});
afterEach(() => {
  node.close();
});
async function both(sql: string, values: unknown[] = []) {
  node.sqlite.prepare(sql).run(...values);
  await db
    .prepare(sql)
    .bind(...values)
    .run();
}
function receipt(id: number, tool = 'apply_rule'): JournalSql {
  return {
    sql: 'INSERT INTO agent_actions(id,agent,tool,args_json,result_json,undo_json,created_at) VALUES(?,?,?,?,?,?,?)',
    values: [
      id,
      'web',
      tool,
      '{}',
      JSON.stringify({ kind: tool, status: 'pending' }),
      JSON.stringify({ version: 1, expiresAt: now - 1 }),
      now,
    ],
  };
}
async function addReceipt(id: number, tool = 'apply_rule') {
  const query = receipt(id, tool);
  await both(query.sql, query.values);
}
async function write(id: number, queries: JournalSql[], options: Partial<JournalTransaction> = {}) {
  native.write(id, () => {
    for (const query of queries) node.sqlite.prepare(query.sql).run(...(query.values ?? []));
  });
  const response = await worker.fetch('https://journal.example.test/write', {
    method: 'POST',
    body: JSON.stringify({ actionId: id, at: now, queries, ...options }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json() as Promise<{ statements: number; largestBinding: number }>;
}
const finish = (id: number): JournalSql[] => [
  { sql: 'UPDATE agent_actions SET undone_at=?,undo_json=NULL WHERE id=?', values: [now, id] },
  { sql: 'DELETE FROM agent_action_changes WHERE action_id=?', values: [id] },
];
async function restore(id: number) {
  node.sqlite.transaction(() => {
    native.restore(id);
    for (const query of finish(id)) node.sqlite.prepare(query.sql).run(...(query.values ?? []));
  })();
  const response = await worker.fetch('https://journal.example.test/restore', {
    method: 'POST',
    body: JSON.stringify({ id, at: now, after: finish(id) }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json() as Promise<{ statements: number; largestBinding: number }>;
}
async function rows(table: string) {
  return (
    await db
      .prepare(`SELECT * FROM ${table} ORDER BY 1${table === 'article_tags' ? ',2' : ''}`)
      .all()
  ).results;
}
async function equivalent() {
  for (const table of journalTables)
    expect(await rows(table), table).toEqual(
      node.sqlite
        .prepare(`SELECT * FROM ${table} ORDER BY 1${table === 'article_tags' ? ',2' : ''}`)
        .all(),
    );
}
async function inactive() {
  expect(
    await db.prepare("SELECT value FROM settings WHERE key='brew_active_action'").first(),
  ).toBeNull();
}

it('installs canonical persistent triggers from the shared Node builder and records only activated writes', async () => {
  const active = "json_extract((SELECT value FROM settings WHERE key='brew_active_action'),'$.id')";
  for (const table of journalTables) {
    const columns = node.sqlite.prepare(`PRAGMA table_info("${table}")`).all() as JournalColumn[];
    expect(journalTriggers(table, columns, active)).toHaveLength(table === 'brew_configs' ? 1 : 3);
    for (const expected of journalTriggers(table, columns, active)) {
      const name = /TRIGGER IF NOT EXISTS "([^"]+)"/.exec(expected)![1]!;
      const actual = await db
        .prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?')
        .bind('trigger', name)
        .first<{ sql: string }>();
      const normalized = (value: string) =>
        value.replace('IF NOT EXISTS ', '').replaceAll('main.', '').replace(/\s+/g, ' ').trim();
      expect(normalized(actual!.sql)).toBe(normalized(expected));
    }
  }
  await addReceipt(1);
  await write(1, [
    { sql: 'UPDATE articles SET read_at=?,starred_at=? WHERE id=1', values: [now, now] },
    { sql: 'UPDATE articles SET read_at=? WHERE id=1', values: [now] },
  ]);
  const changes = await rows('agent_action_changes');
  expect(changes).toHaveLength(1);
  expect(changes).toEqual(
    node.sqlite.prepare('SELECT * FROM agent_action_changes ORDER BY id').all(),
  );
  expect(JSON.parse(String(changes[0]!.before_json))).toEqual({ read_at: null, starred_at: null });
  await both("UPDATE articles SET title='Later unrelated title' WHERE id=1");
  expect(await rows('agent_action_changes')).toHaveLength(1);
  await restore(1);
  await equivalent();
  expect((await rows('articles'))[0]!.title).toBe('Later unrelated title');
  await inactive();
});

it('creates and finalizes a receipt in the same transaction and rolls every effect back on denied, stale or failed writes', async () => {
  const journal = new CloudflareActionJournal(new CloudflareStorage(db));
  for (const options of [{ authorized: { sql: '0' } }, { valid: { sql: '0' } }]) {
    await expect(
      journal.transaction({
        actionId: 9,
        at: now,
        before: [receipt(9)],
        queries: [{ sql: 'UPDATE articles SET read_at=? WHERE id=1', values: [now] }],
        ...options,
      }),
    ).rejects.toMatchObject({ status: 'authorized' in options ? 403 : 409 });
    expect(await db.prepare('SELECT id FROM agent_actions WHERE id=9').first()).toBeNull();
    expect((await rows('articles'))[0]!.read_at).toBeNull();
    await inactive();
  }
  await expect(
    journal.transaction({
      actionId: 9,
      at: now,
      before: [receipt(9)],
      queries: [{ sql: 'UPDATE articles SET read_at=? WHERE id=1', values: [now] }],
      after: [{ sql: 'INSERT INTO article_tags VALUES(9999,1)' }],
    }),
  ).rejects.toThrow();
  expect(await rows('agent_actions')).toEqual([]);
  expect(await rows('agent_action_changes')).toEqual([]);
  expect((await rows('articles'))[0]!.read_at).toBeNull();
  await inactive();
  await journal.transaction({
    actionId: { sql: '(SELECT id FROM agent_actions WHERE id=9)' },
    at: now,
    before: [receipt(9)],
    queries: [{ sql: 'UPDATE articles SET read_at=? WHERE id=1', values: [now] }],
    after: [
      { sql: "UPDATE agent_actions SET result_json='{" + '"status":"complete"' + "}' WHERE id=9" },
    ],
  });
  expect(JSON.parse(String((await rows('agent_actions'))[0]!.result_json))).toEqual({
    status: 'complete',
  });
  expect(JSON.parse(String((await rows('agent_actions'))[0]!.undo_json)).expiresAt).toBe(
    now + 30000,
  );
  await inactive();
});

it('restores feed deletion, cascaded tags/history, full original rows and FTS in parent order', async () => {
  await addReceipt(1, 'delete_feed');
  await write(1, [{ sql: 'DELETE FROM feeds WHERE id=1' }]);
  expect(await rows('articles')).toEqual([]);
  await restore(1);
  await equivalent();
  expect(
    (await db.prepare("SELECT rowid FROM articles_fts WHERE articles_fts MATCH 'Original'").all())
      .results,
  ).toHaveLength(1);
  await inactive();
});

it('rejects conflicting later field changes without partially restoring another row or losing history', async () => {
  await addReceipt(1);
  await write(1, [{ sql: 'UPDATE articles SET read_at=? WHERE id IN (1,2)', values: [now] }]);
  await both('UPDATE articles SET read_at=? WHERE id=1', [now + 1]);
  const changes = await rows('agent_action_changes'),
    before = await rows('articles');
  expect(() => node.sqlite.transaction(() => native.restore(1))()).toThrow('changed after');
  await expect(
    new CloudflareActionJournal(new CloudflareStorage(db)).restore(1, now, { after: finish(1) }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await rows('articles')).toEqual(before);
  expect(await rows('agent_action_changes')).toEqual(changes);
  await inactive();
});

it('shares named-tag ownership and leaves reusable rule-created definitions after Undo', async () => {
  for (const [id, tool, name] of [
    [1, 'apply_rule', 'Reusable'],
    [2, 'tag_item', 'Owned'],
  ] as const) {
    await addReceipt(id, tool);
    await write(id, [
      { sql: "INSERT INTO tags(name,color) VALUES(?,'#b45309')", values: [name] },
      { sql: 'INSERT INTO article_tags SELECT 2,id FROM tags WHERE name=?', values: [name] },
    ]);
    await restore(id);
    await equivalent();
  }
  expect((await rows('tags')).map((row) => row.name)).toEqual(['Saved', 'Reusable']);
  await inactive();
});

it.each(['article', 'brew', 'rule', 'folder', 'tag', 'history'] as const)(
  'protects later %s uses while reversing inserted parents',
  async (kind) => {
    const tool = kind === 'tag' ? 'tag_item' : kind === 'history' ? 'copy_rule' : 'import_opml';
    await addReceipt(1, tool);
    if (kind === 'tag') {
      await write(1, [{ sql: "INSERT INTO tags(id,name,color) VALUES(9,'New','#000000')" }]);
      await both('INSERT INTO article_tags VALUES(2,9)');
    } else if (kind === 'history') {
      await write(1, [
        {
          sql: "INSERT INTO rules(id,name,match_type,scope_json,conditions_json,actions_json,created_at,updated_at) VALUES(9,'Copy','all','{}','[]','[]',1795780800000,1795780800000)",
        },
      ]);
      await both(
        "INSERT INTO rule_logs(rule_id,article_id,actions_taken_json,executed_at) VALUES(9,2,'[]',1795780800000)",
      );
    } else {
      await write(1, [
        { sql: "INSERT INTO folders(id,title,created_at) VALUES(9,'Imported',1795780800000)" },
        {
          sql: "INSERT INTO feeds(id,url,title,folder_id,created_at) VALUES(9,'https://new.example.test/rss','Imported',9,1795780800000)",
        },
      ]);
      if (kind === 'article')
        await both(
          `INSERT INTO articles(feed_id,guid,hash,title,url,published_at,fetched_at) VALUES(9,'new','new','Later','https://new.example.test/later',${now},${now})`,
        );
      if (kind === 'brew')
        await both(
          "INSERT INTO brew_configs(name,sections_json,created_at) VALUES('Later',?,1795780800000)",
          [JSON.stringify([{ id: 'saved', sources: [{ kind: 'feed', id: 9 }] }])],
        );
      if (kind === 'rule')
        await both('UPDATE rules SET scope_json=? WHERE id=1', [JSON.stringify({ feedIds: [9] })]);
      if (kind === 'folder')
        await both(
          "INSERT INTO feeds(url,title,folder_id,created_at) VALUES('https://later.example.test/rss','Later',9,1795780800000)",
        );
    }
    expect(() => node.sqlite.transaction(() => native.restore(1))()).toThrow();
    await expect(
      new CloudflareActionJournal(new CloudflareStorage(db)).restore(1, now),
    ).rejects.toMatchObject({ status: 409 });
    await equivalent();
    await inactive();
  },
);

it('keeps simultaneous journals isolated and restores one field while preserving the other action', async () => {
  await addReceipt(1);
  await addReceipt(2);
  const requests = [
    {
      actionId: 1,
      at: now,
      queries: [{ sql: 'UPDATE articles SET read_at=? WHERE id=1', values: [now] }],
    },
    {
      actionId: 2,
      at: now,
      queries: [{ sql: 'UPDATE articles SET starred_at=? WHERE id=1', values: [now] }],
    },
  ];
  const responses = await Promise.all(
    requests.map((input) =>
      worker.fetch('https://journal.example.test/write', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    ),
  );
  for (const response of responses)
    expect(response.status, await response.clone().text()).toBe(200);
  const changes = await rows('agent_action_changes');
  expect(changes).toHaveLength(2);
  expect(changes.find((row) => row.action_id === 1)!.after_json).toBe(
    JSON.stringify({ read_at: now }),
  );
  expect(changes.find((row) => row.action_id === 2)!.after_json).toBe(
    JSON.stringify({ starred_at: now }),
  );
  await new CloudflareActionJournal(new CloudflareStorage(db)).restore(1, now, {
    after: finish(1),
  });
  expect((await rows('articles'))[0]!.read_at).toBeNull();
  expect((await rows('articles'))[0]!.starred_at).toBe(now);
  await inactive();
});

it('checks the same snapshot at commit, including new child rows and newly saved references', async () => {
  await addReceipt(1, 'import_opml');
  await write(1, [
    {
      sql: "INSERT INTO feeds(id,url,title,created_at) VALUES(9,'https://new.example.test/rss','Imported',1795780800000)",
    },
  ]);
  class RacingStorage extends CloudflareStorage {
    fired = false;
    override async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
      if (!this.fired && statements.length >= 3) {
        this.fired = true;
        await db
          .prepare('UPDATE rules SET scope_json=? WHERE id=1')
          .bind(JSON.stringify({ feedIds: [9] }))
          .run();
      }
      return super.batch<T>(statements);
    }
  }
  const storage = new RacingStorage(db);
  await expect(
    new CloudflareActionJournal(storage).restore(1, now, { after: finish(1) }),
  ).rejects.toMatchObject({ status: 409 });
  expect(storage.fired).toBe(true);
  expect((await rows('feeds')).some((row) => row.id === 9)).toBe(true);
  expect(await rows('agent_action_changes')).toHaveLength(1);
  await inactive();
});

it('reverses a unique-name swap in exact short-journal order', async () => {
  await both("INSERT INTO tags(id,name,color) VALUES(2,'Other','#000000')");
  await addReceipt(1, 'tag_item');
  await write(1, [
    { sql: "UPDATE tags SET name='Temporary' WHERE id=1" },
    { sql: "UPDATE tags SET name='Saved' WHERE id=2" },
    { sql: "UPDATE tags SET name='Other' WHERE id=1" },
  ]);
  await restore(1);
  await equivalent();
  await inactive();
});

it('restores 50000 read changes inside workerd with bounded queries and bindings within D1 limits', async () => {
  const seed = `WITH RECURSIVE ids(id) AS (SELECT 1000 UNION ALL SELECT id+1 FROM ids WHERE id<50999) INSERT INTO articles(id,feed_id,guid,hash,title,url,published_at,fetched_at) SELECT id,1,'g-'||id,'h-'||id,'Bulk '||id,'https://source.example.test/'||id,${now},${now} FROM ids`;
  node.sqlite.exec(seed);
  await db.exec(seed);
  await addReceipt(1, 'mark_read');
  await write(1, [{ sql: 'UPDATE articles SET read_at=? WHERE id>=1000', values: [now] }]);
  const result = await restore(1);
  expect(result.statements).toBeLessThanOrEqual(40);
  expect(result.largestBinding).toBeLessThan(2000000);
  expect(
    (await db
      .prepare('SELECT count(*) AS n FROM articles WHERE id>=1000 AND read_at IS NULL')
      .first<{ n: number }>())!.n,
  ).toBe(50000);
  expect(await rows('agent_action_changes')).toEqual([]);
  await inactive();
}, 30000);
