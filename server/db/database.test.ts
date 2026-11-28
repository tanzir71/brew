import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('database migrations', () => {
  it('creates every canonical table and can reopen idempotently', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brew-db-'));
    temporaryDirectories.push(directory);
    const filename = path.join(directory, 'brew.db');
    const first = openDatabase(filename);
    const tables = first.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'folders',
        'feeds',
        'articles',
        'tags',
        'article_tags',
        'rules',
        'rule_logs',
        'brew_configs',
        'brews',
        'settings',
        'agent_actions',
        'agent_action_changes',
        'api_tokens',
        'reader_access',
        'reader_sessions',
        'instance_events',
        'feed_poll_leases',
        'ingest_jobs',
        'ingest_job_items',
        'ingest_job_guard',
        'brew_schedule_jobs',
        'brew_schedule_guard',
        'brew_schedule_candidates',
        'brew_schedule_captures',
        'brew_schedule_configs',
        '__brew_library_identity',
        '__brew_archive_jobs',
        '__brew_archive_rows',
        '__brew_archive_check',
      ]),
    );
    first.close();
    const second = openDatabase(filename);
    try {
      expect(
        second.sqlite.prepare('SELECT count(*) AS count FROM __brew_migrations').get(),
      ).toEqual({ count: 20 });
    } finally {
      second.close();
    }
  });
});
