import { OwnerActionConfirmation, OwnerActionResult } from './OwnerActionParts';
import type { useBulkRead } from '../hooks/useBulkRead';
import { Button } from './controls';
export function BulkReadUi({
  action,
  counted = false,
}: {
  action: ReturnType<typeof useBulkRead>;
  counted?: boolean;
}) {
  const count = action.preview?.updated ?? 0;
  return (
    <>
      {action.preparing && (
        <p role="status" className="text-sm text-soft">
          Reviewing unread articles…{' '}
          <Button variant="secondary" size="sm" onClick={action.cancel}>
            Cancel review
          </Button>
        </p>
      )}
      {action.error && (
        <p role="alert" className="text-sm text-danger">
          {action.error}{' '}
          <Button variant="secondary" size="sm" onClick={action.retry}>
            Retry read review
          </Button>
        </p>
      )}
      <OwnerActionConfirmation
        action={action.owner}
        returnFocusRef={action.returnFocus}
        confirmDisabled={!action.preview || !count}
        confirmLabel={counted ? `Mark ${count} read` : 'Mark all read'}
      >
        {action.preview && (
          <div className="mt-3 space-y-2">
            <p>
              {count} unread {count === 1 ? 'story' : 'stories'} will also be marked read in your
              library.
            </p>
            {action.preview.unavailable > 0 && (
              <p>
                {action.preview.unavailable} archived{' '}
                {action.preview.unavailable === 1 ? 'story is' : 'stories are'} no longer in your
                library and will be kept unchanged.
              </p>
            )}
            {!count && <p>There are no unread stories in this scope.</p>}
          </div>
        )}
      </OwnerActionConfirmation>
      <OwnerActionResult action={action.owner} status resultName="Bulk read result" />
      {!action.owner.intent && action.owner.error && (
        <a href={location.pathname + location.search} className="text-sm underline">
          Reload view
        </a>
      )}
    </>
  );
}
