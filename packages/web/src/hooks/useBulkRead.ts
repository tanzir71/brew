import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReadActionPreview, ReadActionTarget } from '@brew/core/read-actions';
import { useOwnerActions } from './useOwnerActions';

const kinds = ['mark_read'] as const;
export function useBulkRead(scopeKey: string) {
  const client = useQueryClient();
  const [preparing, setPreparing] = useState(false);
  const [preview, setPreview] = useState<ReadActionPreview | null>(null);
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);
  const last = useRef<{ target: ReadActionTarget; title: string; scope: string } | null>(null);
  const owner = useOwnerActions(async () => {
    await Promise.all(
      [
        'articles',
        'search',
        'brew-state',
        'newsletter-overview',
        'newsletter-letters',
        'reader-navigation',
      ].map((key) =>
        client.invalidateQueries(
          { queryKey: [key], refetchType: 'active' },
          { throwOnError: true },
        ),
      ),
    );
  }, kinds);
  const { canRestoreUndoFocus } = owner;
  const current = useRef(owner);
  useLayoutEffect(() => {
    current.current = owner;
  }, [owner]);
  const controller = useRef<AbortController | null>(null);
  const preparingNow = useRef(false);
  const alive = useRef(true);
  const scope = useRef(scopeKey);
  const focusScope = useRef(scopeKey);
  const frame = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      cancelAnimationFrame(frame.current);
    };
  }, []);
  useLayoutEffect(() => {
    if (scope.current === scopeKey) return;
    scope.current = scopeKey;
    cancelAnimationFrame(frame.current);
    controller.current?.abort();
    if (!current.current.busy) current.current.close();
  }, [scopeKey]);
  const restoreFocus = useCallback((afterUndo = false) => {
    cancelAnimationFrame(frame.current);
    const started = scope.current;
    frame.current = requestAnimationFrame(() => {
      if (afterUndo && (!current.current.canRestoreUndoFocus() || scope.current !== started))
        return;
      if (
        returnFocus.current?.isConnected &&
        returnFocus.current.getClientRects().length &&
        !returnFocus.current.matches(':disabled')
      )
        returnFocus.current.focus();
      else {
        const trigger = [
          ...document.querySelectorAll<HTMLButtonElement>('[data-brew-action="mark-all-read"]'),
        ].find((button) => button.getClientRects().length && !button.disabled);
        (trigger ?? document.querySelector<HTMLElement>('main h1[tabindex]'))?.focus({
          preventScroll: true,
        });
      }
    });
  }, []);
  const previous = useRef(owner.receipt);
  useLayoutEffect(() => {
    if (owner.busy) return;
    if (
      owner.receipt?.status === 'undone' &&
      canRestoreUndoFocus() &&
      previous.current?.id === owner.receipt.id &&
      previous.current.status !== 'undone' &&
      focusScope.current === scope.current
    )
      restoreFocus(true);
    previous.current = owner.receipt;
  }, [owner.receipt, owner.busy, canRestoreUndoFocus, restoreFocus]);
  const ask = useCallback(
    async (target: ReadActionTarget, title: string, opener?: HTMLElement | null): Promise<void> => {
      if (
        !current.current.capable ||
        current.current.busy ||
        current.current.intent ||
        preparingNow.current
      )
        return;
      const started = scope.current;
      focusScope.current = started;
      last.current = { target, title, scope: started };
      const active = new AbortController();
      controller.current = active;
      preparingNow.current = true;
      setPreparing(true);
      setError(null);
      setPreview(null);
      returnFocus.current = opener ?? (document.activeElement as HTMLElement);
      try {
        const response = await fetch('/api/actions/mark-read/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(target),
          signal: active.signal,
        });
        const value = await response.json();
        if (!response.ok)
          throw new Error(value.error ?? 'Could not review unread articles. Try again.');
        if (active.signal.aborted || !alive.current || scope.current !== started) return;
        setPreview(value as ReadActionPreview);
        controller.current = null;
        preparingNow.current = false;
        setPreparing(false);
        await current.current.ask(
          { kind: 'mark_read', target, revision: (value as ReadActionPreview).revision },
          title,
        );
        if (alive.current && scope.current === started) restoreFocus();
      } catch (failure) {
        if (!active.signal.aborted && alive.current && scope.current === started)
          setError({ scope: started, message: (failure as Error).message });
      } finally {
        if (controller.current === active) {
          controller.current = null;
          preparingNow.current = false;
          if (alive.current) {
            setPreparing(false);
            if (scope.current === started) restoreFocus();
          }
        }
      }
    },
    [restoreFocus],
  );
  return {
    owner: {
      ...owner,
      undo: () => {
        focusScope.current = scope.current;
        return owner.undo();
      },
    },
    preview:
      owner.intent?.request.kind === 'mark_read' &&
      owner.intent.request.revision === preview?.revision
        ? preview
        : null,
    preparing,
    busy: preparing || owner.busy,
    capable: owner.capable,
    ask,
    error: error?.scope === scopeKey ? error.message : '',
    retry: () => {
      if (last.current?.scope === scope.current)
        void ask(last.current.target, last.current.title, returnFocus.current);
    },
    cancel: () => controller.current?.abort(),
    returnFocus,
  };
}
