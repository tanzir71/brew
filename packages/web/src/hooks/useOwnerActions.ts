import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ActionReceipt,
  ActionInput,
  ActionIntentRequest,
  ActionKind,
} from '@brew/core/actions';
import { useCapabilities } from './useCapabilities';
import { refreshArticleStates } from '../articleState';

export interface ActionIntent {
  request: ActionIntentRequest;
  label: string;
  externalEffects: boolean;
  submitted: boolean;
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Could not finish this action.');
  return value;
}
export function useOwnerActions(
  refresh: (receipt: ActionReceipt) => Promise<void>,
  kinds?: readonly ActionKind[],
) {
  const caps = useCapabilities();
  const capable = Boolean(caps.data?.actions?.undo);
  const client = useQueryClient();
  const [intent, setIntent] = useState<ActionIntent | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyVersion, setHistoryVersion] = useState(0);
  const waiting = useRef<((value: ActionReceipt | null) => void) | null>(null);
  const executing = useRef(false);
  useEffect(
    () => () => {
      waiting.current?.(null);
      waiting.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!capable) return;
    const controller = new AbortController();
    void request<ActionReceipt[]>('/api/actions', { signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted) return;
        setHistoryError('');
        const latest = items.find((item) => item.canUndo && (!kinds || kinds.includes(item.kind)));
        if (latest)
          setReceipt((current) => (!current || current.id < latest.id ? latest : current));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setHistoryError('Could not recover recent actions. Retry to check for available Undo.');
      });
    return () => controller.abort();
  }, [capable, historyVersion, kinds]);
  useEffect(() => {
    if (!receipt?.canUndo || !receipt.expiresAt) return;
    const timer = window.setTimeout(
      () =>
        setReceipt((current) =>
          current?.id === receipt.id ? { ...current, canUndo: false } : current,
        ),
      Math.max(0, Date.parse(receipt.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [receipt]);
  const stage = (
    value: ActionInput,
    label: string,
    externalEffects: boolean,
    immediate: boolean,
  ): Promise<ActionReceipt | null> => {
    if (!capable || busy || executing.current || intent || waiting.current)
      return Promise.resolve(null);
    setError('');
    const requestId = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    const next = { request: { ...value, requestId }, label, externalEffects, submitted: false };
    const result = new Promise<ActionReceipt | null>((resolve) => {
      waiting.current = resolve;
    });
    if (immediate) void execute(next, false);
    else setIntent(next);
    return result;
  };
  const sync = async (value: ActionReceipt) => {
    setReceipt(value);
    refreshArticleStates(client);
    try {
      await refresh(value);
    } catch {
      setError('The action finished, but the view could not refresh. Reload to see it.');
    }
  };
  const execute = async (active: ActionIntent, show: boolean) => {
    if (executing.current) return;
    executing.current = true;
    setBusy(true);
    setError('');
    if (show) setIntent({ ...active, submitted: true });
    try {
      const next = await request<ActionReceipt>('/api/actions', {
        method: 'POST',
        body: JSON.stringify({ ...active.request, confirm: true }),
      });
      setIntent(null);
      await sync(next);
      waiting.current?.(next);
      waiting.current = null;
    } catch (failure) {
      setIntent({ ...active, submitted: true });
      setError((failure as Error).message);
    } finally {
      executing.current = false;
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!receipt?.canUndo || busy || executing.current || !capable) return;
    executing.current = true;
    setBusy(true);
    setError('');
    try {
      await sync(
        await request<ActionReceipt>(`/api/actions/${receipt.id}/undo`, {
          method: 'POST',
          body: '{}',
        }),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      executing.current = false;
      setBusy(false);
    }
  };
  return {
    capable,
    intent,
    receipt,
    busy,
    error,
    historyError,
    recover: () => setHistoryVersion((version) => version + 1),
    ask: (value: ActionInput, label: string, externalEffects = false) =>
      stage(value, label, externalEffects, false),
    perform: (value: ActionInput, label: string) => stage(value, label, false, true),
    confirm: () => {
      if (intent && !busy && capable) return execute(intent, true);
    },
    undo,
    close: () => {
      if (!busy && !executing.current) {
        waiting.current?.(null);
        waiting.current = null;
        setIntent(null);
        setError('');
      }
    },
  };
}
