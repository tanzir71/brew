import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { ArticleDetail, ArticleSummary } from '@brew/core/types/api';
import type { BrewReadState } from '@brew/core/types/brew';

type ArticleState = Pick<ArticleDetail, 'readAt' | 'starredAt'>;
type Pages = InfiniteData<{ items: ArticleSummary[] }>;
type Entry = {
  confirmed: ArticleState;
  versions: Record<keyof ArticleState, number>;
  pending: number;
  tail: Promise<void>;
};
const writes = new WeakMap<QueryClient, { pending: number; entries: Map<number, Entry> }>();

export function patchArticleStates(
  client: QueryClient,
  ids: number[],
  values: Partial<ArticleState>,
) {
  const selected = new Set(ids);
  client.setQueriesData<ArticleDetail>({ queryKey: ['article'] }, (current) =>
    current && selected.has(current.id) ? { ...current, ...values } : current,
  );
  for (const key of ['articles', 'search'])
    client.setQueriesData<Pages>({ queryKey: [key] }, (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                selected.has(item.id) ? { ...item, ...values } : item,
              ),
            })),
          }
        : current,
    );
  client.setQueriesData<BrewReadState>({ queryKey: ['brew-state'] }, (current) =>
    current
      ? {
          ...current,
          articles: current.articles.map((item) =>
            selected.has(item.id) ? { ...item, ...values } : item,
          ),
        }
      : current,
  );
}

export function refreshArticleStates(client: QueryClient) {
  if (writes.get(client)?.pending) return;
  for (const key of ['article', 'articles', 'search', 'brew-state', 'reader-navigation'])
    void client.invalidateQueries({ queryKey: [key] });
  window.dispatchEvent(new Event('brew:navigation-refresh'));
}

export function cachedArticleState(client: QueryClient, id: number): ArticleState {
  const detail = client.getQueryData<ArticleDetail>(['article', id]);
  if (detail) return { readAt: detail.readAt, starredAt: detail.starredAt };
  for (const [, state] of client.getQueriesData<BrewReadState>({ queryKey: ['brew-state'] })) {
    const item = state?.articles.find((item) => item.id === id);
    if (item) return { readAt: item.readAt, starredAt: item.starredAt };
  }
  for (const key of ['articles', 'search'])
    for (const [, pages] of client.getQueriesData<Pages>({ queryKey: [key] })) {
      const item = pages?.pages.flatMap((page) => page.items).find((item) => item.id === id);
      if (item) return { readAt: item.readAt, starredAt: item.starredAt };
    }
  return { readAt: null, starredAt: null };
}

export async function updateArticleState(
  client: QueryClient,
  id: number,
  values: { read?: boolean; starred?: boolean },
): Promise<ArticleDetail> {
  let batch = writes.get(client);
  if (!batch) {
    batch = { pending: 0, entries: new Map() };
    writes.set(client, batch);
  }
  batch.pending++;
  // Cancel stale reads before publishing the optimistic state. Refetch only when
  // every queued write has settled, so an older GET cannot rewind another edit.
  await Promise.allSettled([
    client.cancelQueries({ queryKey: ['article', id] }),
    ...['articles', 'search', 'brew-state'].map((key) => client.cancelQueries({ queryKey: [key] })),
  ]);
  let entry = batch.entries.get(id);
  if (!entry) {
    entry = {
      confirmed: cachedArticleState(client, id),
      versions: { readAt: 0, starredAt: 0 },
      pending: 0,
      tail: Promise.resolve(),
    };
    batch.entries.set(id, entry);
  }
  const current = entry;
  current.pending++;
  const optimistic: Partial<ArticleState> = {};
  if (values.read !== undefined) optimistic.readAt = values.read ? new Date().toISOString() : null;
  if (values.starred !== undefined)
    optimistic.starredAt = values.starred ? new Date().toISOString() : null;
  const fields = Object.keys(optimistic) as Array<keyof ArticleState>;
  const versions = { ...current.versions };
  for (const field of fields) versions[field] = ++current.versions[field];
  patchArticleStates(client, [id], optimistic);
  const settle = (state: ArticleState) => {
    const patch: Partial<ArticleState> = {};
    for (const field of fields)
      if (versions[field] === current.versions[field]) patch[field] = state[field];
    patchArticleStates(client, [id], patch);
  };
  const task = current.tail.then(async () => {
    try {
      const response = await fetch(`/api/articles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error('Could not update article. Try again.');
      const saved = (await response.json()) as ArticleDetail;
      current.confirmed = { readAt: saved.readAt, starredAt: saved.starredAt };
      settle(current.confirmed);
      return saved;
    } catch (error) {
      settle(current.confirmed);
      throw error;
    }
  });
  current.tail = task.then(
    () => {},
    () => {},
  );
  try {
    return await task;
  } finally {
    if (--current.pending === 0) batch.entries.delete(id);
    if (--batch.pending === 0) refreshArticleStates(client);
  }
}
