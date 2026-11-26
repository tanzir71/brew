import {
  readerPageHref,
  readerPageSize,
  textTwinHref,
  type ReaderPageState,
} from '@brew/core/reader-pages';
import { navigateReader } from '../readerLocation';
import { Badge } from './Badge';

export function ReaderPageFooter({
  state,
  total,
  shown,
  twins,
}: {
  state: ReaderPageState;
  total: number;
  shown: number;
  twins: boolean;
}) {
  const offset = (state.page - 1) * readerPageSize;
  const href = readerPageHref(state);
  const link = (page: number, label: string) => (
    <a
      className="brew-button brew-button--secondary brew-button--sm"
      href={readerPageHref({ ...state, page })}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        navigateReader(event.currentTarget.getAttribute('href')!);
      }}
    >
      {label}
    </a>
  );
  return (
    <section
      aria-label="Reader page"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-8 py-3 text-xs text-soft"
    >
      <p aria-live="polite" aria-atomic="true">
        Showing {shown ? offset + 1 : 0}–{shown ? offset + shown : 0} of {total}
      </p>
      <nav aria-label="Reader pages" className="flex items-center gap-2">
        {state.page > 1 ? (
          link(state.page - 1, 'Previous')
        ) : (
          <button className="brew-button brew-button--secondary brew-button--sm" disabled>
            Previous
          </button>
        )}
        <span aria-current="page">Page {state.page}</span>
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
