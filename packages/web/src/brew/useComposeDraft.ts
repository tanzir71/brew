import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BrewConfig, BrewConfigDraft } from '@brew/core/types/brew';
import { validateComposition } from '@brew/core/composition-model';

export async function composeJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const value = await response.json().catch(() => ({ error: 'Could not save this Brew.' }));
  if (!response.ok) throw new Error(value.error ?? 'Request failed.');
  return value as T;
}
export function useComposeDraft(initial: BrewConfig) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<BrewConfigDraft>(() => ({
    name: initial.name,
    enabled: initial.enabled,
    timezone: initial.timezone,
    schedule: initial.schedule,
    delivery: initial.delivery,
    sections: initial.sections,
  }));
  const [status, setStatus] = useState('All changes saved');
  const [failed, setFailed] = useState(false);
  const latest = useRef(draft);
  const revision = useRef(0);
  const saved = useRef(0);
  const pending = useRef<Promise<boolean> | null>(null);
  const timer = useRef(0);
  const alive = useRef(true);
  const flush = useCallback(
    function flushDraft(force = false): Promise<boolean> {
      clearTimeout(timer.current);
      if (force) revision.current++;
      if (pending.current) return pending.current.then((ok) => (ok ? flushDraft() : false));
      const run = async () => {
        while (saved.current < revision.current) {
          const version = revision.current;
          const value = structuredClone(latest.current);
          try {
            validateComposition(value);
            if (alive.current) {
              setStatus('Saving…');
              setFailed(false);
            }
            const next = await composeJson<BrewConfig>(
              `/api/brew-configs/${initial.id}/composition`,
              { method: 'PUT', body: JSON.stringify(value) },
            );
            saved.current = version;
            client.setQueryData(['composition', initial.id], next);
            void client.invalidateQueries({ queryKey: ['brew-configs'] });
          } catch (error) {
            if (alive.current) {
              setStatus((error as Error).message);
              setFailed(true);
            }
            return false;
          }
        }
        if (alive.current) {
          setStatus('All changes saved');
          setFailed(false);
        }
        return true;
      };
      pending.current = run().finally(() => {
        pending.current = null;
      });
      return pending.current;
    },
    [client, initial.id],
  );
  const applySettings = async (
    settings: Pick<BrewConfigDraft, 'schedule' | 'timezone' | 'enabled' | 'delivery'>,
  ): Promise<boolean> => {
    if (!(await flush())) return false;
    const value = structuredClone({ ...latest.current, ...settings });
    validateComposition(value);
    setStatus('Saving…');
    setFailed(false);
    let failure: unknown;
    const task = (async () => {
      try {
        const next = await composeJson<BrewConfig>(`/api/brew-configs/${initial.id}/composition`, {
          method: 'PUT',
          body: JSON.stringify(value),
        });
        // Keep the sheet's candidate out of autosave until the server accepts it.
        // Merge only settings so an edit made during this request is preserved.
        latest.current = {
          ...latest.current,
          schedule: next.schedule,
          timezone: next.timezone,
          enabled: next.enabled,
          delivery: next.delivery,
        };
        if (alive.current) setDraft(latest.current);
        client.setQueryData(['composition', initial.id], next);
        void client.invalidateQueries({ queryKey: ['brew-configs'] });
        return true;
      } catch (error) {
        failure = error;
        if (alive.current)
          setStatus(saved.current < revision.current ? 'Unsaved changes' : 'All changes saved');
        return false;
      }
    })().finally(() => {
      pending.current = null;
    });
    pending.current = task;
    if (!(await task)) {
      if (saved.current < revision.current) void flush();
      throw failure;
    }
    return flush();
  };
  const update = (change: (previous: BrewConfigDraft) => BrewConfigDraft) => {
    const next = change(latest.current);
    latest.current = next;
    revision.current++;
    setDraft(next);
    setFailed(false);
    setStatus('Unsaved changes');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 500);
  };
  useEffect(() => {
    alive.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current || saved.current < revision.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.href);
      if (
        url.origin !== location.origin ||
        (url.pathname === location.pathname && url.search === location.search)
      )
        return;
      event.preventDefault();
      void flush().then((ok) => {
        if (ok) location.assign(link.href);
      });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigate, true);
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', navigate, true);
    };
  }, [flush]);
  return { draft, update, flush, applySettings, status, failed };
}
