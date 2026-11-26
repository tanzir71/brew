import { useWebMcpSurface } from './webmcp/useWebMcpSurface';
import { agentPageHref } from './agentLocation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FeedCandidate,
  FeedSummary,
  FolderSummary,
  HiddenArticlePage,
} from '@brew/core/types/api';
import { feedLibraryLocation, feedLibraryHref } from '@brew/core/app-pages';
import { usePageAlternates } from './hooks/usePageAlternates';
import { useOwnerActions } from './hooks/useOwnerActions';
import { OwnerActionUi } from './components/OwnerActionUi';
import { ModalSheet } from './components/Sheet';
import { Button, IconButton, Input } from './components/controls';
import { Icon } from './components/Icon';
import { articleDom } from './articleDom';
import { Badge } from './components/Badge';
import { useCapabilities } from './hooks/useCapabilities';
import { useOpmlImport } from './hooks/useOpmlImport';
import { OpmlImportPicker, OpmlImportFeedback, OpmlImportReview } from './components/OpmlImport';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(value.error || 'Could not finish this request.');
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
type Edit =
  | { kind: 'rename-feed' | 'retention'; feed: FeedSummary }
  | { kind: 'rename-folder'; folder: FolderSummary };
type HiddenItem = HiddenArticlePage['items'][number];
type Menu =
  | { kind: 'feed'; feed: FeedSummary }
  | { kind: 'folder'; folder: FolderSummary }
  | { kind: 'hidden'; article: HiddenItem };
const currentLocation = () => feedLibraryLocation(new URL(location.href));

