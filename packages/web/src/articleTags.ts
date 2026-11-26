import type { QueryClient } from '@tanstack/react-query';
import type { ArticleDetail, TagChanges, TagSummary } from '@brew/core/types/api';
import { parseTagChanges } from '@brew/core/tag-changes';
import { refreshArticleStates } from './articleState';

const queues = new WeakMap<QueryClient, Map<number, Promise<TagSummary[]>>>();
const validTag = (tag: unknown): tag is TagSummary =>
  Boolean(
    tag &&
    typeof tag === 'object' &&
    Number.isSafeInteger((tag as TagSummary).id) &&
    (tag as TagSummary).id > 0 &&
    typeof (tag as TagSummary).name === 'string' &&
    typeof (tag as TagSummary).color === 'string',
  );

export async function tagDefinitions(signal?: AbortSignal): Promise<TagSummary[]> {
  const response = await fetch('/api/tags', { signal });
  if (!response.ok) throw new Error('Could not load tags. Try again.');
  const tags: unknown = await response.json();
  if (!Array.isArray(tags) || !tags.every(validTag))
    throw new Error('Could not load tags. Try again.');
  return tags;
}

export async function createTagDefinition(client: QueryClient, name: string): Promise<TagSummary> {
  const response = await fetch('/api/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  });
  if (!response.ok) throw new Error('Could not confirm this tag. Try again.');
  const tag: unknown = await response.json();
  if (!validTag(tag) || tag.name !== name.trim())
    throw new Error('Could not confirm this tag. Try again.');
  await client.cancelQueries({ queryKey: ['tags'] });
  client.setQueryData<TagSummary[]>(['tags'], (current) =>
    [...(current ?? []).filter((item) => item.id !== tag.id), tag].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  );
  return tag;
}

async function cancelTagReads(client: QueryClient, id: number) {
  await Promise.allSettled(
    ['article', 'newsletter-letter'].map((key) => client.cancelQueries({ queryKey: [key, id] })),
  );
}

/** Apply only tag intent; server responses must never replace newer article fields. */
export async function changeArticleTags(
  client: QueryClient,
  id: number,
  input: TagChanges,
): Promise<TagSummary[]> {
  const changes = parseTagChanges(input);
  let queue = queues.get(client);
  if (!queue) {
    queue = new Map();
    queues.set(client, queue);
  }
  const previous = queue.get(id);
  const task = (previous?.catch(() => undefined) ?? Promise.resolve()).then(async () => {
    await cancelTagReads(client, id);
    const response = await fetch(`/api/articles/${id}/tags`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    if (!response.ok) throw new Error('Could not confirm tag changes. Try again.');
    const saved = (await response.json()) as Pick<ArticleDetail, 'id' | 'tags'>;
    if (saved.id !== id || !Array.isArray(saved.tags) || !saved.tags.every(validTag))
      throw new Error('Could not confirm tag changes. Try again.');
    await cancelTagReads(client, id);
    for (const key of ['article', 'newsletter-letter'])
      client.setQueryData<ArticleDetail>([key, id], (current) =>
        current ? { ...current, tags: saved.tags } : current,
      );
    return saved.tags;
  });
  queue.set(id, task);
  try {
    return await task;
  } finally {
    if (queue.get(id) === task) queue.delete(id);
    if (!queue.size) {
      refreshArticleStates(client);
      for (const key of ['newsletter-overview', 'brew-preview'])
        void client.invalidateQueries({ queryKey: [key] });
    }
  }
}
