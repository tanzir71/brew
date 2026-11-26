import { useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TagChanges, TagSummary } from '@brew/core/types/api';
import { changeArticleTags, createTagDefinition, tagDefinitions } from '../articleTags';

type Request = { changes: TagChanges; name: string };
export function useTagEditor({
  id,
  enabled = true,
  onCreated,
  onSaved,
}: {
  id: number;
  enabled?: boolean;
  onCreated?: (tag: TagSummary) => void;
  onSaved?: () => void;
}) {
  const client = useQueryClient();
  const tags = useQuery({
    queryKey: ['tags'],
    enabled,
    queryFn: ({ signal }) => tagDefinitions(signal),
  });
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState<Request | null>(null);
  const busy = useRef(false);
  const alive = useRef(false);
  const created = useRef(new Map<string, TagSummary>());
  const callbacks = useRef({ onCreated, onSaved });
  useLayoutEffect(() => {
    callbacks.current = { onCreated, onSaved };
  }, [onCreated, onSaved]);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (request: Request) => {
    if (busy.current || !tags.data || tags.isError) return;
    busy.current = true;
    setPending(true);
    setError('');
    setMessage('');
    setFailed(null);
    let definition: TagSummary | undefined;
    try {
      if (request.name) {
        definition =
          created.current.get(request.name) ?? tags.data.find((tag) => tag.name === request.name);
        if (!definition) definition = await createTagDefinition(client, request.name);
        created.current.set(request.name, definition);
        if (!alive.current) return;
        callbacks.current.onCreated?.(definition);
      }
      // Closing during creation must not start a second write after leaving this item.
      if (!alive.current) return;
      await changeArticleTags(client, id, {
        add: [...new Set([...request.changes.add, ...(definition ? [definition.id] : [])])],
        remove: request.changes.remove.filter((tagId) => tagId !== definition?.id),
      });
      if (!alive.current) return;
      if (request.name) setName((current) => (current.trim() === request.name ? '' : current));
      setMessage('Tags saved.');
      callbacks.current.onSaved?.();
    } catch {
      if (!alive.current) return;
      setFailed(request);
      setError(
        definition
          ? `“${definition.name}” is available in your library. Could not confirm it on this item. Try again.`
          : request.name
            ? 'Could not confirm this tag. Try again.'
            : 'Could not confirm tag changes. Try again.',
      );
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  };
  return {
    tags,
    name,
    pending,
    error,
    message,
    failed,
    ready: Boolean(tags.data) && !tags.isError,
    setName: (value: string) => {
      setName(value);
      setFailed(null);
      setError('');
      setMessage('');
    },
    save: (changes: TagChanges, newName = '') =>
      run({
        changes: { add: [...changes.add], remove: [...changes.remove] },
        name: newName.trim(),
      }),
    retry: () => (failed ? run(failed) : Promise.resolve()),
    invalidName: () => {
      setError('Enter a tag name.');
      setFailed(null);
      setMessage('');
    },
  };
}
