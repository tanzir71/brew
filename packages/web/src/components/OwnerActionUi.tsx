import { ModalSheet } from './Sheet';
import { Button } from './controls';
import { Badge } from './Badge';
import type { useOwnerActions } from '../hooks/useOwnerActions';

export function OwnerActionUi({ action }: { action: ReturnType<typeof useOwnerActions> }) {
  const intent = action.intent;
  const applying = intent?.request.kind === 'apply_rule';
  const title = intent ? `${applying ? 'Apply' : 'Delete'} ${intent.label}?` : 'Confirm action';
  return (
    <>
      {!action.capable && (
        <p className="text-sm text-soft">
          <Badge tone="warning">Undo needs setup</Badge> <a href="/settings/runs">Set up actions</a>
        </p>
      )}
      <ModalSheet open={Boolean(intent)} title={title} onClose={action.close}>
        <p>
          {applying
            ? `Apply this saved rule to articles from the last ${intent?.request.days ?? 30} days?`
            : intent?.request.kind === 'delete_feed'
              ? 'This removes the feed and its articles.'
              : intent?.request.kind === 'delete_folder'
                ? 'Feeds in this folder will become unfiled.'
                : 'This removes the rule and its execution history.'}{' '}
          Undo is available for 30 seconds.
        </p>
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
        <div className="mt-5 flex gap-3">
          <Button variant="secondary" disabled={action.busy} onClick={action.close}>
            {intent?.submitted ? 'Close' : 'Cancel'}
          </Button>
          <Button
            disabled={action.busy}
            data-brew-action="confirm-action"
            onClick={() => void action.confirm()}
          >
            {action.busy
              ? 'Working…'
              : intent?.submitted
                ? 'Check result'
                : applying
                  ? 'Apply rule'
                  : 'Delete'}
          </Button>
        </div>
      </ModalSheet>
      <section
        aria-label="Action result"
        aria-live="polite"
        aria-atomic="true"
        className={
          action.receipt
            ? 'brew-undo-toast fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-inverse px-5 py-3 text-sm text-on-inverse shadow-overlay'
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
                disabled={action.busy}
                onClick={() => void action.undo()}
                className="min-h-6 font-semibold"
              >
                Undo
              </button>
            )}
          </>
        )}
      </section>
      {!intent && action.error && (
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
