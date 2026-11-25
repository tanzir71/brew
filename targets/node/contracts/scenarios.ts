import type { InjectOptions } from 'fastify';
import type { BrewDatabase } from '../src/db/database.js';
import { articles, brewConfigs, feeds, folders, rules, tags } from '../src/db/schema.js';

export const contractNow = '2026-11-25T12:00:00.000Z';
export const rss =
  '<?xml version="1.0"?><rss version="2.0"><channel><title>Contract feed</title><link>https://contract.test</link><description>Feed description</description><item><guid>new</guid><link>https://contract.test/new</link><title>New design story</title><pubDate>Wed, 25 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>';
export const brewDraft = {
  name: 'Weekend',
  scheduleCron: '0 7 * * *',
  enabled: true,
  sections: [
    {
      id: 'one',
      title: 'Stories',
      source: 'feed',
      sourceId: 1,
      maxItems: 5,
      layout: 'list',
      sort: 'newest',
      onlyUnread: false,
    },
  ],
};
export const ruleDraft = {
  name: 'Design',
  enabled: true,
  matchType: 'all',
  scope: {},
  conditions: [{ field: 'title', operator: 'contains', value: 'Design' }],
  actions: [{ type: 'star' }],
  stopProcessing: false,
};
export const opml =
  '<?xml version="1.0"?><opml version="2.0"><body><outline text="New folder"><outline type="rss" text="Imported" xmlUrl="https://import.test/feed"/></outline></body></opml>';

export function seedContractDatabase(database: BrewDatabase): void {
  database.db.insert(folders).values({ id: 1, title: 'Design', position: 0 }).run();
  database.db
    .insert(feeds)
    .values({
      id: 1,
      title: 'Journal',
      url: 'https://contract.test/feed',
      siteUrl: 'https://contract.test',
      folderId: 1,
    })
    .run();
  database.db
    .insert(articles)
    .values([
      {
        id: 1,
        feedId: 1,
        guid: 'one',
        title: 'Design story',
        url: 'https://contract.test/one',
        contentHtml: '<p>Thoughtful reading.</p>',
        publishedAt: new Date('2026-11-25T10:00:00Z'),
        hash: 'one',
      },
      {
        id: 2,
        feedId: 1,
        guid: 'two',
        title: 'Earlier story',
        url: 'https://contract.test/two',
        publishedAt: new Date('2026-11-23T10:00:00Z'),
        starredAt: new Date('2026-11-24T10:00:00Z'),
        hash: 'two',
      },
      {
        id: 3,
        feedId: 1,
        guid: 'three',
        title: 'Hidden story',
        url: 'https://contract.test/three',
        publishedAt: new Date('2026-11-25T09:00:00Z'),
        hidden: true,
        hash: 'three',
      },
    ])
    .run();
  database.db.insert(tags).values({ id: 1, name: 'Keep', color: '#123456' }).run();
  database.db
    .insert(rules)
    .values({
      id: 1,
      name: ruleDraft.name,
      enabled: true,
      matchType: 'all',
      scopeJson: '{}',
      conditionsJson: JSON.stringify(ruleDraft.conditions),
      actionsJson: JSON.stringify(ruleDraft.actions),
      stopProcessing: false,
    })
    .run();
  database.db
    .insert(brewConfigs)
    .values({
      id: 1,
      name: brewDraft.name,
      scheduleCron: brewDraft.scheduleCron,
      enabled: true,
      sectionsJson: JSON.stringify(brewDraft.sections),
    })
    .run();
}

export const contractFetcher: typeof fetch = async (input) => {
  const url = input.toString();
  if (url.includes('favicon.ico') || url.includes('/image'))
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  if (url.includes('/audio'))
    return new Response(new Uint8Array([4, 5, 6]), { headers: { 'content-type': 'audio/mpeg' } });
  if (url.includes('/broken')) return new Response('', { status: 503 });
  return new Response(rss, { headers: { 'content-type': 'application/rss+xml' } });
};

interface Scenario {
  name: string;
  request: InjectOptions;
}
const get = (name: string, url: string): Scenario => ({ name, request: { method: 'GET', url } });
const send = (
  name: string,
  method: InjectOptions['method'],
  url: string,
  payload?: unknown,
): Scenario => ({
  name,
  request: {
    method,
    url,
    ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }),
  },
});

