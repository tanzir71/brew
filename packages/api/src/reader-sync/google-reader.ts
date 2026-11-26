import type { Context, Hono } from 'hono';
import type { ApiServices } from '../ports.js';
import { documented, errors, response, query as queryParameter } from '../openapi.js';
import { json } from '../http.js';
import {
  ReaderSyncError,
  googleItemId,
  googleLabel,
  googleState,
  syncId,
  syncStream,
  type ReaderSession,
  type ReaderSyncPort,
  type SyncItem,
  type SyncPatch,
  type SyncQuery,
} from '../../../core/src/reader-sync.js';
import { sanitizeArticleHtml } from '../../../core/src/html-sanitizer.js';
import {
  integer,
  readerActionContext,
  readerPort,
  readerSession,
  syncBoundary,
  syncFailure,
  syncParameters,
} from './shared.js';

const base = '/api/greader',
  prefix = `${base}/reader/api/0`;
const ids = (p: URLSearchParams) => {
  const values = p.getAll('i');
  if (values.length > 10_000) throw new ReaderSyncError(413, 'Choose at most 10000 Reader items.');
  return [...new Set(values.map(syncId))];
};
function query(p: URLSearchParams, stream?: string): SyncQuery {
  const s = stream ? [stream] : p.getAll('s');
  if (s.length > 100 || p.getAll('xt').length > 100)
    throw new ReaderSyncError(400, 'Too many Reader streams.');
  const seconds = (name: string) =>
    p.has(name) ? integer(p.get(name), 0, 8_640_000_000_000) * 1000 : undefined;
  return {
    streams: s.length ? s.map(syncStream) : [{ kind: 'all' }],
    exclude: p.getAll('xt').map(syncStream),
    limit: Math.max(1, Math.min(integer(p.get('n'), 1000), 10_000)),
    oldest: p.get('r') === 'o',
    fetchedAfter: seconds('ot'),
    fetchedBefore: seconds('nt'),
    cursor: p.get('c') ?? undefined,
  };
}
const entry = (item: SyncItem) => ({
  id: googleItemId(item.id),
  crawlTimeMsec: String(item.fetched),
  timestampUsec: String(BigInt(item.fetched) * 1000n),
  published: Math.floor(item.published / 1000),
  updated: Math.floor(item.fetched / 1000),
  title: item.title,
  author: item.author ?? '',
  summary: { direction: 'ltr', content: sanitizeArticleHtml(item.html) ?? '' },
  canonical: [{ href: item.url }],
  alternate: [{ href: item.url, type: 'text/html' }],
  origin: {
    streamId: `feed/${item.feedId}`,
    title: item.feedTitle,
    htmlUrl: item.siteUrl ?? item.feedUrl,
  },
  categories: [
    googleState('reading-list'),
    ...(item.read ? [googleState('read')] : []),
    ...(item.starred ? [googleState('starred')] : []),
    ...new Set([...(item.folder ? [googleLabel(item.folder)] : []), ...item.tags.map(googleLabel)]),
  ],
});
function patch(p: URLSearchParams): SyncPatch {
  const result: SyncPatch = { add: [], remove: [] };
  for (const [key, enabled] of [
    ['a', true],
    ['r', false],
  ] as const)
    for (const value of p.getAll(key)) {
      const state = value.replace(/^user\/(?:-|1)\/state\/com\.google\//, '');
      if (['broadcast', 'like', 'tracking-kept-unread'].includes(state)) continue;
      const field = ['read', 'kept-unread'].includes(state)
        ? 'read'
        : state === 'starred'
          ? 'starred'
          : null;
      if (field) {
        const desired = state === 'kept-unread' ? !enabled : enabled;
        if (result[field] !== undefined && result[field] !== desired)
          throw new ReaderSyncError(400, 'Conflicting Reader state changes.');
        result[field] = desired;
      } else {
        const label = syncStream(value);
        if (label.kind !== 'label' || label.name.length > 100)
          throw new ReaderSyncError(400, 'Unsupported Reader item tag.');
        (enabled ? result.add! : result.remove!).push(label.name);
      }
    }
  if (result.add!.some((name) => result.remove!.includes(name)))
    throw new ReaderSyncError(400, 'Conflicting Reader labels.');
  return result;
}
async function subscriptionAction(
  c: Context,
  services: ApiServices,
  session: ReaderSession,
  input: Parameters<NonNullable<ApiServices['actions']>['run']>[0],
) {
  if (!services.actions) throw new ReaderSyncError(501, 'Subscription actions need setup.');
  const receipt = await services.actions.run(input, readerActionContext(c, session));
  await services.readerSync?.storage.notify();
  c.header('X-Brew-Undo-Id', String(receipt.id));
  return receipt;
}
async function dispatch(
  c: Context,
  services: ApiServices,
  port: ReaderSyncPort,
  p: URLSearchParams,
  session: ReaderSession,
  operation: string,
  stream?: string,
): Promise<Response> {
  if (operation === 'token') return c.text(await port.access.writeToken(session));
  if (operation === 'user-info')
    return json(c, {
      userId: '1',
      userName: session.username,
      userProfileId: '1',
      userEmail: session.username,
      isBloggerUser: false,
    });
  if (
    operation === 'subscription/list' ||
    operation === 'tag/list' ||
    operation === 'unread-count'
  ) {
    const meta = await port.storage.metadata();
    if (operation === 'tag/list') {
      const names = [
        ...new Set([...meta.folders.map((f) => f.title), ...meta.tags.map((t) => t.name)]),
      ].sort();
      return json(c, {
        tags: [
          { id: googleState('reading-list') },
          { id: googleState('starred') },
          ...names.map((name) => ({ id: googleLabel(name), type: 'folder', label: name })),
        ],
      });
    }
    if (operation === 'subscription/list')
      return json(c, {
        subscriptions: meta.feeds.map((feed) => ({
          id: `feed/${feed.id}`,
          title: feed.title,
          url: feed.url,
          htmlUrl: feed.siteUrl ?? feed.url,
          iconUrl: feed.faviconUrl ?? '',
          categories: meta.folders
            .filter((f) => f.id === feed.folderId)
            .map((f) => ({ id: googleLabel(f.title), label: f.title, type: 'folder' })),
          firstitemmsec: '0',
          sortid: feed.id.toString(16).padStart(8, '0'),
        })),
      });
    return json(c, {
      max: meta.totalUnread,
      unreadcounts: [
        {
          id: googleState('reading-list'),
          count: meta.totalUnread,
          newestItemTimestampUsec: String(BigInt(meta.newestUnread) * 1000n),
        },
        ...meta.feeds.map((f) => ({
          id: `feed/${f.id}`,
          count: f.unread,
          newestItemTimestampUsec: '0',
        })),
        ...meta.folders.map((folder) => ({
          id: googleLabel(folder.title),
          count: meta.feeds
            .filter((f) => f.folderId === folder.id)
            .reduce((sum, f) => sum + f.unread, 0),
          newestItemTimestampUsec: '0',
        })),
      ],
    });
  }
  if (operation === 'stream/items/ids') {
    const page = await port.storage.items({ ...query(p), idsOnly: true });
    return json(c, {
      itemRefs: page.items.map((item) => ({
        id: String(item.id),
        directStreamIds: [`feed/${item.feedId}`],
      })),
      ...(page.continuation ? { continuation: page.continuation } : {}),
    });
  }
  if (operation === 'stream/items/contents' || operation === 'stream/contents') {
    const selected = operation === 'stream/items/contents' ? ids(p) : undefined;
    const q = selected ? { ids: selected, limit: 10_000 } : query(p, stream);
    const page = await port.storage.items(q);
    const byId = new Map(page.items.map((item) => [item.id, item]));
    const items = selected
      ? selected.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
      : page.items;
    return json(c, {
      id: p.get('s') ?? stream ?? googleState('reading-list'),
      title: 'Brew',
      updated: Math.floor(port.storage.now() / 1000),
      direction: 'ltr',
      items: items.map(entry),
      ...(page.continuation ? { continuation: page.continuation } : {}),
    });
  }
  if (operation === 'edit-tag') {
    const selected = ids(p);
    if (!selected.length) throw new ReaderSyncError(400, 'Choose Reader items.');
    await port.storage.change({ ids: selected, generation: session.generation }, patch(p));
    return c.text('OK');
  }
  if (operation === 'mark-all-as-read' || operation === 'mark-all-read') {
    const q = query(p);
    const cutoff = p.has('ts') ? integer(p.get('ts'), 0, 8_640_000_000_000_000) / 1000 : undefined;
    await port.storage.change(
      {
        ...q,
        fetchedBefore:
          cutoff === undefined
            ? q.fetchedBefore
            : Math.min(q.fetchedBefore ?? Infinity, Math.ceil(cutoff)),
        generation: session.generation,
      },
      { read: true },
    );
    return c.text('OK');
  }
  if (operation === 'subscription/quickadd') {
    const url = p.get('quickadd');
    if (!url) throw new ReaderSyncError(400, 'Choose a subscription URL.');
    const candidates = await services.feeds.discover(url);
    if (!candidates.length) return json(c, { numResults: 0, query: url });
    const receipt = await subscriptionAction(c, services, session, {
      kind: 'add_feed',
      url: candidates[0]!.url,
      folderId: null,
      confirm: true,
      requestId: crypto.randomUUID(),
    });
    const feed = (await port.storage.metadata()).feeds.find((f) => f.id === receipt.targetId);
    return json(c, {
      numResults: 1,
      query: url,
      streamId: `feed/${receipt.targetId}`,
      streamName: feed?.title ?? url,
    });
  }
  if (operation === 'subscription/edit') {
    const action = p.get('ac'),
      streams = p.getAll('s');
    if (
      !streams.length ||
      streams.length > 100 ||
      !['subscribe', 'edit', 'unsubscribe'].includes(action ?? '')
    )
      throw new ReaderSyncError(400, 'Choose subscription streams and an action.');
    const destination = p.get('a') ? syncStream(p.get('a')!) : null;
    const removal = p.get('r') ? syncStream(p.get('r')!) : null;
    if ((destination && destination.kind !== 'label') || (removal && removal.kind !== 'label'))
      throw new ReaderSyncError(400, 'Choose folder labels.');
    if (p.has('t') && (!p.get('t')!.trim() || p.get('t')!.length > 200))
      throw new ReaderSyncError(400, 'Choose a feed title of 1–200 characters.');
    const selected = action === 'subscribe' ? [] : streams.map(syncStream);
    if (selected.some((s) => s.kind !== 'feed'))
      throw new ReaderSyncError(400, 'Choose subscription IDs.');
    if (action === 'subscribe') {
      try {
        if (!['http:', 'https:'].includes(new URL(streams[0]!.replace(/^feed\//, '')).protocol))
          throw new Error();
      } catch {
        throw new ReaderSyncError(400, 'Choose an HTTP(S) subscription URL.');
      }
    }
    let meta = await port.storage.metadata();
    if (destination?.kind === 'label' && !meta.folders.some((f) => f.title === destination.name)) {
      await port.storage.label('create', destination.name, undefined, session.generation);
      meta = await port.storage.metadata();
    }
    if (action === 'subscribe') {
      const url = streams[0]!.replace(/^feed\//, '');
      await subscriptionAction(c, services, session, {
        kind: 'add_feed',
        url,
        folderId:
          destination?.kind === 'label'
            ? meta.folders.find((f) => f.title === destination.name)!.id
            : null,
        confirm: true,
        requestId: crypto.randomUUID(),
      });
      return c.text('OK');
    }
    for (const selectedFeed of selected)
      if (selectedFeed.kind === 'feed') {
        const feed = meta.feeds.find((f) => f.id === selectedFeed.id);
        if (!feed) continue;
        if (action === 'unsubscribe')
          await subscriptionAction(c, services, session, {
            kind: 'delete_feed',
            id: feed.id,
            confirm: true,
          });
        else {
          if (
            !(await port.access.session(
              c.req.header('authorization') ?? null,
              p.get('T') ?? undefined,
            ))
          )
            throw new ReaderSyncError(403, 'Reader access has changed.');
          const folderId =
            destination?.kind === 'label'
              ? meta.folders.find((f) => f.title === destination.name)!.id
              : removal?.kind === 'label' &&
                  meta.folders.some((f) => f.id === feed.folderId && f.title === removal.name)
                ? null
                : undefined;
          await port.storage.editFeed(
            feed.id,
            p.get('t') ?? feed.title,
            folderId,
            session.generation,
          );
        }
      }
    return c.text('OK');
  }
  if (operation === 'tag/edit' || operation === 'rename-tag' || operation === 'disable-tag') {
    const values = operation === 'tag/edit' ? p.getAll('a') : p.getAll('s');
    if (!values.length || values.length > 100)
      throw new ReaderSyncError(400, 'Choose reader labels.');
    const labels = values.map(syncStream),
      destination = p.get('dest') ? syncStream(p.get('dest')!) : undefined;
    if (labels.some((s) => s.kind !== 'label') || (destination && destination.kind !== 'label'))
      throw new ReaderSyncError(400, 'Choose reader labels.');
    for (const label of labels)
      if (label.kind === 'label')
        await port.storage.label(
          operation === 'tag/edit' ? 'create' : operation === 'rename-tag' ? 'rename' : 'remove',
          label.name,
          destination?.kind === 'label' ? destination.name : undefined,
          session.generation,
        );
    return c.text('OK');
  }
  throw new ReaderSyncError(404, 'Reader operation not found.');
}

export function registerGoogleReader(app: Hono, services: ApiServices) {
  const add = (
    method: 'get' | 'post',
    path: string,
    operation: string,
    write = false,
    pathStream = false,
  ) => {
    app[method](
      path,
      documented('Reader apps', `Google Reader: ${operation}`, {
        description:
          'Private Google Reader compatibility endpoint. App password/session credentials are separate from MCP and owner access. Form writes require a Reader write token T; Reeder T=x requires an authenticated header. XML subscription import uses the explicit authenticated header. Native form clients are supported; no owner REST fallback.',
        parameters: [
          ...[...path.matchAll(/:([a-zA-Z]+)/g)].map(([, name]) => ({
            in: 'path' as const,
            name: name!,
            required: true,
            schema: { type: 'string' as const },
          })),
          queryParameter(
            'output',
            { type: 'string', enum: ['json'] },
            'JSON is the supported structured response format.',
          ),
          ...(operation.startsWith('stream/')
            ? [
                queryParameter(
                  's',
                  { type: 'string' },
                  'Stream ID; repeat for a union of streams.',
                ),
                queryParameter(
                  'xt',
                  { type: 'string' },
                  'Excluded stream; repeat for multiple exclusions.',
                ),
                queryParameter(
                  'n',
                  { type: 'integer', minimum: 1, maximum: 10000 },
                  'Page size, capped at 10000.',
                ),
                queryParameter(
                  'c',
                  { type: 'string' },
                  'Opaque continuation returned by the previous page.',
                ),
                queryParameter(
                  'r',
                  { type: 'string', enum: ['o', 'd'] },
                  'Oldest or descending published order, with stable item-ID ties.',
                ),
                queryParameter(
                  'ot',
                  { type: 'integer', minimum: 0 },
                  'Crawled at or after this Unix timestamp in seconds (including older published stories).',
                ),
                queryParameter(
                  'nt',
                  { type: 'integer', minimum: 0 },
                  'Crawled before this Unix timestamp in seconds.',
                ),
                queryParameter(
                  'i',
                  { type: 'string' },
                  'Explicit item ID; repeat for requested items.',
                ),
              ]
            : []),
        ],
        ...(operation === 'ClientLogin' ? {} : { security: [{ readerSession: [] }] }),
        ...(method === 'post'
          ? {
              requestBody: {
                required: true,
                content:
                  operation === 'subscription/import'
                    ? {
                        'text/xml': { schema: { type: 'string' } },
                        'application/xml': { schema: { type: 'string' } },
                        'text/x-opml': { schema: { type: 'string' } },
                      }
                    : {
                        'application/x-www-form-urlencoded': {
                          schema: {
                            type: 'object',
                            properties: {
                              ...(operation === 'ClientLogin'
                                ? { Email: { type: 'string' }, Passwd: { type: 'string' } }
                                : {
                                    T: {
                                      type: 'string',
                                      description:
                                        'Write token from the authenticated token endpoint.',
                                    },
                                  }),
                              i: { type: 'array', items: { type: 'string' } },
                              s: { type: 'array', items: { type: 'string' } },
                              a: { type: 'array', items: { type: 'string' } },
                              r: { type: 'array', items: { type: 'string' } },
                            },
                            additionalProperties: true,
                          },
                        },
                        'multipart/form-data': {
                          schema: { type: 'object', additionalProperties: true },
                        },
                      },
              },
            }
          : {}),
        responses: {
          200:
            operation === 'ClientLogin'
              ? {
                  description: 'Reader login response; text by default, JSON only with output=json',
                  content: {
                    'text/plain': { schema: { type: 'string' } },
                    'application/json': { schema: { type: 'object' } },
                  },
                }
              : operation === 'subscription/export'
                ? response({ type: 'string' }, 'Subscription OPML', 'text/x-opml')
                : response(
                    {
                      type:
                        operation === 'token' || (write && operation !== 'subscription/quickadd')
                          ? 'string'
                          : 'object',
                    },
                    'Google Reader response',
                    operation === 'token' || (write && operation !== 'subscription/quickadd')
                      ? 'text/plain'
                      : 'application/json',
                  ),
          ...errors(400, 401, 403, 404, 409, 413, 415, 429, 501, 503),
          ...(operation === 'ClientLogin'
            ? { 401: response({ type: 'string' }, 'Bad Reader credentials', 'text/plain') }
            : {}),
        },
      }),
      async (c) => {
        c.header('Cache-Control', 'private, no-store');
        c.header('X-Robots-Tag', 'noindex, nofollow');
        try {
          syncBoundary(c, services.outputBaseUrl);
          const port = await readerPort(services);
          if (operation === 'subscription/import') {
            if (
              !['text/xml', 'application/xml', 'text/x-opml'].includes(
                c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '',
              )
            )
              throw new ReaderSyncError(415, 'Use an XML OPML body.');
            const session = await readerSession(c, port, new URLSearchParams());
            const xml = await c.req.text();
            if (xml.length > 1_000_000) throw new ReaderSyncError(413, 'OPML is too large.');
            await subscriptionAction(c, services, session, {
              kind: 'import_opml',
              opml: xml,
              confirm: true,
              requestId: crypto.randomUUID(),
            });
            return c.text('OK');
          }
          const p = await syncParameters(c);
          if (operation === 'ClientLogin') {
            if (c.req.method !== 'POST')
              throw new ReaderSyncError(400, 'Use POST for Reader sign-in.');
            const token = await port.access.login(p.get('Email') ?? '', p.get('Passwd') ?? '');
            if (!token) return c.text('Error=BadAuthentication\n', 401);
            return p.get('output') === 'json'
              ? json(c, { SID: token, LSID: token, Auth: token })
              : c.text(`SID=${token}\nLSID=${token}\nAuth=${token}\n`);
          }
          const session = await readerSession(c, port, p, write);
          if (operation === 'subscription/export') {
            c.header('Content-Type', 'text/x-opml; charset=utf-8');
            return c.body(await services.opml.export());
          }
          const stream = pathStream
            ? path
                .slice(prefix.length + '/stream/contents/'.length)
                .split('/')
                .map((value) => (value.startsWith(':') ? c.req.param(value.slice(1)) : value))
                .join('/')
            : undefined;
          return await dispatch(c, services, port, p, session, operation, stream);
        } catch (error) {
          return syncFailure(c, error);
        }
      },
    );
  };
  add('post', `${base}/accounts/ClientLogin`, 'ClientLogin');
  add('post', `${prefix}/subscription/import`, 'subscription/import', true);
  add('get', `${prefix}/subscription/export`, 'subscription/export');
  for (const operation of [
    'token',
    'user-info',
    'tag/list',
    'subscription/list',
    'unread-count',
    'stream/items/ids',
    'stream/items/contents',
    'stream/contents',
  ])
    add('get', `${prefix}/${operation}`, operation);
  for (const operation of ['stream/items/ids', 'stream/items/contents', 'stream/contents'])
    add('post', `${prefix}/${operation}`, operation);
  for (const operation of [
    'edit-tag',
    'mark-all-as-read',
    'mark-all-read',
    'subscription/quickadd',
    'subscription/edit',
    'tag/edit',
    'rename-tag',
    'disable-tag',
  ])
    add('post', `${prefix}/${operation}`, operation, true);
  for (const suffix of [
    ':stream',
    'feed/:id',
    'user/:user/state/com.google/:state',
    'user/:user/label/:label',
  ])
    add('get', `${prefix}/stream/contents/${suffix}`, 'stream/contents', false, true);
}
