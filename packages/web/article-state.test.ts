import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { patchArticleStates, updateArticleState } from './src/articleState';

let client: QueryClient;
const initial = { id: 1, readAt: null as string | null, starredAt: null as string | null };
const readAt = '2026-11-26T01:00:00.000Z';
const starredAt = '2026-11-26T02:00:00.000Z';
function state() {
  return client.getQueryData<typeof initial>(['article', 1])!;
}
function json(value: typeof initial, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['article', 1], initial);
  for (const key of ['articles', 'search'])
    client.setQueryData([key, 'all'], {
      pages: [{ items: [initial, { id: 2, readAt: null, starredAt: null }] }],
      pageParams: [null],
    });
  for (const id of [1, 2])
    client.setQueryData(['brew-state', id], {
      articles: [initial, { id: 2, readAt: null, starredAt: null }],
      timeZone: 'UTC',
    });
  client.setQueryData(['brew-history', 1], [{ id: 1, sections: [{ items: [initial] }] }]);
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

it('shares Newsletter list/detail read state without changing sender settings or cleaning metadata', async () => {
  const sender = { settings: { onlyInBrew: true } };
  const cleaning = { trackers: 3, sponsorBlocks: 1, footerTrimmed: true };
  client.setQueryData(['newsletter-letter', 1], {
    ...initial,
    sender,
    cleaning,
    originalAvailable: true,
  });
  client.setQueryData(['newsletter-letters', 'inbox'], {
    items: [initial, { ...initial, id: 2 }],
    total: 2,
    page: 1,
    pageSize: 50,
  });
  client.setQueryData(['newsletter-overview'], { unreadCount: 2 });
  const originalPage = client.getQueryData(['newsletter-letters', 'inbox']);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ ...initial, readAt })),
  );
  await updateArticleState(client, 1, { read: true });
  expect(client.getQueryData(['newsletter-letter', 1])).toEqual({
    ...initial,
    readAt,
    sender,
    cleaning,
    originalAvailable: true,
  });
  expect(
    client
      .getQueryData<{ items: (typeof initial)[] }>(['newsletter-letters', 'inbox'])!
      .items.map((item) => item.readAt),
  ).toEqual([readAt, null]);
  expect(originalPage).toEqual({
    items: [initial, { ...initial, id: 2 }],
    total: 2,
    page: 1,
    pageSize: 50,
  });
  expect(client.getQueryState(['newsletter-overview'])?.isInvalidated).toBe(true);
});

it('uses Newsletter-only cached confirmation when an explicit unread write fails', async () => {
  client.removeQueries({ queryKey: ['article'] });
  client.setQueryData(['newsletter-letter', 1], { ...initial, readAt, cleaning: { trackers: 1 } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(initial, 503)),
  );
  await expect(updateArticleState(client, 1, { read: false })).rejects.toThrow('Could not update');
  expect(client.getQueryData(['newsletter-letter', 1])).toEqual({
    ...initial,
    readAt,
    cleaning: { trackers: 1 },
  });
});

it('updates every live cache without changing issue content or unrelated articles', async () => {
  const history = JSON.stringify(client.getQueryData(['brew-history', 1]));
  const response = deferred();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response.promise),
  );
  const pending = updateArticleState(client, 1, { read: true });
  await vi.waitFor(() => expect(state().readAt).not.toBeNull());
  response.resolve(json({ ...initial, readAt }));
  await pending;
  expect(state().readAt).toBe(readAt);
  for (const key of ['articles', 'search']) {
    const page = client.getQueryData<{ pages: Array<{ items: (typeof initial)[] }> }>([
      key,
      'all',
    ])!;
    expect(page.pages[0]!.items.map((item) => item.readAt)).toEqual([readAt, null]);
  }
  for (const id of [1, 2])
    expect(
      client.getQueryData<{ articles: (typeof initial)[] }>(['brew-state', id])!.articles[0]!
        .readAt,
    ).toBe(readAt);
  expect(JSON.stringify(client.getQueryData(['brew-history', 1]))).toBe(history);
  expect(client.getQueryState(['brew-state', 2])!.isInvalidated).toBe(true);
});

it('serializes writes and keeps a late read response from rewinding newer unread/star choices', async () => {
  const calls: Array<{
    value: { read?: boolean; starred?: boolean };
    response: ReturnType<typeof deferred>;
  }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, init) => {
      const response = deferred();
      calls.push({ value: JSON.parse(init.body), response });
      return response.promise;
    }),
  );
  const read = updateArticleState(client, 1, { read: true });
  const star = updateArticleState(client, 1, { starred: true });
  const unread = updateArticleState(client, 1, { read: false });
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(state()).toMatchObject({ readAt: null, starredAt: expect.any(String) });
  calls[0]!.response.resolve(json({ ...initial, readAt }));
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(state().readAt).toBeNull();
  calls[1]!.response.resolve(json({ ...initial, readAt, starredAt }));
  await vi.waitFor(() => expect(calls).toHaveLength(3));
  expect(state().readAt).toBeNull();
  calls[2]!.response.resolve(json({ ...initial, starredAt }));
  await Promise.all([read, star, unread]);
  expect(calls.map((call) => call.value)).toEqual([
    { read: true },
    { starred: true },
    { read: false },
  ]);
  expect(state()).toEqual({ ...initial, starredAt });
});

it('rolls back two failed queued writes to confirmed state, not to another failed optimistic edit', async () => {
  const calls: ReturnType<typeof deferred>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      const next = deferred();
      calls.push(next);
      return next.promise;
    }),
  );
  const first = updateArticleState(client, 1, { read: true }).catch((error) => error);
  const second = updateArticleState(client, 1, { read: true }).catch((error) => error);
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  calls[0]!.resolve(json(initial, 503));
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  expect(state().readAt).not.toBeNull();
  calls[1]!.resolve(json(initial, 503));
  expect(await first).toBeInstanceOf(Error);
  expect(await second).toBeInstanceOf(Error);
  expect(state()).toEqual(initial);
});

it('rolls back a failed read without undoing a separately queued successful star', async () => {
  let count = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => (++count === 1 ? json(initial, 503) : json({ ...initial, starredAt }))),
  );
  await Promise.allSettled([
    updateArticleState(client, 1, { read: true }),
    updateArticleState(client, 1, { starred: true }),
  ]);
  expect(state()).toEqual({ ...initial, starredAt });
});

it('cancels an older live-state read so it cannot rewind the acknowledged write', async () => {
  let release!: (value: unknown) => void;
  let started = false;
  const query = client
    .fetchQuery({
      queryKey: ['brew-state', 1],
      queryFn: async () => {
        started = true;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    })
    .catch(() => undefined);
  await vi.waitFor(() => expect(started).toBe(true));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ ...initial, readAt })),
  );
  await updateArticleState(client, 1, { read: true });
  release({ articles: [initial], timeZone: 'UTC' });
  await query;
  expect(
    client.getQueryData<{ articles: (typeof initial)[] }>(['brew-state', 1])!.articles[0]!.readAt,
  ).toBe(readAt);
  patchArticleStates(client, [1], { readAt: null });
  expect(state().readAt).toBeNull();
});
