import type { Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { documented, errors, response } from '../openapi.js';
import { json } from '../http.js';
import {
  ReaderSyncError,
  syncId,
  type SyncQuery,
  type SyncPatch,
} from '../../../core/src/reader-sync.js';
import { sanitizeArticleHtml } from '../../../core/src/html-sanitizer.js';
import { integer, readerPort, syncBoundary, syncFailure, syncParameters } from './shared.js';

export function registerFever(app: Hono, services: ApiServices) {
  for (const method of ['get', 'post'] as const)
    for (const path of ['/api/fever', '/api/fever/'])
      app[method](
        path,
        documented('Reader apps', 'Fever API v3: authenticate and synchronize', {
          operationId: `${method}_api_fever${path.endsWith('/') ? '_slash' : ''}`,
          description:
            'App-password authentication uses api_key=MD5(username:password), normally in a URL-encoded POST. The server stores only a SHA-256 verifier of that key. Authentication failure returns HTTP 200 with auth:0. Read selectors may be combined. Writes require POST and use explicit read/unread/saved/unsaved state; they are idempotent. Hidden articles and raw newsletter originals are excluded.',
          ...(method === 'post'
            ? {
                requestBody: {
                  required: true,
                  content: {
                    'application/x-www-form-urlencoded': {
                      schema: {
                        type: 'object',
                        properties: {
                          api_key: { type: 'string' },
                          mark: { type: 'string' },
                          as: { type: 'string' },
                          id: { type: 'string' },
                          before: { type: 'string' },
                        },
                        additionalProperties: true,
                      },
                    },
                  },
                },
              }
            : {}),
          responses: {
            200: response({ type: 'object' }),
            ...errors(400, 403, 413, 415, 429, 501, 503),
          },
        }),
        async (c) => {
          c.header('Cache-Control', 'private, no-store');
          c.header('X-Robots-Tag', 'noindex, nofollow');
          try {
            syncBoundary(c, services.outputBaseUrl);
            const port = await readerPort(services),
              p = await syncParameters(c),
              session = await port.access.fever(p.get('api_key') ?? '');
            if (!session) return json(c, { api_version: 3, auth: 0 });
            if (p.has('mark')) {
              if (c.req.method !== 'POST')
                throw new ReaderSyncError(400, 'Use POST for Fever state changes.');
              const scope = p.get('mark'),
                state = p.get('as');
              let q: SyncQuery, patch: SyncPatch;
              if (scope === 'item') {
                q = { ids: [syncId(p.get('id') ?? '')] };
                if (!['read', 'unread', 'saved', 'unsaved'].includes(state ?? ''))
                  throw new ReaderSyncError(400, 'Choose a Fever item state.');
                patch = ['read', 'unread'].includes(state!)
                  ? { read: state === 'read' }
                  : { starred: state === 'saved' };
              } else if (scope === 'feed' || scope === 'group') {
                if (state !== 'read')
                  throw new ReaderSyncError(400, 'Feeds and groups support marking read.');
                const id = integer(p.get('id'), -1);
                if (id < 0 || (scope === 'feed' && !id))
                  throw new ReaderSyncError(400, 'Choose a Fever feed or group.');
                q = {
                  streams: [
                    scope === 'feed'
                      ? { kind: 'feed', id }
                      : id
                        ? { kind: 'folder', id }
                        : { kind: 'all' },
                  ],
                  before:
                    integer(
                      p.get('before'),
                      Math.floor(port.storage.now() / 1000),
                      8_640_000_000_000,
                    ) * 1000,
                };
                patch = { read: true };
              } else throw new ReaderSyncError(400, 'Unsupported Fever mark scope.');
              await port.storage.change({ ...q, generation: session.generation }, patch);
            }
            const result: Record<string, unknown> = {
              api_version: 3,
              auth: 1,
              last_refreshed_on_time: Math.floor(port.storage.now() / 1000),
            };
            if (p.has('groups') || p.has('feeds') || p.has('items')) {
              const meta = await port.storage.metadata();
              if (p.has('groups'))
                result.groups = meta.folders.map((folder) => ({
                  id: folder.id,
                  title: folder.title,
                }));
              if (p.has('feeds'))
                result.feeds = meta.feeds.map((feed) => ({
                  id: feed.id,
                  favicon_id: 0,
                  title: feed.title,
                  url: feed.url,
                  site_url: feed.siteUrl ?? feed.url,
                  is_spark: 0,
                  last_updated_on_time: Math.floor(feed.updated / 1000),
                }));
              if (p.has('groups') || p.has('feeds'))
                result.feeds_groups = meta.folders.map((folder) => ({
                  group_id: folder.id,
                  feed_ids: meta.feeds
                    .filter((feed) => feed.folderId === folder.id)
                    .map((feed) => feed.id)
                    .join(','),
                }));
              if (p.has('items')) {
                const q: SyncQuery = { limit: 50, byId: true, oldest: false };
                if (p.has('since_id')) {
                  q.afterId = integer(p.get('since_id'), 0);
                  q.oldest = true;
                } else if (p.has('max_id')) {
                  const before = integer(p.get('max_id'), 0);
                  if (before) q.beforeId = before;
                } else if (p.has('with_ids')) {
                  const values = (p.get('with_ids') ?? '').split(',').filter(Boolean);
                  if (values.length > 50)
                    throw new ReaderSyncError(400, 'Choose at most 50 Fever items.');
                  q.ids = [...new Set(values.map(syncId))];
                }
                const page = await port.storage.items(q);
                result.total_items = meta.totalItems;
                result.items = page.items.map((item) => ({
                  id: item.id,
                  feed_id: item.feedId,
                  title: item.title,
                  author: item.author ?? '',
                  html: sanitizeArticleHtml(item.html) ?? '',
                  url: item.url,
                  is_saved: item.starred ? 1 : 0,
                  is_read: item.read ? 1 : 0,
                  created_on_time: Math.floor(item.published / 1000),
                }));
              }
            }
            if (p.has('favicons')) result.favicons = [];
            if (p.has('links')) result.links = [];
            if (p.has('unread_item_ids'))
              result.unread_item_ids = (await port.storage.stateIds('unread')).join(',');
            if (p.has('saved_item_ids'))
              result.saved_item_ids = (await port.storage.stateIds('starred')).join(',');
            return json(c, result);
          } catch (error) {
            return syncFailure(c, error);
          }
        },
      );
}
