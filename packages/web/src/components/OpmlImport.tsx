import { useLayoutEffect, useRef, useState } from 'react';
import type { useOpmlImport } from '../hooks/useOpmlImport';
import type { OpmlPreview } from '@brew/core/opml';
import { Button } from './controls';
import { Badge } from './Badge';
import { Icon } from './Icon';

export function OpmlImportPicker({
  flow,
  disabled = false,
  inputLabel = 'Import OPML',
  ghost = false,
  label = 'Import OPML',
  showIcon = true,
  className,
}: {
  flow: ReturnType<typeof useOpmlImport>;
  disabled?: boolean;
  inputLabel?: string;
  ghost?: boolean;
  label?: string;
  showIcon?: boolean;
  className?: string;
}) {
  const file = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const reviewed = useRef(false);
  useLayoutEffect(() => {
    if (flow.preview) reviewed.current = true;
    else if (reviewed.current && !disabled && !flow.preparing) {
      reviewed.current = false;
      trigger.current?.focus();
    }
  }, [flow.preview, flow.preparing, disabled]);
  return (
    <>
      <Button
        buttonRef={trigger}
        size="sm"
        variant={ghost ? 'ghost' : 'secondary'}
        icon={showIcon ? <Icon name="download" size={14} /> : undefined}
        className={className}
        disabled={disabled || flow.preparing || !flow.capable}
        onClick={() => file.current?.click()}
      >
        {flow.preparing ? 'Reading OPML…' : label}
      </Button>
      <input
        hidden
        type="file"
        accept=".opml,.xml,text/x-opml,text/xml,application/xml"
        aria-label={inputLabel}
        disabled={disabled || !flow.capable || flow.preparing}
        ref={file}
        onChange={(event) => {
          const next = event.target.files?.[0];
          event.target.value = '';
          if (next) void flow.pick(next);
        }}
      />
      {!flow.capable && (
        <span className="text-xs">
          <Badge tone="warning">Undo needs setup</Badge>{' '}
          <a href="/settings/runs#setup-data">Set up OPML import</a>
        </span>
      )}
    </>
  );
}
export function OpmlImportFeedback({ flow }: { flow: ReturnType<typeof useOpmlImport> }) {
  return (
    <>
      {flow.preparing && (
        <p role="status" className="source-message">
          Reading OPML…{' '}
          <Button size="sm" variant="secondary" onClick={flow.cancel}>
            Cancel OPML preview
          </Button>
        </p>
      )}
      {flow.error && (
        <div role="alert" className="source-error">
          <p>{flow.error}</p>
          <div className="mt-3 flex gap-3">
            {flow.retry && (
              <Button size="sm" variant="secondary" onClick={flow.retry}>
                Retry OPML preview
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={flow.cancel}>
              Cancel OPML preview
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
export function OpmlImportReview({ name, data }: { name: string; data: OpmlPreview }) {
  const [page, setPage] = useState(1);
  const size = 50;
  const rows = data.outlines.slice((page - 1) * size, page * size);
  const first = rows.length ? (page - 1) * size + 1 : 0;
  return (
    <div className="mt-4">
      <p className="text-sm break-words">{name}</p>
      <p className="mt-2 text-sm">
        {data.imported} new {data.imported === 1 ? 'feed' : 'feeds'} · {data.skipped} existing or
        duplicate · {data.foldersCreated} new {data.foldersCreated === 1 ? 'folder' : 'folders'}
      </p>
      <p aria-live="polite" aria-atomic="true" className="mt-3 text-xs text-soft">
        Showing {first ? `${first}–${first + rows.length - 1}` : '0'} of {data.outlines.length}{' '}
        outlines
      </p>
      <ul
        tabIndex={0}
        aria-label="OPML subscriptions"
        className="mt-2 max-h-64 overflow-auto divide-y rounded-lg border border-line"
      >
        {rows.map((row, index) => (
          <li key={(page - 1) * size + index} className="p-3 text-sm">
            <span className="block break-words">{row.title}</span>
            <span className="block text-xs text-soft break-words">
              {row.source}
              {row.folder ? ` · ${row.folder}` : ''} ·{' '}
              {row.status === 'add'
                ? 'New'
                : row.status === 'subscribed'
                  ? 'Already subscribed'
                  : 'Duplicate in this file'}
            </span>
          </li>
        ))}
      </ul>
      {data.outlines.length > size && (
        <nav aria-label="OPML preview pages" className="mt-3 flex gap-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous outlines
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={page * size >= data.outlines.length}
            onClick={() => setPage(page + 1)}
          >
            Next outlines
          </Button>
        </nav>
      )}
    </div>
  );
}
