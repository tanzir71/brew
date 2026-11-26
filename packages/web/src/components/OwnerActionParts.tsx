import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { ModalSheet } from './Sheet';
import { Button } from './controls';
import { Badge } from './Badge';
import type { useOwnerActions } from '../hooks/useOwnerActions';
type OwnerAction = ReturnType<typeof useOwnerActions>;

export function OwnerActionConfirmation({
  action,
  children,
  returnFocusRef,
  confirmLabel,
  confirmDisabled = false,
}: {
  action: OwnerAction;
  children?: ReactNode;
  returnFocusRef?: RefObject<HTMLElement>;
  confirmLabel?: string;
  confirmDisabled?: boolean;
}) {
  const intent = action.intent;
  const applying = intent?.request.kind === 'apply_rule';
  const importing = intent?.request.kind === 'import_opml';
  const sender = intent?.request.kind === 'update_sender';
  const reading = intent?.request.kind === 'mark_read';
  const copying = intent?.request.kind === 'copy_rule';
  const days = intent?.request.kind === 'apply_rule' ? (intent.request.days ?? 30) : 30;
  const cancel = useRef<HTMLButtonElement>(null);
  const title = reading
    ? intent.label
    : importing
      ? 'Import OPML?'
      : sender
        ? `Update ${intent.label}?`
        : intent
          ? `${copying ? 'Copy' : applying ? 'Apply' : 'Delete'} ${intent.label}?`
          : 'Confirm action';
  return (
    <ModalSheet
      open={Boolean(intent)}
      title={title}
      onClose={action.close}
      initialFocusRef={cancel}
      returnFocusRef={returnFocusRef}
    >
      <p>
        {reading
          ? 'Only the reviewed unread stories will be marked read. Undo can restore their read states for 30 seconds while they remain unchanged.'
          : importing
            ? 'Existing subscriptions are kept. New feeds and folders can be undone for 30 seconds if they remain unused and unchanged.'
            : sender
              ? 'Review these sender changes. Undo can restore their local changes for 30 seconds while the affected data remains unchanged.'
              : copying
                ? 'Creates a disabled copy of the saved rule. Existing articles and the source rule stay unchanged.'
                : applying
                  ? `Apply this saved rule to articles from the last ${days} days?`
                  : intent?.request.kind === 'delete_feed'
                    ? 'This removes the feed and its articles.'
                    : intent?.request.kind === 'delete_folder'
                      ? 'Feeds in this folder will become unfiled.'
                      : 'This removes the rule and its execution history.'}
        {!importing && !sender && !reading && ' Undo is available for 30 seconds.'}
      </p>
      {(importing || sender || reading) && children}
      {intent?.externalEffects && (
        <p className="mt-3 text-sm text-soft">
          Undo restores local changes. Notifications and webhooks cannot be recalled.
        </p>
      )}
      {action.error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {action.error}
          {intent?.submitted && ' The action may have finished. Check result to recover it.'}
        </p>
      )}
      {!action.capable && (
        <p className="mt-3 text-sm">
          <Badge tone="warning">Undo needs setup</Badge>{' '}
          <a href="/settings/runs#setup-agents">Set up actions</a>
        </p>
      )}
      <div className="mt-5 flex gap-3">
        <button
          ref={cancel}
          type="button"
          className="brew-button brew-button--secondary brew-button--md"
          disabled={action.busy}
          onClick={action.close}
        >
          {intent?.submitted ? 'Close' : 'Cancel'}
        </button>
        <Button
          disabled={action.busy || !action.capable || confirmDisabled}
          data-brew-action="confirm-action"
          onClick={() => void action.confirm()}
        >
          {action.busy
            ? 'Working…'
            : intent?.submitted
              ? 'Check result'
              : confirmLabel
                ? confirmLabel
                : importing
                  ? 'Import'
                  : sender
                    ? 'Save sender'
                    : applying
                      ? 'Apply rule'
                      : copying
                        ? 'Copy rule'
                        : 'Delete'}
        </Button>
      </div>
    </ModalSheet>
  );
}
export function OwnerActionResult({
  action,
  inline = false,
  showSetup = true,
  status = false,
  resultName = 'Action result',
  returnFocusRef,
  handlesUndoFocus = false,
}: {
  action: OwnerAction;
  inline?: boolean;
  showSetup?: boolean;
  status?: boolean;
  resultName?: string;
  returnFocusRef?: RefObject<HTMLElement>;
  handlesUndoFocus?: boolean;
}) {
  const result = useRef<HTMLElement>(null);
  const undoButton = useRef<HTMLButtonElement | null>(null);
  const ownsFocus = useRef(false);
  const restore = useRef(false);
  useEffect(() => {
    const moved = (event: FocusEvent | PointerEvent) => {
      if (event.target !== document.body && !undoButton.current?.contains(event.target as Node)) {
        ownsFocus.current = false;
        restore.current = false;
      }
    };
    const left = () => {
      ownsFocus.current = false;
      restore.current = false;
    };
    document.addEventListener('focusin', moved);
    document.addEventListener('pointerdown', moved);
    window.addEventListener('popstate', left);
    window.addEventListener('blur', left);
    return () => {
      document.removeEventListener('focusin', moved);
      document.removeEventListener('pointerdown', moved);
      window.removeEventListener('popstate', left);
      window.removeEventListener('blur', left);
    };
  }, []);
  const buttonRef = useCallback((node: HTMLButtonElement | null) => {
    if (!node && undoButton.current && ownsFocus.current) {
      restore.current = true;
      ownsFocus.current = false;
    }
    undoButton.current = node;
  }, []);
  useLayoutEffect(() => {
    if (!restore.current || action.busy) return;
    if (handlesUndoFocus && action.receipt?.status === 'undone') {
      restore.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (!restore.current) return;
      restore.current = false;
      if (document.activeElement !== document.body) return;
      const opener = returnFocusRef?.current;
      const openerBox = opener?.getBoundingClientRect();
      const retry = undoButton.current;
      const target =
        retry?.isConnected && !retry.disabled
          ? retry
          : opener?.isConnected &&
              openerBox &&
              openerBox.width > 0 &&
              openerBox.height > 0 &&
              openerBox.bottom > 0 &&
              openerBox.top < innerHeight &&
              !opener.matches(':disabled')
            ? opener
            : result.current;
      const modal = document.querySelector('dialog:modal');
      if (
        target?.isConnected &&
        target.getClientRects().length &&
        (!modal || modal.contains(target))
      )
        target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  });
  return (
    <>
      {showSetup && !action.capable && (
        <p className="text-sm text-soft">
          <Badge tone="warning">Undo needs setup</Badge> <a href="/settings/runs">Set up actions</a>
        </p>
      )}
      <section
        ref={result}
        tabIndex={-1}
        aria-label={resultName}
        role={status && action.receipt ? 'status' : undefined}
        aria-live="polite"
        aria-atomic="true"
        className={
          action.receipt
            ? inline
              ? 'source-message mt-3 flex flex-wrap items-center gap-3'
              : 'brew-undo-toast fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-4 rounded-xl bg-inverse px-5 py-3 text-sm text-on-inverse shadow-overlay'
            : 'sr-only'
        }
      >
        {action.receipt && (
          <>
            <span>
              {action.receipt.status === 'undone' ? 'Undid local changes.' : action.receipt.summary}
            </span>
            {action.receipt.canUndo && (
              <button
                ref={buttonRef}
                type="button"
                data-brew-action="undo"
                disabled={action.busy || !action.capable}
                onFocus={() => {
                  ownsFocus.current = true;
                }}
                onClick={() => {
                  ownsFocus.current = true;
                  restore.current = true;
                  void action.undo();
                }}
                className="min-h-6 font-semibold"
              >
                Undo
              </button>
            )}
          </>
        )}
      </section>
      {!action.intent && action.error && (
        <p role="alert" className="text-sm text-danger">
          {action.error}
        </p>
      )}
      {action.historyError && (
        <div role="alert" className="text-sm text-danger">
          <p>{action.historyError}</p>
          <Button variant="secondary" onClick={action.recover}>
            Retry actions
          </Button>
        </div>
      )}
    </>
  );
}
