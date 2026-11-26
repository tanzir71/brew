import { useRef, type ReactNode, type RefObject } from 'react';
import { ModalSheet } from './Sheet';
import { Button } from './controls';
import { Badge } from './Badge';
import type { useOwnerActions } from '../hooks/useOwnerActions';
type OwnerAction = ReturnType<typeof useOwnerActions>;

export function OwnerActionConfirmation({
  action,
  children,
  returnFocusRef,
}: {
  action: OwnerAction;
  children?: ReactNode;
  returnFocusRef?: RefObject<HTMLElement>;
}) {
  const intent = action.intent;
  const applying = intent?.request.kind === 'apply_rule';
  const importing = intent?.request.kind === 'import_opml';
  const sender = intent?.request.kind === 'update_sender';
  const days = intent?.request.kind === 'apply_rule' ? (intent.request.days ?? 30) : 30;
  const cancel = useRef<HTMLButtonElement>(null);
  const title = importing
    ? 'Import OPML?'
    : sender
      ? `Update ${intent.label}?`
      : intent
        ? `${applying ? 'Apply' : 'Delete'} ${intent.label}?`
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
        {importing
          ? 'Existing subscriptions are kept. New feeds and folders can be undone for 30 seconds if they remain unused and unchanged.'
          : sender
            ? 'Review these sender changes. Undo can restore their local changes for 30 seconds while the affected data remains unchanged.'
            : applying
              ? `Apply this saved rule to articles from the last ${days} days?`
              : intent?.request.kind === 'delete_feed'
                ? 'This removes the feed and its articles.'
                : intent?.request.kind === 'delete_folder'
                  ? 'Feeds in this folder will become unfiled.'
                  : 'This removes the rule and its execution history.'}
        {!importing && !sender && ' Undo is available for 30 seconds.'}
      </p>
      {(importing || sender) && children}
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
          disabled={action.busy || !action.capable}
          data-brew-action="confirm-action"
          onClick={() => void action.confirm()}
        >
          {action.busy
            ? 'Working…'
            : intent?.submitted
              ? 'Check result'
              : importing
                ? 'Import'
                : sender
                  ? 'Save sender'
                  : applying
                    ? 'Apply rule'
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
}: {
  action: OwnerAction;
  inline?: boolean;
  showSetup?: boolean;
}) {
  return (
    <>
      {showSetup && !action.capable && (
        <p className="text-sm text-soft">
          <Badge tone="warning">Undo needs setup</Badge> <a href="/settings/runs">Set up actions</a>
        </p>
      )}
      <section
        aria-label="Action result"
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
                type="button"
                data-brew-action="undo"
                disabled={action.busy || !action.capable}
                onClick={() => void action.undo()}
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