export const scenarios: Scenario[] = [
  get('health', '/api/health'),
  get('feeds', '/api/feeds'),
  get('folders', '/api/folders'),
  send('discover', 'POST', '/api/feeds/discover', { url: 'https://contract.test/feed' }),
  send('discover missing url', 'POST', '/api/feeds/discover', {}),
  send('add feed', 'POST', '/api/feeds', { url: 'https://new.test/feed', folderId: 1 }),
  send('duplicate feed', 'POST', '/api/feeds', { url: 'https://contract.test/feed' }),
  send('invalid feed URL', 'POST', '/api/feeds', { url: 'file:///secret' }),
  send('rename feed', 'PATCH', '/api/feeds/1', { title: 'Renamed', folderId: null }),
  send('rename missing feed', 'PATCH', '/api/feeds/99', { title: 'Missing' }),
  send('rename blank feed', 'PATCH', '/api/feeds/1', { title: ' ' }),
  send('delete feed', 'DELETE', '/api/feeds/1'),
  send('delete missing feed', 'DELETE', '/api/feeds/99'),
  send('retention', 'PATCH', '/api/feeds/1/retention', { days: 30 }),
  send('invalid retention', 'PATCH', '/api/feeds/1/retention', { days: 0 }),
  get('favicon', '/api/feeds/1/icon'),
  get('missing favicon', '/api/feeds/99/icon'),
  send('create folder', 'POST', '/api/folders', { title: 'New' }),
  send('blank folder', 'POST', '/api/folders', {}),
  send('rename folder', 'PATCH', '/api/folders/1', { title: 'New name' }),
  send('rename missing folder', 'PATCH', '/api/folders/99', { title: 'New name' }),
  send('delete folder', 'DELETE', '/api/folders/1'),
  send('delete missing folder', 'DELETE', '/api/folders/99'),
  get('navigation', '/api/reader/navigation'),
  get('articles', '/api/articles'),
  get('today', '/api/articles?view=today'),
  get('starred', '/api/articles?view=starred'),
  get('oldest filtered page', '/api/articles?feedId=1&folderId=1&limit=1&unread=true&sort=oldest'),
  get('invalid view', '/api/articles?view=bad'),
  get('invalid sort', '/api/articles?sort=bad'),
  get('invalid cursor', '/api/articles?cursor=bad'),
  get('article', '/api/articles/1'),
  get('missing article', '/api/articles/99'),
  send('mark article', 'PATCH', '/api/articles/1', { read: true, starred: true }),
  send('invalid article state', 'PATCH', '/api/articles/1', {}),
  send('missing article state', 'PATCH', '/api/articles/99', { read: true }),
  get('hidden articles', '/api/articles-hidden'),
  send('unhide', 'POST', '/api/articles/3/unhide'),
  send('unhide missing', 'POST', '/api/articles/99/unhide'),
  send('bulk read', 'POST', '/api/articles/mark-all-read', { view: 'all' }),
  send('invalid bulk view', 'POST', '/api/articles/mark-all-read', { view: 'bad' }),
  send('undo missing token', 'POST', '/api/articles/mark-all-read/undo', {}),
  send('undo expired token', 'POST', '/api/articles/mark-all-read/undo', { undoToken: 'expired' }),
  send('missing full text', 'POST', '/api/articles/99/full-text'),
  get('tags', '/api/tags'),
  send('create tag', 'POST', '/api/tags', { name: 'Read next' }),
  send('blank tag', 'POST', '/api/tags', {}),
  send('set tags', 'PUT', '/api/articles/1/tags', { tagIds: [1] }),
  send('unknown tag', 'PUT', '/api/articles/1/tags', { tagIds: [99] }),
  send('invalid tags', 'PUT', '/api/articles/1/tags', { tagIds: 'one' }),
  get('search', '/api/search?q=Design'),
  get('folder search', '/api/search?q=story&scope=folder&folderId=1&limit=1&offset=0'),
  get('invalid search scope', '/api/search?q=story&scope=bad'),
  get('search missing folder', '/api/search?q=story&scope=folder'),
  get('duplicate filter', '/api/rules/duplicate-filter'),
  send('set duplicate filter', 'PUT', '/api/rules/duplicate-filter', { enabled: true }),
  get('rules', '/api/rules'),
  send('create rule', 'POST', '/api/rules', ruleDraft),
  send('invalid rule', 'POST', '/api/rules', { ...ruleDraft, name: '' }),
  send('update rule', 'PUT', '/api/rules/1', { ...ruleDraft, name: 'Renamed' }),
  send('missing rule', 'PUT', '/api/rules/99', ruleDraft),
  send('delete rule', 'DELETE', '/api/rules/1'),
  send('delete missing rule', 'DELETE', '/api/rules/99'),
  get('rule logs', '/api/rules/1/logs'),
  send('preview rule', 'POST', '/api/rules/preview', ruleDraft),
  send('apply rule', 'POST', '/api/rules/1/apply', { days: 30 }),
  send('apply missing rule', 'POST', '/api/rules/99/apply', {}),
  get('brew configs', '/api/brew-configs'),
  send('create Brew', 'POST', '/api/brew-configs', brewDraft),
  send('invalid Brew', 'POST', '/api/brew-configs', { ...brewDraft, name: '' }),
  send('update Brew', 'PUT', '/api/brew-configs/1', { ...brewDraft, name: 'Updated' }),
  send('missing Brew', 'PUT', '/api/brew-configs/99', brewDraft),
  send('delete Brew', 'DELETE', '/api/brew-configs/1'),
  send('delete missing Brew', 'DELETE', '/api/brew-configs/99'),
  send('generate Brew', 'POST', '/api/brew-configs/1/generate'),
  send('generate missing Brew', 'POST', '/api/brew-configs/99/generate'),
  get('history', '/api/brew-configs/1/history'),
  get('missing snapshot', '/api/brews/99'),
  send('scroll', 'PUT', '/api/brews/1/scroll', { position: 42 }),
  get('OPML export', '/api/opml/export'),
  {
    name: 'OPML import',
    request: {
      method: 'POST',
      url: '/api/opml/import',
      payload: opml,
      headers: { 'content-type': 'text/x-opml' },
    },
  },
  {
    name: 'invalid OPML',
    request: {
      method: 'POST',
      url: '/api/opml/import',
      payload: 'bad',
      headers: { 'content-type': 'application/xml' },
    },
  },
  send('poll', 'POST', '/api/feeds/1/fetch'),
  send('poll missing feed', 'POST', '/api/feeds/99/fetch'),
  get('image', '/api/img?src=https%3A%2F%2Fcontract.test%2Fimage'),
  get('image without src', '/api/img'),
  get('invalid image URL', '/api/img?src=file%3A%2F%2Fsecret'),
  get('audio', '/api/media?src=https%3A%2F%2Fcontract.test%2Faudio'),
  get('missing audio', '/api/media'),
  get('unknown API route', '/api/unknown'),
  send('unsupported method', 'POST', '/api/health'),
  {
    name: 'malformed JSON',
    request: {
      method: 'POST',
      url: '/api/feeds',
      payload: '{',
      headers: { 'content-type': 'application/json' },
    },
  },
  {
    name: 'empty JSON',
    request: {
      method: 'POST',
      url: '/api/feeds',
      payload: '',
      headers: { 'content-type': 'application/json' },
    },
  },
  {
    name: 'unsupported content type',
    request: {
      method: 'POST',
      url: '/api/feeds',
      payload: 'x',
      headers: { 'content-type': 'application/octet-stream' },
    },
  },
  send('invalid Brew update', 'PUT', '/api/brew-configs/1', { ...brewDraft, name: '' }),
  { name: 'HEAD health', request: { method: 'HEAD', url: '/api/health' } },
];

