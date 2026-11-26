import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { readerPageHref, type ReaderPageState } from '@brew/core/reader-pages';
import { navigateReaderPage } from '../readerLocation';

type ReadQuery = {
  data: unknown;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  isFetchNextPageError?: boolean;
  refetch: () => Promise<{ isError: boolean }>;
  fetchNextPage?: () => Promise<{ isError: boolean }>;
};

export function ReaderReadFeedback({
  query,
  subject,
  retryLabel,
  moreLabel,
  focusRef,
  announcement = '',
  compact = false,
}: {
  query: ReadQuery;
  subject: string;
  retryLabel: string;
  moreLabel?: string;
  focusRef: RefObject<HTMLElement>;
  announcement?: string;
  compact?: boolean;
}) {
  const [acting, setActing] = useState<'page' | 'more' | null>(null);
  const [retryFailed, setRetryFailed] = useState<'page' | 'more' | null>(null);
  const busy = useRef(false);
  const alive = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const retry = async (kind: 'page' | 'more', trigger: HTMLButtonElement) => {
    if (busy.current) return;
    busy.current = true;
    setActing(kind);
    setRetryFailed(null);
    const scope = location.pathname + location.search;
    try {
      const result =
        kind === 'more' && query.fetchNextPage
          ? await query.fetchNextPage()
          : await query.refetch();
      if (alive.current) setRetryFailed(result.isError ? kind : null);
    } catch {
      if (alive.current) setRetryFailed(kind);
    } finally {
      busy.current = false;
      if (alive.current) {
        const ownedFocus =
          document.activeElement === trigger || document.activeElement === document.body;
        setActing(null);
        if (ownedFocus)
          requestAnimationFrame(() => {
            if (
              !alive.current ||
              scope !== location.pathname + location.search ||
              document.querySelector('dialog:modal') ||
              (document.activeElement !== document.body && document.activeElement !== trigger)
            )
              return;
            const target = trigger.isConnected ? trigger : focusRef.current;
            if (
              target?.isConnected &&
              target.getClientRects().length &&
              !target.matches(':disabled')
            )
              target.focus({ preventScroll: true });
          });
      }
    }
  };
  // A failed initial refetch can resolve before the observer publishes its error.
  // Retain the native retry button through that pending transition to preserve focus.
  const pendingFailure = query.isPending && retryFailed !== null;
  const failed = query.isError || pendingFailure || acting !== null;
  const more =
    acting === 'more' ||
    (acting === null && (query.isFetchNextPageError || (pendingFailure && retryFailed === 'more')));
  return (
    <>
      <section
        className="sr-only"
        aria-label={`${subject} read result`}
        aria-live="polite"
        aria-atomic="true"
      >
        {!query.isPending && !failed ? announcement : ''}
      </section>
      {query.isPending && !failed && (
        <p
          role="status"
          aria-label={`${subject} read status`}
          className={compact ? 'px-3 py-3 text-xs text-soft' : 'px-8 py-6 text-sm text-soft'}
        >
          Loading {subject}…
        </p>
      )}
      {failed && (
        <div
          role="alert"
          className={
            compact
              ? 'space-y-2 px-3 py-3 text-xs text-danger'
              : 'space-y-2 border-b border-line px-8 py-4 text-sm text-danger'
          }
        >
          <p>
            {more
              ? `Could not load more ${subject}. The loaded items are still available.`
              : query.data !== undefined
                ? `Could not refresh ${subject}. The last loaded result is still shown.`
                : `Could not load ${subject}.`}
          </p>
          <button
            type="button"
            data-brew-action={more ? 'retry-more' : 'retry-read'}
            className="brew-button brew-button--secondary brew-button--sm"
            disabled={acting !== null || query.isFetching}
            onClick={(event) => void retry(more ? 'more' : 'page', event.currentTarget)}
          >
            {acting !== null ? 'Retrying…' : more ? (moreLabel ?? 'Retry more') : retryLabel}
          </button>
        </div>
      )}
    </>
  );
}

export function ReaderEmptyPage({ state, children }: { state: ReaderPageState; children: string }) {
  return (
    <div className="px-10 py-20 text-center text-sm text-soft">
      <p>{state.page > 1 ? 'No items on this page. The results may have changed.' : children}</p>
      {state.page > 1 && (
        <a
          className="brew-button brew-button--secondary brew-button--sm mt-4"
          data-brew-action="first-page"
          href={readerPageHref({ ...state, page: 1 })}
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            navigateReaderPage(event.currentTarget.getAttribute('href')!);
          }}
        >
          First page
        </a>
      )}
    </div>
  );
}
