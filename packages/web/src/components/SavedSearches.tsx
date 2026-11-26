import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { readerPageHref } from '@brew/core/reader-pages';
import { navigateReader, readerState } from '../readerLocation';
import { savedSearchHref, type SavedSearch } from '../savedSearches';
import type { useSavedSearches } from '../hooks/useSavedSearches';
import { ModalSheet } from './Sheet';
import { Button, IconButton, Input } from './controls';
import { agentPageHref } from '../agentLocation';

type Searches = ReturnType<typeof useSavedSearches>;
const follow = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  navigateReader(href);
};
export function SavedSearchList({ action }: { action: Searches }) {
  const [intent, setIntent] = useState<{ search: SavedSearch; confirm: boolean } | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const result = useRef<HTMLElement>(null);
  const undo = useRef<HTMLButtonElement>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const focusAfter = useRef<string | 'result' | null>(null);
  useLayoutEffect(() => {
    if (intent !== null || !focusAfter.current) return;
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === 'result') (undo.current ?? result.current)?.focus();
    else links.current.get(target)?.focus();
  }, [action.searches, intent]);
  const summary =
    action.message ||
    (action.receipt ? `Deleted saved search “${action.receipt.search.name}”.` : '');
  return (
    <>
      {action.searches.length > 0 && (
        <section className="mb-5" aria-label="Saved searches">
          <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted">
            Saved searches
          </p>
          {action.searches.map((search) => {
            const href = agentPageHref(savedSearchHref(search));
            const selected = location.pathname + location.search === href;
            return (
              <div key={search.id} className="saved-search-row" data-saved-search-id={search.id}>
                <a
                  href={href}
                  ref={(node) => {
                    if (node) links.current.set(search.id, node);
                    else links.current.delete(search.id);
                  }}
                  onClick={(event) => follow(event, href)}
                  aria-current={selected ? 'page' : undefined}
                  data-brew-action="open-search"
                  className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm ${selected ? 'bg-subtle font-semibold text-ink' : 'text-soft hover:bg-subtle hover:text-ink'}`}
                >
                  <span className="block truncate">⌕ {search.name}</span>
                </a>
                <IconButton
                  icon="more"
                  label={`More actions for saved search ${search.name}`}
                  data-brew-action="more-search"
                  aria-haspopup="dialog"
                  className="saved-search-more"
                  onClick={() => {
                    action.clearError();
                    setIntent({ search, confirm: false });
                  }}
                />
              </div>
            );
          })}
        </section>
      )}
      {action.loadError && (
        <div role="alert" className="text-sm text-danger">
          <p>{action.loadError}</p>
          <Button
            variant="secondary"
            onClick={() => {
              action.clearError();
              action.refresh();
            }}
          >
            Retry saved searches
          </Button>
        </div>
      )}
      <ModalSheet
        key={intent?.confirm ? 'confirm' : 'more'}
        open={intent !== null}
        title={
          intent?.confirm
            ? `Delete saved search “${intent.search.name}”?`
            : `Saved search “${intent?.search.name ?? ''}”`
        }
        initialFocusRef={intent?.confirm ? cancel : undefined}
        onClose={() => setIntent(null)}
      >
        {intent?.confirm ? (
          <>
            <p>
              This removes the bookmark from this browser. Saved Compose sources are kept. You can
              undo the latest deletion in this tab for up to 30 seconds, including after reload.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                ref={cancel}
                className="brew-button brew-button--secondary brew-button--md"
                onClick={() => setIntent(null)}
              >
                Cancel
              </button>
              <Button
                data-brew-action="confirm-delete-search"
                onClick={() => {
                  if (action.remove(intent.search)) {
                    focusAfter.current = 'result';
                    setIntent(null);
                  }
                }}
              >
                Delete saved search
              </Button>
            </div>
          </>
        ) : (
          intent && (
            <div className="flex flex-wrap items-center gap-3">
              <a
                className="brew-button brew-button--secondary brew-button--md"
                href={savedSearchHref(intent.search)}
                onClick={(event) => {
                  follow(event, savedSearchHref(intent.search));
                  if (event.defaultPrevented) setIntent(null);
                }}
              >
                Open search
              </a>
              <Button
                variant="secondary"
                data-brew-action="delete-search"
                onClick={() => setIntent({ ...intent, confirm: true })}
              >
                Delete saved search
              </Button>
            </div>
          )
        )}
        {intent && action.error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {action.error}
          </p>
        )}
      </ModalSheet>
      {!intent && action.error && (
        <p role="alert" className="text-sm text-danger">
          {action.error}
        </p>
      )}
      <section
        ref={result}
        tabIndex={-1}
        aria-label="Saved search result"
        aria-live="polite"
        aria-atomic="true"
        className={
          summary
            ? 'saved-search-result brew-undo-toast fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-wrap items-center gap-4 rounded-xl bg-inverse px-5 py-3 text-sm text-on-inverse shadow-overlay'
            : 'sr-only'
        }
      >
        {summary && <span>{summary}</span>}
        {summary && !action.receipt && (
          <button
            type="button"
            aria-label="Dismiss saved search result"
            className="min-h-6"
            onClick={() => {
              action.dismiss();
              links.current.values().next().value?.focus();
            }}
          >
            Dismiss
          </button>
        )}
        {action.receipt && (
          <button
            type="button"
            ref={undo}
            data-brew-action="undo-search"
            className="min-h-6"
            onClick={() => {
              const id = action.receipt!.search.id;
              if (action.undo()) focusAfter.current = id;
            }}
          >
            Undo deletion of “{action.receipt.search.name}”
          </button>
        )}
      </section>
    </>
  );
}

export function SaveSearchDialog({
  action,
  query,
  onClose,
}: {
  action: Searches;
  query: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(query);
  const input = useRef<HTMLInputElement>(null);
  return (
    <ModalSheet open title="Save search" onClose={onClose} initialFocusRef={input}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || !query.trim()) return;
          if (
            action.save({
              id: crypto.randomUUID(),
              name: name.trim(),
              query,
              href: readerPageHref({ ...readerState(), kind: 'search', q: query, page: 1 }),
            })
          )
            onClose();
        }}
      >
        <p className="mb-4 text-sm text-soft">
          Save this query and its current filters in this browser.
        </p>
        <Input
          label="Saved search name"
          inputRef={input}
          value={name}
          maxLength={160}
          required
          onChange={(event) => setName(event.target.value)}
        />
        {action.error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {action.error}
          </p>
        )}
        <div className="mt-5 flex gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!name.trim() || !query.trim()}
            data-brew-action="save-search"
          >
            Save search
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}
