import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NewsletterSettingsPatch, SenderSettingsPreview } from '@brew/core/types/newsletters';
import { useOwnerActions } from '../hooks/useOwnerActions';
import { newsletterJson, newsletterRefreshKeys } from './api';

const kinds = ['update_sender'] as const;
export function useSenderActions(scopeKey: string) {
  const client = useQueryClient();
  const [preparing, setPreparing] = useState(false);
  const [preview, setPreview] = useState<SenderSettingsPreview | null>(null);
  const [error, setError] = useState<{
    id: number;
    patch: NewsletterSettingsPatch;
    message: string;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const preparingNow = useRef(false);
  const alive = useRef(true);
  const focusFrame = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      cancelAnimationFrame(focusFrame.current);
    };
  }, []);
  const owner = useOwnerActions(async () => {
    for (const key of ['article', 'newsletter-letter', 'newsletter-original'])
      client.removeQueries({ queryKey: [key], type: 'inactive' });
    await Promise.all(
      newsletterRefreshKeys
        .filter((key) => !['newsletter-letter', 'newsletter-original'].includes(key))
        .map((key) =>
          client.invalidateQueries({ queryKey: [key], refetchType: 'all' }, { throwOnError: true }),
        ),
    );
    // Retention can remove an explicitly open letter. Its own read-error UI
    // handles 404/retry; inactive detail caches must not retain pruned content.
    await Promise.all(
      ['newsletter-letter', 'newsletter-original'].map((key) =>
        client.invalidateQueries({ queryKey: [key], refetchType: 'active' }),
      ),
    );
  }, kinds);
  const latest = useRef(owner);
  useLayoutEffect(() => {
    latest.current = owner;
  }, [owner]);
  const scope = useRef(scopeKey);
  useLayoutEffect(() => {
    if (scope.current === scopeKey) return;
    scope.current = scopeKey;
    cancelAnimationFrame(focusFrame.current);
    controller.current?.abort();
    if (!latest.current.busy) latest.current.close();
  }, [scopeKey]);
  const previous = useRef(owner.receipt);
  useLayoutEffect(() => {
    if (owner.busy) return;
    if (
      owner.receipt?.status === 'undone' &&
      previous.current?.id === owner.receipt.id &&
      previous.current.status !== 'undone'
    ) {
      const id = owner.receipt.targetId;
      cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(() => {
        const targets = document.querySelectorAll<HTMLButtonElement>(
          `[data-brew-sender="${id}"][data-brew-action="more"]`,
        );
        const visible = [...targets].find((target) => target.getClientRects().length > 0);
        (visible ?? document.querySelector<HTMLElement>('main h1'))?.focus({ preventScroll: true });
      });
    }
    previous.current = owner.receipt;
  }, [owner.receipt, owner.busy]);
  const save = async (
    id: number,
    patch: NewsletterSettingsPatch,
    label: string,
    opener?: HTMLElement | null,
  ): Promise<boolean> => {
    if (
      !latest.current.capable ||
      latest.current.busy ||
      latest.current.intent ||
      preparingNow.current
    )
      return false;
    preparingNow.current = true;
    setPreparing(true);
    setError(null);
    returnFocus.current = opener ?? (document.activeElement as HTMLElement);
    const active = new AbortController();
    controller.current = active;
    const started = scope.current;
    try {
      const next = await newsletterJson<SenderSettingsPreview>(
        `/api/newsletters/senders/${id}/preview`,
        active.signal,
        { method: 'POST', body: JSON.stringify(patch) },
      );
      if (active.signal.aborted || scope.current !== started || !alive.current) return false;
      setPreview(next);
      preparingNow.current = false;
      setPreparing(false);
      controller.current = null;
      const request = { kind: 'update_sender', id, patch, revision: next.revision } as const;
      const receipt = await (next.requiresConfirmation
        ? latest.current.ask(request, next.senderTitle || label)
        : latest.current.perform(request, next.senderTitle || label));
      if (alive.current && scope.current === started) {
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = requestAnimationFrame(() => {
          if (returnFocus.current?.isConnected && returnFocus.current.getClientRects().length)
            returnFocus.current.focus();
          else document.querySelector<HTMLButtonElement>('[data-brew-action="undo"]')?.focus();
        });
      }
      return Boolean(receipt);
    } catch (failure) {
      if (active.signal.aborted || !alive.current) return false;
      setError({ id, patch, message: (failure as Error).message });
      throw failure;
    } finally {
      if (controller.current === active) {
        controller.current = null;
        preparingNow.current = false;
        if (alive.current) {
          setPreparing(false);
          if (active.signal.aborted && scope.current === started) {
            cancelAnimationFrame(focusFrame.current);
            focusFrame.current = requestAnimationFrame(() => returnFocus.current?.focus());
          }
        }
      }
    }
  };
  return {
    owner,
    capable: owner.capable,
    busy: preparing || owner.busy,
    preparing,
    returnFocus,
    save,
    error,
    clearError: () => setError(null),
    cancelPreview: () => controller.current?.abort(),
    preview:
      owner.intent?.request.kind === 'update_sender' &&
      owner.intent.request.revision === preview?.revision
        ? preview
        : null,
  };
}
