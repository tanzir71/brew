import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { updateArticleState } from '../articleState';

type Changes = { read?: boolean; starred?: boolean };
type Field = keyof Changes;
type Failure = { value: boolean; message: string };
export function useArticleActions(id: number) {
  const client = useQueryClient();
  const [pending, setPending] = useState(0);
  const [message, setMessage] = useState('');
  const [failures, setFailures] = useState<Partial<Record<Field, Failure>>>({});
  const alive = useRef(false);
  const attempt = useRef(0);
  const latestMessage = useRef(0);
  const latest = useRef({ read: 0, starred: 0 });
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const update = useCallback(
    async (values: Changes, quiet = false) => {
      const current = ++attempt.current;
      const fields = (['read', 'starred'] as const).filter((field) => values[field] !== undefined);
      for (const field of fields) latest.current[field] = current;
      setFailures((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([field]) => !fields.includes(field as Field)),
        ),
      );
      if (!quiet) {
        latestMessage.current = current;
        setMessage('');
        setPending((count) => count + 1);
      }
      try {
        await updateArticleState(client, id, values);
        if (alive.current && !quiet && latestMessage.current === current)
          setMessage(
            values.read !== undefined
              ? values.read
                ? 'Marked article read.'
                : 'Marked article unread.'
              : values.starred
                ? 'Saved article to Starred.'
                : 'Removed article from Starred.',
          );
      } catch (error) {
        if (alive.current)
          setFailures((previous) => {
            const next = { ...previous };
            for (const field of fields)
              if (latest.current[field] === current)
                next[field] = {
                  value: values[field]!,
                  message:
                    error instanceof Error ? error.message : 'Could not update article. Try again.',
                };
            return next;
          });
      } finally {
        if (alive.current && !quiet) setPending((count) => count - 1);
      }
    },
    [client, id],
  );
  return { update, pending: pending > 0, message, failures, clearMessage: () => setMessage('') };
}
