import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ActionReceipt, ActionRequest } from '@brew/core/actions';
import { useCapabilities } from './useCapabilities';
import { refreshArticleStates } from '../articleState';

export interface ActionIntent {
  request: Omit<ActionRequest, 'confirm'>;
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
export function useOwnerActions(refresh: (receipt: ActionReceipt) => Promise<void>) {
  const caps = useCapabilities();
  const capable = Boolean(caps.data?.actions?.undo);
  const client = useQueryClient();
  const [intent, setIntent] = useState<ActionIntent | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyVersion, setHistoryVersion] = useState(0);
  useEffect(() => {
    if (!capable) return;
    const controller = new AbortController();
    void request<ActionReceipt[]>('/api/actions', { signal: controller.signal })
      .then((items) => {
        if (controller.signal.aborted) return;
        setHistoryError('');
        const latest = items.find((item) => item.canUndo);
        if (latest)
          setReceipt((current) => (!current || current.id < latest.id ? latest : current));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setHistoryError('Could not recover recent actions. Retry to check for available Undo.');
      });
    return () => controller.abort();
  }, [capable, historyVersion]);
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
  const ask = (
    value: Omit<ActionRequest, 'confirm' | 'requestId'>,
    label: string,
    externalEffects = false,
  ) => {
    if (!capable || busy) return;
    setError('');
    const requestId = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    setIntent({ request: { ...value, requestId }, label, externalEffects, submitted: false });
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
  const confirm = async () => {
    if (!intent || busy) return;
    setBusy(true);
    setError('');
    setIntent({ ...intent, submitted: true });
    try {
      const next = await request<ActionReceipt>('/api/actions', {
        method: 'POST',
        body: JSON.stringify({ ...intent.request, confirm: true }),
      });
      setIntent(null);
      await sync(next);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!receipt?.canUndo || busy) return;
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
    ask,
    confirm,
    undo,
    close: () => {
      if (!busy) {
        setIntent(null);
        setError('');
      }
    },
  };
}
