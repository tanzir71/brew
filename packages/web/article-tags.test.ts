import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { changeArticleTags, createTagDefinition } from './src/articleTags';
import { patchArticleStates } from './src/articleState';

const first = { id: 1, name: 'First', color: '#a0471d' };
const second = { id: 2, name: 'Second', color: '#a0471d' };
const third = { id: 3, name: 'Third', color: '#a0471d' };
const initial = {
  id: 1,
  readAt: 'read',
  starredAt: null as string | null,
  tags: [first],
  contentHtml: '<p>Keep</p>',
  sender: { id: 7 },
  cleaning: { trackers: 3 },
};
let client: QueryClient;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of ['article', 'newsletter-letter']) client.setQueryData([key, 1], initial);
  client.setQueryData(['tags'], [first, second]);
  client.setQueryData(['brew-history', 1], [{ payload: 'frozen' }]);
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

it('serializes tag intents and patches tags without rewinding concurrent read/star state or frozen content', async () => {
  const responses: ReturnType<typeof deferred<Response>>[] = [];
  const requests: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, init) => {
      const response = deferred<Response>();
      responses.push(response);
      requests.push(JSON.parse(init.body));
      return response.promise;
    }),
  );
  const one = changeArticleTags(client, 1, { add: [second.id], remove: [] });
  const two = changeArticleTags(client, 1, { add: [third.id], remove: [first.id] });
  await vi.waitFor(() => expect(responses).toHaveLength(1));
  expect(client.getQueryData(['article', 1])).toEqual(initial);
  patchArticleStates(client, [1], { readAt: 'new read', starredAt: 'new star' });
  responses[0]!.resolve(json({ ...initial, readAt: null, tags: [first, second] }));
  await vi.waitFor(() => expect(responses).toHaveLength(2));
  responses[1]!.resolve(json({ ...initial, readAt: null, tags: [second, third] }));
  await Promise.all([one, two]);
  for (const key of ['article', 'newsletter-letter'])
    expect(client.getQueryData([key, 1])).toEqual({
      ...initial,
      readAt: 'new read',
      starredAt: 'new star',
      tags: [second, third],
    });
  expect(requests).toEqual([
    { add: [2], remove: [] },
    { add: [3], remove: [1] },
  ]);
  expect(client.getQueryData(['brew-history', 1])).toEqual([{ payload: 'frozen' }]);
});

it('cancels a detail read started during the write so an obsolete tag list cannot overwrite acknowledgement', async () => {
  const write = deferred<Response>();
  const old = deferred<typeof initial>();
  let signal!: AbortSignal;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => write.promise),
  );
  const pending = changeArticleTags(client, 1, { add: [2], remove: [] });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const stale = client
    .fetchQuery({
      queryKey: ['article', 1],
      queryFn: ({ signal: current }) => {
        signal = current;
        return old.promise;
      },
    })
    .catch(() => undefined);
  await vi.waitFor(() => expect(signal).toBeDefined());
  write.resolve(json({ id: 1, tags: [first, second] }));
  await pending;
  expect(signal.aborted).toBe(true);
  old.resolve(initial);
  await stale;
  expect(client.getQueryData(['article', 1])).toEqual({ ...initial, tags: [first, second] });
});

it('keeps confirmed tags after failed or malformed acknowledgements and allows a later retry', async () => {
  let response = json({ error: 'Unavailable' }, 503);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response),
  );
  await expect(changeArticleTags(client, 1, { add: [2], remove: [] })).rejects.toThrow(
    'Could not confirm',
  );
  expect(client.getQueryData(['article', 1])).toEqual(initial);
  response = json({ id: 2, tags: [second] });
  await expect(changeArticleTags(client, 1, { add: [2], remove: [] })).rejects.toThrow(
    'Could not confirm',
  );
  response = json({ id: 1, tags: [first, second] });
  await changeArticleTags(client, 1, { add: [2], remove: [] });
  expect(client.getQueryData(['article', 1])).toEqual({ ...initial, tags: [first, second] });
});

it('merges a confirmed definition into the library while cancelling an older list and rejects a mismatched name', async () => {
  const old = deferred<(typeof first)[]>();
  const stale = client
    .fetchQuery({
      queryKey: ['tags'],
      queryFn: ({ signal }) => {
        void signal;
        return old.promise;
      },
    })
    .catch(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(third)),
  );
  await createTagDefinition(client, ' Third ');
  old.resolve([first]);
  await stale;
  expect(client.getQueryData(['tags'])).toEqual([first, second, third]);
  await expect(createTagDefinition(client, 'Wrong name')).rejects.toThrow('Could not confirm');
  expect(client.getQueryData(['tags'])).toEqual([first, second, third]);
});
