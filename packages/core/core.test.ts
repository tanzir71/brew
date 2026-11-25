import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { build } from 'vite';
import { parseFeedDocument } from './src/feed-parser.js';
import { RulesService } from './src/rules-service.js';
import type { ArticleContext, ClockPort, RuleStoragePort } from './src/ports.js';
import type { RuleRecord } from './src/types/rules.js';

describe('portable core boundary', () => {
  it('bundles the entire core for browsers without Node shims or adapters', async () => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'reject-platform-imports',
          resolveId(id) {
            if (
              id.startsWith('node:') ||
              /^(better-sqlite3|fastify|rss-parser|node-cron)(\/|$)/.test(id)
            )
              throw new Error(`Platform dependency in core: ${id}`);
          },
        },
      ],
      build: {
        write: false,
        minify: false,
        lib: {
          entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
          formats: ['es'],
          fileName: 'core',
        },
      },
    });
    const bundles = Array.isArray(result) ? result : [result];
    const code = bundles
      .flatMap((bundle) => ('output' in bundle ? bundle.output : []))
      .filter((chunk) => chunk.type === 'chunk')
      .map((chunk) => chunk.code)
      .join('\n');
    expect(code.includes('RulesService')).toBe(true);
    expect(code.includes('__vite-browser-external')).toBe(false);
  });

  it('parses supplied content without network access and delegates XML to its parser port', async () => {
    const xml = {
      parse: vi.fn(async () => ({ title: 'From XML', items: [{ guid: 'xml', title: 'A story' }] })),
    };
    const now = () => new Date('2026-11-25T08:00:00Z');
    const json = await parseFeedDocument(
      JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', items: [{ id: 'json' }] }),
      '',
      xml,
      now,
    );
    expect(json.articles[0]?.publishedAt).toEqual(now());
    expect(xml.parse).not.toHaveBeenCalled();
    expect((await parseFeedDocument('<rss/>', '', xml, now)).title).toBe('From XML');
    expect(xml.parse).toHaveBeenCalledWith('<rss/>');
  });

  it('evaluates scoped rules, delegates regex, logs changes and stops using only ports', async () => {
    const context: ArticleContext = {
      id: 4,
      title: 'Design notes',
      content: '',
      author: '',
      url: 'https://example.test/4',
      feedId: 2,
      feed: 'Design',
      folderId: null,
      folder: '',
    };
    const rule: RuleRecord = {
      id: 1,
      name: 'Design',
      enabled: true,
      position: 0,
      matchType: 'all',
      scope: { feedIds: [2] },
      conditions: [{ field: 'title', operator: 'matches_regex', value: '^Design' }],
      actions: [{ type: 'star' }],
      stopProcessing: true,
    };
    const storage: RuleStoragePort = {
      context: () => context,
      definitions: () => [rule, { ...rule, id: 2 }],
      list: () => [rule, { ...rule, id: 2 }],
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      addTag: vi.fn(),
      removeTag: vi.fn(),
      updateArticle: vi.fn(),
      log: vi.fn(),
      logs: () => [],
      articleIds: () => [4],
      publishedAt: () => new Date(),
    };
    const clock: ClockPort = { now: () => new Date('2026-11-25T08:00:00Z'), monotonic: () => 0 };
    const regex = { test: vi.fn(async () => ({ matched: true, timedOut: false })) };
    const network = { fetch: vi.fn() };
    const engine = new RulesService(storage, regex, network, { notify: vi.fn() }, clock);
    expect(await engine.evaluateArticle(4)).toBe(1);
    expect(regex.test).toHaveBeenCalledWith('^Design', 'Design notes', 500);
    expect(storage.updateArticle).toHaveBeenCalledWith(4, { starredAt: clock.now() });
    expect(storage.log).toHaveBeenCalledTimes(1);
    expect(network.fetch).not.toHaveBeenCalled();
  });
});