function LibraryEditor({
  edit,
  save,
  close,
  returnFocusRef,
}: {
  edit: Edit;
  save: (value: string) => Promise<void>;
  close: () => void;
  returnFocusRef: RefObject<HTMLElement>;
}) {
  const retention = edit.kind === 'retention';
  const [value, setValue] = useState(
    edit.kind === 'rename-folder'
      ? edit.folder.title
      : edit.kind === 'retention'
        ? String(edit.feed.retentionDays)
        : edit.feed.title,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const title = retention
    ? 'Feed retention'
    : edit.kind === 'rename-feed'
      ? 'Rename feed'
      : 'Rename folder';
  const label = retention
    ? 'Retention in days'
    : edit.kind === 'rename-feed'
      ? 'Feed name'
      : 'Folder name';
  const valid = retention
    ? /^\d+$/.test(value) &&
      Number.isInteger(Number(value)) &&
      Number(value) >= 1 &&
      Number(value) <= 3650
    : Boolean(value.trim());
  return (
    <ModalSheet
      open
      title={title}
      initialFocusRef={input}
      returnFocusRef={returnFocusRef}
      onClose={() => {
        if (!busy) close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !valid) return;
          setBusy(true);
          setError('');
          void save(value.trim())
            .then(() => {
              if (alive.current) close();
            })
            .catch((failure: Error) => {
              if (alive.current) setError(failure.message);
            })
            .finally(() => {
              if (alive.current) setBusy(false);
            });
        }}
      >
        <Input
          label={label}
          inputRef={input}
          type={retention ? 'number' : 'text'}
          min={retention ? 1 : undefined}
          max={retention ? 3650 : undefined}
          step={retention ? 1 : undefined}
          required
          disabled={busy}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {retention && (
          <p className="mt-3 text-sm text-soft">
            Keep articles for 1–3650 days. The saved value applies to future retention cleanup.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-3">
          <Button variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !valid} data-brew-action="save-library-edit">
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}

export function FeedManager() {
  const client = useQueryClient();
  const capabilities = useCapabilities();
  const [route, setRoute] = useState(currentLocation);
  const { section } = route;
  const [url, setUrl] = useState('');
  const [candidates, setCandidates] = useState<FeedCandidate[]>([]);
  const feedInput = useRef<HTMLInputElement>(null);
  useWebMcpSurface(feedInput, { names: ['add_feed'], urls: candidates.map((feed) => feed.url) }, candidates.length > 0);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [folderTitle, setFolderTitle] = useState('');
  const [working, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const dialogReturn = useRef<HTMLElement | null>(null);
  const hiddenList = useRef<HTMLDivElement>(null);
  const hiddenHeading = useRef<HTMLHeadingElement>(null);
  const focusFrame = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelAnimationFrame(focusFrame.current);
    };
  }, []);
  useEffect(() => {
    const restore = () => {
      setMenu(null);
      setEdit(null);
      setRoute(currentLocation());
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  usePageAlternates(feedLibraryHref(route), 'Saved feed library');
  const feedQuery = useQuery({
    queryKey: ['source-feeds'],
    retry: false,
    queryFn: ({ signal }) => api<FeedSummary[]>('/api/feeds', { signal }),
  });
  const folderQuery = useQuery({
    queryKey: ['source-folders'],
    retry: false,
    queryFn: ({ signal }) => api<FolderSummary[]>('/api/folders', { signal }),
  });
  const hidden = useQuery({
    queryKey: ['hidden-articles', route.page],
    enabled: section === 'hidden',
    retry: false,
    queryFn: ({ signal }) =>
      api<HiddenArticlePage>(`/api/articles-hidden?includeTotal=true&page=${route.page}`, {
        signal,
      }),
  });
  const feeds = feedQuery.data ?? [];
  const folders = folderQuery.data ?? [];
  const calm = localStorage.getItem('brew:calm') === 'true';
  const changed = useCallback(() => {
    for (const key of [
      'reader-navigation',
      'articles',
      'article',
      'search',
      'newsletter-overview',
      'newsletter-letters',
      'newsletter-letter',
    ])
      void client.invalidateQueries({ queryKey: [key] });
    window.dispatchEvent(new Event('brew:navigation-refresh'));
  }, [client]);
  const refresh = useCallback(async () => {
    await Promise.all(
      ['source-feeds', 'source-folders'].map((key) =>
        client.refetchQueries({ queryKey: [key], type: 'active' }, { throwOnError: true }),
      ),
    );
    changed();
  }, [client, changed]);
  const owner = useOwnerActions(refresh);
  const { canRestoreUndoFocus } = owner;
  const opml = useOpmlImport(owner);
  const busy = working || owner.busy || opml.preparing;
  const hadIntent = useRef(false);
  useLayoutEffect(() => {
    if (owner.intent && owner.intent.request.kind !== 'import_opml') hadIntent.current = true;
    else if (!owner.intent && !owner.busy && hadIntent.current) {
      hadIntent.current = false;
      if (dialogReturn.current?.isConnected) dialogReturn.current.focus();
      else document.querySelector<HTMLButtonElement>('[data-brew-action="undo"]')?.focus();
    }
  }, [owner.intent, owner.busy]);
  const priorReceipt = useRef(owner.receipt);
  useLayoutEffect(() => {
    if (owner.busy) return;
    const receipt = owner.receipt;
    if (
      receipt?.status === 'undone' &&
      canRestoreUndoFocus() &&
      priorReceipt.current?.id === receipt.id &&
      priorReceipt.current.status !== 'undone'
    ) {
      const kind =
        receipt.kind === 'delete_feed'
          ? 'feed'
          : receipt.kind === 'delete_folder'
            ? 'folder'
            : null;
      if (kind)
        document
          .querySelector<HTMLButtonElement>(
            `[data-brew-kind="${kind}"][data-brew-id="${receipt.targetId}"] [data-brew-action="more"]`,
          )
          ?.focus();
    }
    priorReceipt.current = receipt;
  }, [owner.receipt, owner.busy, canRestoreUndoFocus]);
  const run = async (work: () => Promise<string>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await work();
      if (alive.current) setMessage(next);
    } catch (failure) {
      if (alive.current) setError((failure as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const upsert = <T extends { id: number }>(key: string, row: T) =>
    client.setQueryData<T[]>([key], (current = []) =>
      current.some((item) => item.id === row.id)
        ? current.map((item) => (item.id === row.id ? row : item))
        : [...current, row],
    );
  const saveEdit = async (value: string) => {
    if (!edit) return;
    if (edit.kind === 'rename-folder') {
      await client.cancelQueries({ queryKey: ['source-folders'] });
      const row = await api<FolderSummary>(`/api/folders/${edit.folder.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: value }),
      });
      upsert('source-folders', row);
      setMessage(`Renamed folder to “${row.title}”.`);
    } else {
      await client.cancelQueries({ queryKey: ['source-feeds'] });
      const row = await api<FeedSummary>(
        `/api/feeds/${edit.feed.id}${edit.kind === 'retention' ? '/retention' : ''}`,
        {
          method: 'PATCH',
          body: JSON.stringify(
            edit.kind === 'retention' ? { days: Number(value) } : { title: value },
          ),
        },
      );
      upsert('source-feeds', row);
      setMessage(
        edit.kind === 'retention'
          ? `Saved retention for “${row.title}”: ${row.retentionDays} days.`
          : `Renamed feed to “${row.title}”.`,
      );
    }
    setError('');
    changed();
  };
  const removeFeed = (feed: FeedSummary) => {
    if (!menu) dialogReturn.current = document.activeElement as HTMLElement;
    setMenu(null);
    setMessage('');
    owner.ask({ kind: 'delete_feed', id: feed.id }, feed.title);
  };
  const removeFolder = (folder: FolderSummary) => {
    if (!menu) dialogReturn.current = document.activeElement as HTMLElement;
    setMenu(null);
    setMessage('');
    owner.ask({ kind: 'delete_folder', id: folder.id }, folder.title);
  };
  const startEdit = (next: Edit) => {
    if (!menu) dialogReturn.current = document.activeElement as HTMLElement;
    setMenu(null);
    setError('');
    setEdit(next);
  };
  const retryFeed = (feed: FeedSummary) => {
    const trigger = menu ? dialogReturn.current : (document.activeElement as HTMLElement | null);
    return run(async () => {
      try {
        const result = await api<{ outcome: string; newItems: number; error?: string }>(
          `/api/feeds/${feed.id}/fetch`,
          { method: 'POST' },
        );
        try {
          await refresh();
        } catch {
          throw new Error('The fetch finished, but the library could not refresh. Retry library.');
        }
        if (result.outcome === 'error')
          throw new Error(`Fetch failed: ${result.error ?? 'Could not fetch this feed.'}`);
        return `Fetched ${feed.title}; ${result.newItems} new.`;
      } finally {
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = requestAnimationFrame(() => {
          if (alive.current && trigger?.isConnected) trigger.focus();
        });
      }
    });
  };
  const openMenu = (next: Menu, trigger: HTMLElement) => {
    dialogReturn.current = trigger;
    setMenu(next);
  };
  const unhide = (article: HiddenItem) => {
    const index = Math.max(0, hidden.data?.items.findIndex((item) => item.id === article.id) ?? 0);
    setMenu(null);
    void run(async () => {
      let removed = false;
      try {
        await api(`/api/articles/${article.id}/unhide`, { method: 'POST' });
        removed = true;
        await client.cancelQueries({ queryKey: ['hidden-articles', route.page] });
        client.setQueryData<HiddenArticlePage>(['hidden-articles', route.page], (current) =>
          current
            ? {
                ...current,
                items: current.items.filter((item) => item.id !== article.id),
                total: Math.max(
                  0,
                  current.total - (current.items.some((item) => item.id === article.id) ? 1 : 0),
                ),
              }
            : current,
        );
        changed();
        try {
          await hidden.refetch({ throwOnError: true });
        } catch {
          throw new Error(
            'The article was unhidden, but the list could not refresh. Retry hidden articles.',
          );
        }
        return `Unhid “${article.title}”.`;
      } finally {
        cancelAnimationFrame(focusFrame.current);
        focusFrame.current = requestAnimationFrame(() => {
          if (!alive.current) return;
          const rows = hiddenList.current?.querySelectorAll<HTMLElement>(
            '[data-brew-action="open-article"]',
          );
          const target = removed
            ? rows?.[Math.min(index, rows.length - 1)]
            : hiddenList.current?.querySelector<HTMLElement>(
                `[data-brew-id="${article.id}"] [data-brew-action="unhide"]`,
              );
          (target ?? hiddenHeading.current)?.focus({ preventScroll: true });
        });
      }
    });
  };
  const results = (
    <>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label="Library result"
        className={message || busy ? 'mt-3 text-sm text-soft' : 'sr-only'}
      >
        {busy ? 'Working…' : message}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
  const loadError = feedQuery.isError || folderQuery.isError;
  const loadFeedback = loadError ? (
    <div role="alert" className="mt-4 text-sm text-danger">
      <p>Could not load the feed library.</p>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await refresh();
            return 'Library reloaded.';
          })
        }
      >
        Retry library
      </Button>
    </div>
  ) : feedQuery.isPending || folderQuery.isPending ? (
    <p role="status">Loading library…</p>
  ) : null;
  const total = (count: number, noun: string) => (
    <p
      aria-live="polite"
      aria-atomic="true"
      className={calm ? 'sr-only' : 'mt-3 text-xs text-soft'}
    >{`Showing ${count ? `1–${count}` : '0'} of ${count} ${noun}`}</p>
  );
  const overlays = (
    <>
      <ModalSheet
        open={menu !== null}
        title={
          menu?.kind === 'hidden'
            ? 'Hidden article actions'
            : menu?.kind === 'folder'
              ? 'Folder actions'
              : 'Feed actions'
        }
        onClose={() => setMenu(null)}
        returnFocusRef={dialogReturn}
      >
        {menu && (
          <>
            <p className="mb-4 break-words">
              {menu.kind === 'hidden'
                ? menu.article.title
                : menu.kind === 'feed'
                  ? menu.feed.title
                  : menu.folder.title}
            </p>
            <div className="flex flex-wrap gap-3">
              {menu.kind === 'hidden' ? (
                <>
                  <a
                    className="brew-button brew-button--secondary brew-button--md"
                    data-brew-action="open-article"
                    href={`/a/${menu.article.id}`}
                  >
                    Open {menu.article.kind === 'letter' ? 'letter' : 'article'}
                  </a>
                  {(['md', 'json'] as const).map((format) =>
                    capabilities.data?.outputs?.twins ? (
                      <a
                        key={format}
                        className="brew-button brew-button--secondary brew-button--md"
                        data-brew-action="export"
                        href={`/a/${menu.article.id}.${format}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {format === 'md' ? 'Markdown' : 'JSON'}
                      </a>
                    ) : (
                      <Button key={format} variant="secondary" disabled>
                        {format === 'md' ? 'Markdown' : 'JSON'}{' '}
                        <Badge tone="warning">Twins need setup</Badge>
                      </Button>
                    ),
                  )}
                  {!capabilities.data?.outputs?.twins && (
                    <a href="/settings/runs#setup-outputs">Set up article outputs</a>
                  )}
                  <Button
                    variant="secondary"
                    disabled={busy}
                    data-brew-action="unhide"
                    onClick={() => unhide(menu.article)}
                  >
                    Unhide
                  </Button>
                </>
              ) : (
                <>
                  <a
                    className="brew-button brew-button--secondary brew-button--md"
                    href={menu.kind === 'feed' ? `/feed/${menu.feed.id}` : `/f/${menu.folder.id}`}
                  >
                    Open articles
                  </a>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      startEdit(
                        menu.kind === 'feed'
                          ? { kind: 'rename-feed', feed: menu.feed }
                          : { kind: 'rename-folder', folder: menu.folder },
                      )
                    }
                  >
                    Rename
                  </Button>
                  {menu.kind === 'feed' && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => startEdit({ kind: 'retention', feed: menu.feed })}
                      >
                        Retention
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        data-brew-action="fetch-feed"
                        onClick={() => {
                          setMenu(null);
                          void retryFeed(menu.feed);
                        }}
                      >
                        Fetch now
                      </Button>
                    </>
                  )}
                  <Button
                    variant="secondary"
                    disabled={!owner.capable || busy}
                    data-brew-action={menu.kind === 'feed' ? 'delete-feed' : 'delete-folder'}
                    onClick={() =>
                      menu.kind === 'feed' ? removeFeed(menu.feed) : removeFolder(menu.folder)
                    }
                  >
                    Delete
                  </Button>
                  {!owner.capable && (
                    <>
                      <Badge tone="warning">Undo needs setup</Badge>
                      <a href="/settings/runs">Set up actions</a>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </ModalSheet>
      {edit && (
        <LibraryEditor
          edit={edit}
          save={saveEdit}
          close={() => setEdit(null)}
          returnFocusRef={dialogReturn}
        />
      )}
      <OwnerActionUi
        action={owner}
        handlesUndoFocus={owner.receipt?.kind === 'delete_feed' || owner.receipt?.kind === 'delete_folder'}
        returnFocusRef={owner.intent?.request.kind === 'import_opml' ? undefined : dialogReturn}
      >
        {opml.preview && <OpmlImportReview name={opml.preview.name} data={opml.preview.data} />}
      </OwnerActionUi>
    </>
  );
  if (section === 'hidden')
    return (
      <section className="mx-auto max-w-4xl px-8 py-12" aria-label="Hidden articles">
        <div className="flex items-end justify-between">
          <h1
            ref={hiddenHeading}
            tabIndex={-1}
            className="rounded-sm text-3xl font-semibold focus-visible:outline"
          >
            Hidden articles
          </h1>
          <a href="/feeds" className="rounded-lg border px-4 py-2 text-sm">
            Manage feeds
          </a>
        </div>
        {results}
        {hidden.isError ? (
          <div role="alert">
            <p>Could not load hidden articles.</p>
            <Button
              variant="secondary"
              onClick={() =>
                void run(async () => {
                  await hidden.refetch({ throwOnError: true });
                  return 'Hidden articles reloaded.';
                })
              }
            >
              Retry hidden articles
            </Button>
          </div>
        ) : hidden.isPending ? (
          <p role="status">Loading hidden articles…</p>
        ) : (
          <>
            <p
              aria-live="polite"
              aria-atomic="true"
              className={calm ? 'sr-only' : 'mt-3 text-xs text-soft'}
            >{`Showing ${hidden.data.items.length ? `${(route.page - 1) * hidden.data.pageSize + 1}–${(route.page - 1) * hidden.data.pageSize + hidden.data.items.length}` : '0'} of ${hidden.data.total} hidden articles`}</p>
            <div ref={hiddenList} className="mt-8 divide-y rounded-2xl border bg-surface">
              {hidden.data.items.length ? (
                hidden.data.items.map((article) => (
                  <article
                    key={article.id}
                    aria-label={article.title}
                    {...articleDom(article, article.kind)}
                    data-brew-hidden="true"
                    className="flex flex-wrap items-center justify-between gap-3 p-4"
                  >
                    <div className="min-w-0 max-w-full">
                      <h2 className="font-medium">
                        <a
                          href={`/a/${article.id}`}
                          data-brew-action="open-article"
                          className="inline-flex min-h-6 items-center rounded-sm break-words focus-visible:outline"
                        >
                          {article.title}
                        </a>
                      </h2>
                      <p className="text-xs text-soft">{article.feedTitle}</p>
                    </div>
                    <span className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        disabled={busy}
                        data-brew-action="unhide"
                        onClick={() => unhide(article)}
                      >
                        Unhide
                      </Button>
                      <IconButton
                        icon="more"
                        label={`More actions for hidden ${article.kind} ${article.title}`}
                        data-brew-action="more"
                        className="min-h-7 min-w-7"
                        aria-haspopup="dialog"
                        disabled={busy}
                        onClick={(event) =>
                          openMenu({ kind: 'hidden', article }, event.currentTarget)
                        }
                      />
                    </span>
                  </article>
                ))
              ) : (
                <p className="p-10 text-center text-sm text-soft">
                  {hidden.data.total ? (
                    <>
                      No articles on this page.{' '}
                      <a href={agentPageHref(feedLibraryHref({ ...route, page: 1 }))}>First page</a>
                    </>
                  ) : (
                    'No hidden articles.'
                  )}
                </p>
              )}
            </div>
            <nav
              aria-label="Hidden article pages"
              className="mt-5 flex flex-wrap items-center gap-3"
            >
              {route.page > 1 ? (
                <a
                  className="brew-button brew-button--secondary brew-button--sm"
                  aria-label="Previous hidden articles"
                  href={agentPageHref(feedLibraryHref({ ...route, page: route.page - 1 }))}
                >
                  <Icon name="chevron-left" size={14} />
                  Previous
                </a>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label="Previous hidden articles"
                  disabled
                >
                  <Icon name="chevron-left" size={14} />
                  Previous
                </Button>
              )}
              <span className={calm ? 'sr-only' : 'text-xs text-soft'}>
                Page {route.page} of{' '}
                {Math.max(1, Math.ceil(hidden.data.total / hidden.data.pageSize))}
              </span>
              {route.page * hidden.data.pageSize < hidden.data.total ? (
                <a
                  className="brew-button brew-button--secondary brew-button--sm"
                  aria-label="Next hidden articles"
                  href={agentPageHref(feedLibraryHref({ ...route, page: route.page + 1 }))}
                >
                  Next
                  <Icon name="chevron-right" size={14} />
                </a>
              ) : (
                <Button size="sm" variant="secondary" aria-label="Next hidden articles" disabled>
                  Next
                  <Icon name="chevron-right" size={14} />
                </Button>
              )}
            </nav>
          </>
        )}
        {overlays}
      </section>
    );
  if (section === 'health')
    return (
      <section className="mx-auto max-w-5xl px-8 py-12" aria-label="Feed health">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-soft">Settings</p>
            <h1 className="mt-2 text-3xl font-semibold">Feed health</h1>
            <p className="mt-2 text-sm text-soft">
              Fetch status and failure history stay on this machine.
            </p>
          </div>
          <a href="/feeds" className="rounded-lg border px-4 py-2 text-sm">
            Manage feeds
          </a>
        </div>
        {results}
        <OpmlImportFeedback flow={opml} />
        {loadFeedback}
        {feedQuery.data && !feedQuery.isError && total(feeds.length, 'feeds')}
        <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="hidden grid-cols-[minmax(0,1fr)_8rem_7rem_7rem_auto] gap-4 border-b border-line px-5 py-3 text-xs font-semibold uppercase tracking-wider text-soft md:grid">
            <span>Feed</span>
            <span>Last attempt</span>
            <span>Status</span>
            <span>Failures</span>
            <span />
          </div>
          {feedQuery.data && !feedQuery.isError && !feeds.length ? (
            <p className="p-8 text-center text-sm text-soft">No feeds to monitor.</p>
          ) : (
            feeds.map((feed) => (
              <article
                key={feed.id}
                aria-label={feed.title}
                data-brew-id={feed.id}
                data-brew-kind="feed"
                className="grid items-center gap-3 border-b border-line px-5 py-4 last:border-0 md:grid-cols-[minmax(0,1fr)_8rem_7rem_7rem_auto]"
              >
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium">
                    <a
                      href={`/feed/${feed.id}`}
                      className="inline-flex min-h-6 items-center rounded-sm focus-visible:outline"
                    >
                      {feed.title}
                    </a>
                  </h2>
                  {feed.healthWarning && (
                    <span className="mt-1 inline-flex rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">
                      Failing over 7 days
                    </span>
                  )}
                </div>
                <span className="text-xs text-soft">
                  <span className="sr-only">Last attempt: </span>
                  {feed.lastFetchedAt
                    ? new Intl.DateTimeFormat(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      }).format(new Date(feed.lastFetchedAt))
                    : 'Never'}
                </span>
                <span
                  className={`w-fit rounded-full px-2 py-1 text-xs font-semibold ${feed.lastStatus && feed.lastStatus >= 200 && feed.lastStatus < 400 ? 'bg-positive-soft text-positive' : feed.lastStatus ? 'bg-danger-soft text-danger' : 'bg-subtle text-soft'}`}
                >
                  <span className="sr-only">Fetch status: </span>
                  <span>{feed.lastStatus ?? 'Not fetched'}</span>
                </span>
                <span className="text-xs text-soft">
                  <span className="sr-only">Consecutive failures: </span>
                  {feed.consecutiveFailures || 'None'}
                </span>
                <span className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    data-brew-action="fetch-feed"
                    onClick={() => void retryFeed(feed)}
                  >
                    Fetch now
                  </Button>
                  <IconButton
                    icon="more"
                    label={`More actions for feed ${feed.title}`}
                    data-brew-action="more"
                    className="min-h-7 min-w-7"
                    aria-haspopup="dialog"
                    disabled={busy}
                    onClick={(event) => openMenu({ kind: 'feed', feed }, event.currentTarget)}
                  />
                </span>
              </article>
            ))
          )}
        </div>
        {overlays}
      </section>
    );
  return (
    <div className="mx-auto grid max-w-5xl gap-12 px-8 py-12 md:grid-cols-[minmax(0,1fr)_18rem]">
      <section aria-label="Feed library">
        <p className="text-xs font-semibold uppercase tracking-wider text-soft">Library</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold">Feeds</h1>
          <div className="flex flex-wrap items-center gap-2">
            <a href="/feeds?section=health" className="rounded-lg border px-3 py-2 text-xs">
              Feed health
            </a>
            <a href="/feeds?section=hidden" className="rounded-lg border px-3 py-2 text-xs">
              Hidden articles
            </a>
            <OpmlImportPicker flow={opml} disabled={busy} />
            <a href="/api/opml/export" download className="rounded-lg border px-3 py-2 text-xs">
              Export OPML
            </a>
          </div>
        </div>
        <p className="mt-2 text-sm text-soft">
          Paste a feed or website address. Brew will find RSS, Atom, and JSON feeds.
        </p>
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void run(async () => {
              const result = await api<{ candidates: FeedCandidate[] }>('/api/feeds/discover', {
                method: 'POST',
                body: JSON.stringify({ url }),
              });
              setCandidates(result.candidates);
              return result.candidates.length
                ? `Found ${result.candidates.length} feeds.`
                : 'No feeds were found at that address.';
            });
          }}
          className="mt-8 flex gap-2"
        >
          <label className="sr-only" htmlFor="feed-url">
            Feed or website URL
          </label>
          <input
            ref={feedInput}
            id="feed-url"
            type="url"
            required
            disabled={busy}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
            className="min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-4 py-3"
          />
          <Button type="submit" disabled={busy}>
            Find feed
          </Button>
        </form>
        {results}
        <OpmlImportFeedback flow={opml} />
        {loadFeedback}
        {candidates.length > 0 && (
          <div className="mt-5 rounded-2xl border bg-surface p-3">
            <p className="px-2 pb-2 text-xs font-semibold">Choose a feed</p>
            {candidates.map((candidate) => (
              <button
                key={candidate.url}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await client.cancelQueries({ queryKey: ['source-feeds'] });
                    const row = await api<FeedSummary>('/api/feeds', {
                      method: 'POST',
                      body: JSON.stringify({ url: candidate.url, folderId }),
                    });
                    upsert('source-feeds', row);
                    setCandidates([]);
                    setUrl('');
                    changed();
                    return `Added ${candidate.title}`;
                  })
                }
                className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left hover:bg-canvas"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{candidate.title}</span>
                  <span className="block truncate text-xs text-soft">{candidate.url}</span>
                </span>
                <span className="text-xs">{candidate.type}</span>
              </button>
            ))}
            <label className="mt-3 block text-xs text-soft">
              Save in{' '}
              <select
                value={folderId ?? ''}
                onChange={(event) =>
                  setFolderId(event.target.value ? Number(event.target.value) : null)
                }
                className="min-h-6 rounded border px-2 py-1"
              >
                <option value="">Unfiled</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {feedQuery.data && !feedQuery.isError && total(feeds.length, 'feeds')}
        <div className="mt-6 space-y-2">
          {feedQuery.data && !feedQuery.isError && !feeds.length ? (
            <p className="rounded-2xl border border-dashed p-10 text-center text-sm text-soft">
              No feeds yet.
            </p>
          ) : (
            feeds.map((feed) => (
              <article
                key={feed.id}
                aria-label={feed.title}
                data-brew-id={feed.id}
                data-brew-kind="feed"
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-surface px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="font-medium break-words">
                    <a href={`/feed/${feed.id}`} className="inline-flex min-h-6 items-center">
                      {feed.title}
                    </a>
                  </h2>
                  <p className="truncate text-xs text-soft">{feed.url}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Edit retention for ${feed.title}`}
                    onClick={() => startEdit({ kind: 'retention', feed })}
                  >
                    Keep {feed.retentionDays} days
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => startEdit({ kind: 'rename-feed', feed })}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !owner.capable || owner.busy}
                    data-brew-action="delete-feed"
                    onClick={() => removeFeed(feed)}
                  >
                    Delete
                  </Button>
                  <IconButton
                    className="min-h-7 min-w-7"
                    icon="more"
                    label={`More actions for feed ${feed.title}`}
                    aria-haspopup="dialog"
                    disabled={busy}
                    data-brew-action="more"
                    onClick={(event) => openMenu({ kind: 'feed', feed }, event.currentTarget)}
                  />
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      <aside aria-label="Folders">
        <h2 className="text-sm font-semibold">Folders</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (folderTitle.trim())
              void run(async () => {
                await client.cancelQueries({ queryKey: ['source-folders'] });
                const row = await api<FolderSummary>('/api/folders', {
                  method: 'POST',
                  body: JSON.stringify({ title: folderTitle.trim() }),
                });
                upsert('source-folders', row);
                setFolderTitle('');
                changed();
                return `Created folder “${row.title}”.`;
              });
          }}
          className="mt-3 flex gap-2"
        >
          <label className="sr-only" htmlFor="folder-title">
            New folder name
          </label>
          <input
            id="folder-title"
            value={folderTitle}
            disabled={busy}
            onChange={(event) => setFolderTitle(event.target.value)}
            placeholder="New folder"
            className="min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 text-sm"
          />
          <Button
            type="submit"
            disabled={busy || !folderTitle.trim()}
            aria-label="Create folder"
            icon={<span aria-hidden>+</span>}
          />
        </form>
        {folderQuery.data && !folderQuery.isError && total(folders.length, 'folders')}
        <div className="mt-4 space-y-1">
          {folders.map((folder) => (
            <div
              key={folder.id}
              data-brew-kind="folder"
              data-brew-id={folder.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-subtle"
            >
              <a href={`/f/${folder.id}`} className="min-h-6 min-w-0 flex-1 text-sm break-words">
                {folder.title}
              </a>
              <span className="flex">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => startEdit({ kind: 'rename-folder', folder })}
                  aria-label={`Rename ${folder.title}`}
                  className="brew-icon-button min-h-7 min-w-7"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy || !owner.capable || owner.busy}
                  data-brew-action="delete-folder"
                  onClick={() => removeFolder(folder)}
                  aria-label={`Delete ${folder.title}`}
                  className="brew-icon-button min-h-7 min-w-7"
                >
                  ×
                </button>
                <IconButton
                  className="min-h-7 min-w-7"
                  icon="more"
                  label={`More actions for folder ${folder.title}`}
                  aria-haspopup="dialog"
                  disabled={busy}
                  data-brew-action="more"
                  onClick={(event) => openMenu({ kind: 'folder', folder }, event.currentTarget)}
                />
              </span>
            </div>
          ))}
        </div>
      </aside>
      {overlays}
    </div>
  );
}