const volatile = new Set([
  'createdAt',
  'generatedAt',
  'lastFetchedAt',
  'readAt',
  'starredAt',
  'expiresAt',
  'executedAt',
]);
export function normalize(value: unknown, key = ''): unknown {
  if (value === null) return null;
  if (volatile.has(key)) {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
      !Number.isFinite(Date.parse(value))
    )
      throw new Error(`Invalid timestamp in ${key}`);
    return '<timestamp>';
  }
  if (key === 'durationMs') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw new Error('Invalid search timing');
    return '<duration>';
  }
  if (key === 'undoToken') {
    if (typeof value !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value))
      throw new Error('Invalid undo token');
    return '<token>';
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, normalize(item, name)]),
    );
  return value;
}

export function responseContract(response: {
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
  rawPayload: Uint8Array;
}) {
  const names = [
    'content-type',
    'content-disposition',
    'cache-control',
    'content-security-policy',
    'x-content-type-options',
    'referrer-policy',
    'server-timing',
  ];
  const headers = Object.fromEntries(
    names
      .filter((name) => response.headers[name] !== undefined)
      .map((name) => [
        name,
        name === 'server-timing' ? 'search;dur=<duration>' : response.headers[name],
      ]),
  );
  const type = String(response.headers['content-type'] ?? '');
  const body =
    type.includes('application/json') && response.body
      ? normalize(JSON.parse(response.body))
      : type.startsWith('image/') || type.startsWith('audio/')
        ? [...response.rawPayload]
        : response.body;
  return { status: response.statusCode, headers, body };
}
