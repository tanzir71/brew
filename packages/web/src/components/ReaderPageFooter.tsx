import {
  readerPageHref,
  readerPageSize,
  textTwinHref,
  type ReaderPageState,
} from '@brew/core/reader-pages';
import { navigateReaderPage } from '../readerLocation';
import { Badge } from './Badge';

export function ReaderPageFooter({
  state,
  total,
  shown,
  twins,
  stale = false,
  numbered = false,
}: {
  state: ReaderPageState;
  total: number;
  shown: number;
  twins: boolean;
  stale?: boolean;
  numbered?: boolean;
}) {
  const offset = (state.page - 1) * readerPageSize;
  const href = readerPageHref({ ...state, agent: numbered || state.agent });
  const lastPage = Math.max(1, Math.ceil(total / readerPageSize));
  const numbers = [
    ...new Set([
      1,
      lastPage,
      state.page,
      ...Array.from({ length: 5 }, (_, i) => state.page + i - 2).filter(
        (page) => page >= 1 && page <= lastPage,
      ),
    ]),
  ].sort((a, b) => a - b);
  const link = (page: number, label: string) => (
    <a
      className="brew-button brew-button--secondary brew-button--sm"
      href={readerPageHref({ ...state, page })}
      aria-label={label.startsWith('Page ') ? label : undefined}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        navigateReaderPage(event.currentTarget.getAttribute('href')!);
      }}
    >
      {label.startsWith('Page ') ? label.slice(5) : label}
    </a>
  );
  return (
    <section
      aria-label="Reader page"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-8 py-3 text-xs text-soft"
    >
      <p aria-live="polite" aria-atomic="true">
        Showing {shown ? offset + 1 : 0}–{shown ? offset + shown : 0} of {total}
        {stale && ' · Last loaded'}
      </p>
      <nav aria-label="Reader pages" className="flex items-center gap-2">
        {state.page > 1 ? (
          link(state.page - 1, 'Previous')
        ) : (
          <button className="brew-button brew-button--secondary brew-button--sm" disabled>
            Previous
          </button>
        )}
        {numbered ? (
          <>
            <span className="sr-only">
              Page {state.page}
              {state.page <= lastPage ? ` of ${lastPage}` : ` · ${lastPage} available`}
            </span>
            {numbers.map((page, index) => (
              <span key={page} className="inline-flex items-center gap-2">
                {index > 0 && page - numbers[index - 1]! > 1 && <span aria-hidden="true">…</span>}
                {page === state.page ? (
                  <span
                    aria-current="page"
                    aria-label={`Page ${page}`}
                    className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-md bg-subtle"
                  >
                    {page}
                  </span>
                ) : (
                  link(page, `Page ${page}`)
                )}
              </span>
            ))}
          </>
        ) : (
          <span aria-current="page">Page {state.page}</span>
        )}
        {offset + readerPageSize < total ? (
          link(state.page + 1, 'Next')
        ) : (
          <button className="brew-button brew-button--secondary brew-button--sm" disabled>
            Next
          </button>
        )}
      </nav>
      <nav aria-label="Reader text formats" className="flex items-center gap-2">
        {(['md', 'json'] as const).map((format) =>
          twins ? (
            <a
              key={format}
              className="min-h-6 inline-flex items-center text-accent"
              href={textTwinHref(href, format)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {format === 'md' ? 'Markdown' : 'JSON'}
            </a>
          ) : (
            <button key={format} disabled className="min-h-6">
              {format === 'md' ? 'Markdown' : 'JSON'}
            </button>
          ),
        )}
        {!twins && (
          <>
            <Badge tone="warning">Twins need setup</Badge>
            <a href="/settings/runs">Set up</a>
          </>
        )}
      </nav>
    </section>
  );
}
