import {
  readerPageHref,
  readerPageSize,
  textTwinHref,
  type ReaderPageState,
} from '@brew/core/reader-pages';
import { navigateReaderPage } from '../readerLocation';
import { Badge } from './Badge';
import { PageControls } from './PageControls';

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
  return (
    <section
      aria-label="Reader page"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-8 py-3 text-xs text-soft"
    >
      <p aria-live="polite" aria-atomic="true">
        Showing {shown ? offset + 1 : 0}–{shown ? offset + shown : 0} of {total}
        {stale && ' · Last loaded'}
      </p>
      <PageControls
        page={state.page}
        pageSize={readerPageSize}
        total={total}
        numbered={numbered}
        label="Reader pages"
        href={(page) => readerPageHref({ ...state, page })}
        navigate={(href) => navigateReaderPage(href)}
      />
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
