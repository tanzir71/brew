import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readerPageHref, readerPageSize, type ReaderPageState } from '@brew/core/reader-pages';
import { navigateReader, readerState } from './readerLocation';
import { ReaderPageFooter } from './components/ReaderPageFooter';
import { SavedSearchList, SaveSearchDialog } from './components/SavedSearches';
import { useSavedSearches } from './hooks/useSavedSearches';
import { useTextAlternates } from './hooks/useTextAlternates';
import { usePageAlternates } from './hooks/usePageAlternates';
import { readerWelcomeCopy } from '@brew/core/app-pages';
import { ModeChip } from './components/ModeChip';
import { articleRouteId } from './articleRoute';
import { articleDom } from './articleDom';
import { ArticleReader } from './ArticleReader';
import { useArticleFocusReturn } from './hooks/useArticleFocusReturn';
import { useCapabilities } from './hooks/useCapabilities';
import { useBrowserPreferences } from './hooks/useBrowserPreferences';
import { PreferenceFeedback } from './settings/BrowserPreferences';
import { updateArticleState } from './articleState';
import { useBulkRead } from './hooks/useBulkRead';
import { BulkReadUi } from './components/BulkReadUi';
import { ReaderEmptyPage, ReaderReadFeedback } from './components/ReaderReadFeedback';
import type {
  ArticlePage,
  ArticleSummary,
  ReaderNavigation,
  SearchPage,
} from '@brew/core/types/api';

type Selection = {
  kind: 'brew' | 'all' | 'today' | 'starred' | 'feed' | 'folder';
  id?: number;
  title: string;
};
const emptyNavigation: ReaderNavigation = {
  counts: { all: 0, today: 0, starred: 0 },
  folders: [],
  unfiled: [],
};

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Could not load your library');
  return response.json() as Promise<T>;
}
const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.matches('input, textarea, select') || target.isContentEditable || Boolean(target.closest('dialog[open]')));
const imageSource = (value: string, direct: boolean) => direct && value.startsWith('/api/img?src=') ? decodeURIComponent(value.slice(13)) : direct ? value : value.startsWith('/api/img?') ? value : `/api/img?src=${encodeURIComponent(value)}`;

function selectionHref(value: Selection): string {
  if (value.kind === 'brew') return '/?view=reader&scope=brew';
  const density = localStorage.getItem(`brew:density:${value.kind}:${value.id ?? 'root'}`);
  return readerPageHref({ ...readerState(), kind: value.kind, id: value.id, q: '', scope: 'all', page: 1, unread: false, sort: 'newest', density: density === 'title' || density === 'cards' ? density : 'magazine' });
}
function selectionFromUrl(): Selection {
    if (articleRouteId(location.pathname) !== null) return { kind: 'all', title: 'All articles' };
    if (location.pathname === '/reader') return { kind: 'brew', title: 'The Brew' };
    const params = new URLSearchParams(location.search);
    if (location.pathname === '/' && (!params.get('scope') || params.get('scope') === 'brew') && !params.has('feed') && !params.has('folder') && !params.get('q')?.trim()) return { kind: 'brew', title: 'The Brew' };
    const state = readerState();
    const kind = state.kind === 'search' ? (state.folderId ? 'folder' : state.contextFeedId ? 'feed' : 'all') : state.kind;
    return { kind, id: state.kind === 'search' ? state.folderId ?? state.contextFeedId : state.id, title: kind === 'today' ? 'Today' : kind === 'starred' ? 'Starred' : kind === 'feed' ? 'Feed' : kind === 'folder' ? 'Folder' : 'All articles' };

}

export function Reader({
  searchQuery,
  onClearSearch,
}: {
  searchQuery: string;
  onClearSearch: () => void;
}) {
  const queryClient = useQueryClient();
  const navigationQuery = useQuery({ queryKey: ['reader-navigation'], staleTime: 0, queryFn: ({ signal }) => getJson<ReaderNavigation>('/api/reader/navigation', signal) });
  const navigation = navigationQuery.data ?? emptyNavigation;
  const navigationRef = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<Selection>(selectionFromUrl);
  const pendingGo = useRef(false);
  const pendingGoTimer = useRef<number | null>(null);
  const savedSearches = useSavedSearches();
  const [saveSearchOpen, setSaveSearchOpen] = useState(false);
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['reader-navigation'] }, { cancelRefetch: false });
    };
    const events = new EventSource('/api/events');
    events.addEventListener('article:new', () => {
      void queryClient.invalidateQueries({ queryKey: ['reader-navigation'] });
      void queryClient.invalidateQueries({ queryKey: ['articles'] });
      void queryClient.invalidateQueries({ queryKey: ['search'] });
    });
    events.addEventListener('notification', (event) => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        const article = JSON.parse((event as MessageEvent<string>).data) as {
          title: string;
          url: string;
        };
        const notification = new Notification(article.title, { body: 'Matched a Brew rule' });
        notification.onclick = () => window.open(article.url, '_blank', 'noopener,noreferrer');
      } catch {
        // Ignore malformed events without interrupting the live reader connection.
      }
    });
    window.addEventListener('brew:navigation-refresh', refresh);
    return () => {
      events.close();
      window.removeEventListener('brew:navigation-refresh', refresh);
    };
  }, [queryClient]);
  const choose = useCallback((next: Selection) => {
    navigateReader(selectionHref(next));
    setSelection(next);
  }, []);
  useEffect(() => {
    const show = () => {
      pendingGo.current = false;
      if (pendingGoTimer.current !== null) window.clearTimeout(pendingGoTimer.current);
      pendingGoTimer.current = null;
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) return;
      if (event.key === '?') {
        event.preventDefault();
        window.dispatchEvent(new Event('brew:show-shortcuts'));
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('#global-search')?.focus();
        return;
      }
      if (event.key.toLowerCase() === 'g') {
        event.stopImmediatePropagation();
        pendingGo.current = true;
        if (pendingGoTimer.current !== null) window.clearTimeout(pendingGoTimer.current);
        pendingGoTimer.current = window.setTimeout(() => {
          pendingGo.current = false;
          pendingGoTimer.current = null;
        }, 1_000);
        return;
      }
      if (pendingGo.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pendingGo.current = false;
        if (pendingGoTimer.current !== null) window.clearTimeout(pendingGoTimer.current);
        pendingGoTimer.current = null;
        const key = event.key.toLowerCase();
        if (key === 'b') choose({ kind: 'brew', title: 'The Brew' });
        if (key === 't') choose({ kind: 'today', title: 'Today' });
        if (key === 'a') choose({ kind: 'all', title: 'All articles' });
        return;
      }
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        void queryClient.invalidateQueries({ queryKey: ['articles'] });
        void queryClient.invalidateQueries({ queryKey: ['search'] });
        void queryClient.invalidateQueries({ queryKey: ['reader-navigation'] });
        window.dispatchEvent(new Event('brew:navigation-refresh'));
      }
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('brew:show-shortcuts', show);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('brew:show-shortcuts', show);
      if (pendingGoTimer.current !== null) window.clearTimeout(pendingGoTimer.current);
    };
  }, [choose, queryClient]);
  useEffect(() => {
    const restore = () => setSelection(selectionFromUrl());
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  const itemClass = (active: boolean) =>
    `flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${active ? 'bg-subtle font-semibold text-ink' : 'text-soft hover:bg-subtle hover:text-ink'}`;
  return (
    <>
      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-[15.5rem_minmax(0,1fr)]">
        <aside
          aria-label="Reader navigation"
          className="flex flex-col border-r border-line bg-canvas px-4 py-6"
        >
          <nav ref={navigationRef} tabIndex={-1} aria-label="Library" className="space-y-1">
            <a
              className={itemClass(selection.kind === 'brew')}
              href={selectionHref({ kind: 'brew', title: 'The Brew' })}
              onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); choose({ kind: 'brew', title: 'The Brew' }); }}
            >
              <span>☕ The Brew</span>
            </a>
            <a
              className={itemClass(selection.kind === 'today')}
              href={selectionHref({ kind: 'today', title: 'Today' })}
              onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); choose({ kind: 'today', title: 'Today' }); }}
            >
              <span>Today</span>
              <Count value={navigation.counts.today} />
            </a>
            <a
              className={itemClass(selection.kind === 'all')}
              href={selectionHref({ kind: 'all', title: 'All articles' })}
              onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); choose({ kind: 'all', title: 'All articles' }); }}
            >
              <span>All</span>
              <Count value={navigation.counts.all} />
            </a>
            <a
              className={itemClass(selection.kind === 'starred')}
              href={selectionHref({ kind: 'starred', title: 'Starred' })}
              onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); choose({ kind: 'starred', title: 'Starred' }); }}
            >
              <span>Starred</span>
              <Count value={navigation.counts.starred} />
            </a>
          </nav>
          <ReaderReadFeedback query={navigationQuery} subject="library information" retryLabel="Retry library" focusRef={navigationRef} compact announcement="Library information loaded." />
          <div className="my-5 h-px bg-line" />
          <SavedSearchList action={savedSearches} />
          <div className="space-y-4">
            {navigation.folders.map((folder) => (
              <section key={folder.id}>
                <a
                  href={selectionHref({ kind: 'folder', id: folder.id, title: folder.title })}
              onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); choose({ kind: 'folder', id: folder.id, title: folder.title }); }}
                  className="flex w-full items-center justify-between px-3 py-1 text-xs font-semibold uppercase tracking-wider text-soft"
                >
                  <span>{folder.title}</span>
                  <Count value={folder.unreadCount} />
                </a>
                <div className="mt-1 space-y-0.5">
                  {folder.feeds.map((feed) => (
                    <a
                      key={feed.id}
                      className={itemClass(selection.kind === 'feed' && selection.id === feed.id)}
                      href={selectionHref({ kind: 'feed', id: feed.id, title: feed.title })}
              onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); choose({ kind: 'feed', id: feed.id, title: feed.title }); }}
                    >
                      <span className="flex min-w-0 items-center gap-2"><FeedIcon id={feed.id} title={feed.title}/><span className="truncate">{feed.title}</span></span>
                      <Count value={feed.unreadCount} />
                    </a>
                  ))}
                </div>
              </section>
            ))}
            {navigation.unfiled.length > 0 && (
              <section>
                <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted">
                  Unfiled
                </p>
                {navigation.unfiled.map((feed) => (
                  <a
                    key={feed.id}
                    className={itemClass(selection.kind === 'feed' && selection.id === feed.id)}
                    href={selectionHref({ kind: 'feed', id: feed.id, title: feed.title })}
              onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); choose({ kind: 'feed', id: feed.id, title: feed.title }); }}
                  >
                    <span className="flex min-w-0 items-center gap-2"><FeedIcon id={feed.id} title={feed.title}/><span className="truncate">{feed.title}</span></span>
                    <Count value={feed.unreadCount} />
                  </a>
                ))}
              </section>
            )}
          </div>
          <div className="reader-mode-footer"><ModeChip /></div>
        </aside>
        <section className="min-w-0 bg-surface">
          {searchQuery || location.pathname === '/search' ? (
            <SearchView
              key={location.pathname + location.search}
              query={searchQuery}
              currentFolderId={
                selection.kind === 'folder'
                  ? selection.id
                  : selection.kind === 'feed'
                    ? navigation.folders.find((folder) =>
                        folder.feeds.some((feed) => feed.id === selection.id),
                      )?.id
                    : undefined
              }
              onClear={onClearSearch}
              onSave={() => { savedSearches.clearError(); setSaveSearchOpen(true); }}
            />
          ) : selection.kind === 'brew' ? (
            <>
              <header className="border-b border-line px-10 py-7">
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-soft">
                  Reader
                </p>
                <h1 tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight">{selection.title}</h1>
              </header>
              <BrewWelcome />
            </>
          ) : (
            <ArticleList
              key={`${selection.kind}:${selection.id ?? 'root'}:${location.search}`}
              selection={{ ...selection, title: selection.kind === 'folder' ? navigation.folders.find((folder) => folder.id === selection.id)?.title ?? selection.title : selection.kind === 'feed' ? [...navigation.folders.flatMap((folder) => folder.feeds), ...navigation.unfiled].find((feed) => feed.id === selection.id)?.title ?? selection.title : selection.title }}
            />
          )}
        </section>
      </div>
      {saveSearchOpen && <SaveSearchDialog action={savedSearches} query={searchQuery} onClose={() => setSaveSearchOpen(false)} />}
    </>
  );
}

function Count({ value }: { value: number }) {
  return value > 0 ? (
    <span className="ml-2 text-xs tabular-nums text-muted">{value}</span>
  ) : null;
}
function FeedIcon({id,title}:{id:number;title:string}){const [failed,setFailed]=useState(false);return <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-md bg-art-1 text-[10px] font-bold text-ink">{failed?title.trim().charAt(0).toUpperCase():<img src={`/api/feeds/${id}/icon`} alt="" className="h-full w-full object-cover" onError={()=>setFailed(true)}/>}</span>}
function BrewWelcome() {
  usePageAlternates('/reader', 'Reader welcome');
  return (
    <div className="mx-auto max-w-2xl px-10 py-20 text-center">
      <p className="text-xs font-semibold uppercase tracking-[.24em] text-soft">
        Your morning paper
      </p>
      <h2 className="mt-3 text-4xl font-semibold tracking-tight">{readerWelcomeCopy.heading}</h2>
      <p className="mx-auto mt-4 max-w-md text-soft">
        {readerWelcomeCopy.description}
      </p>
    </div>
  );
}

type Density = 'title' | 'magazine' | 'cards';
type VirtualRow = { kind: 'article'; article: ArticleSummary } | { kind: 'header'; title: string };

function SearchView({
  query,
  currentFolderId,
  onClear,
  onSave,
}: {
  query: string;
  currentFolderId?: number;
  onClear: () => void;
  onSave:()=>void;
}) {
  const preferences = useBrowserPreferences();
  const state = { ...readerState(), kind: 'search' as const, q: query };
  const scope = state.scope;
  const folderId = state.folderId ?? currentFolderId;
  const setScope = (scope: ReaderPageState['scope']) => navigateReader(readerPageHref({ ...state, scope, folderId, page: 1 }));
  const caps = useCapabilities();
  useTextAlternates(caps.data?.outputs?.twins ? readerPageHref(state) : null);
  const [selectedArticle, setSelectedArticle] = useState<number | null>(() => articleRouteId(location.pathname));
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const results = useInfiniteQuery({
    queryKey: ['search', query, scope, folderId, state.page, state.unread, state.sort],
    initialPageParam: (state.page - 1) * readerPageSize,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        q: query,
        scope,
        limit: '50',
        offset: String(pageParam), includeTotal: 'true', unread: String(state.unread), sort: state.sort,
      });
      if (scope === 'folder' && folderId !== undefined)
        params.set('folderId', String(folderId));
      return getJson<SearchPage>(`/api/search?${params}`, signal);
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    enabled: scope !== 'folder' || folderId !== undefined,
  });
  const items = useMemo(
    () => results.data?.pages.flatMap((page) => page.items) ?? [],
    [results.data],
  );
  const parent = useRef<HTMLDivElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const { prepareArticle, articleReturnTarget } = useArticleFocusReturn(parent, items, listHeading);
  const openArticle = useCallback((id: number) => {
    prepareArticle(id);
    setSelectedArticle(id);
  }, [prepareArticle]);
  // eslint-disable-next-line react-hooks/incompatible-library -- Search results use the same mandated virtual list engine as the Reader.
  const virtualizer = useVirtualizer({
    count: items.length + (results.hasNextPage && !results.isError ? 1 : 0),
    getScrollElement: () => parent.current,
    estimateSize: () => state.density === 'title' ? 62 : state.density === 'cards' ? 270 : 126,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualItems.at(-1);
    if (
      last &&
      last.index >= items.length - 4 &&
      results.hasNextPage &&
      !results.isError &&
      !results.isFetchingNextPage
    )
      void results.fetchNextPage();
  }, [items.length, results, virtualItems]);
  useLayoutEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || !items.length) return;
      if (['Enter', ' '].includes(event.key) && (event.target as HTMLElement | null)?.closest('button,a[href]')) return;
      const key = event.key.toLowerCase();
      if (key === 'j' || key === 'k') {
        event.preventDefault();
        const next =
          key === 'j'
            ? Math.min(items.length - 1, focusedIndex + 1)
            : Math.max(0, focusedIndex < 0 ? 0 : focusedIndex - 1);
        setFocusedIndex(next);
        virtualizer.scrollToIndex(next, { align: 'auto' });
      }
      if (key === 'o' || event.key === 'Enter') {
        event.preventDefault();
        openArticle(items[Math.max(0, focusedIndex)]!.id);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [focusedIndex, items, openArticle, virtualizer]);
  return (
    <div className="reader-workspace flex h-[calc(100vh-4rem)] min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-8 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-soft">Search</p>
          <h1 ref={listHeading} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight">“{query}”</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onSave} className="rounded-lg border border-line-strong px-3 py-2 text-xs">Save search</button>
          <div className="flex rounded-lg bg-subtle p-1" aria-label="Search scope">
            <button
              onClick={() => setScope('all')}
              aria-pressed={scope === 'all'}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${scope === 'all' ? 'bg-surface shadow-raised' : 'text-soft'}`}
            >
              All
            </button>
            <button
              disabled={folderId === undefined}
              onClick={() => setScope('folder')}
              aria-pressed={scope === 'folder'}
              className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${scope === 'folder' ? 'bg-surface shadow-raised' : 'text-soft'}`}
            >
              Current folder
            </button>
            <button
              onClick={() => setScope('starred')}
              aria-pressed={scope === 'starred'}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${scope === 'starred' ? 'bg-surface shadow-raised' : 'text-soft'}`}
            >
              Starred
            </button>
          </div>
          <button
            onClick={onClear}
            className="rounded-lg border border-line-strong px-3 py-2 text-xs font-semibold"
          >
            Close search
          </button>
        </div>
      </header>
      <div aria-label="Search summary" aria-live="polite" aria-atomic="true" className="border-b border-line px-8 py-2 text-xs text-soft">
        {results.data ? <>{items.length} result{items.length === 1 ? '' : 's'}{` · ${results.data.pages.at(-1)!.durationMs.toFixed(1)} ms`}{results.isError ? ' · Last loaded' : ''}</> : results.isPending ? 'Searching…' : 'Results unavailable'}
      </div>
      <ReaderReadFeedback query={results} subject="search results" retryLabel="Retry search" moreLabel="Retry more results" focusRef={listHeading} />
      <div
        ref={parent}
        data-testid="virtual-search-results"
        className="min-h-0 flex-1 overflow-auto"
      >
        <div className="relative mx-auto max-w-4xl" style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((virtual) => {
            const article = items[virtual.index];
            return (
              <div
                key={virtual.key}
                ref={virtualizer.measureElement}
                data-index={virtual.index}
                className="absolute left-8 right-8 top-0"
                style={{ transform: `translateY(${virtual.start}px)` }}
              >
                {article ? (
                  <ArticleRow
                    article={article}
                    directImages={preferences.values.images === 'direct'}
                    density={state.density}
                    focused={items[focusedIndex]?.id === article.id}
                    onOpen={() => {
                      setFocusedIndex(virtual.index);
                      openArticle(article.id);
                    }}
                  />
                ) : (
                  <p className="py-6 text-center text-xs text-muted">Searching more…</p>
                )}
              </div>
            );
          })}
        </div>
        {results.isSuccess && !items.length && <ReaderEmptyPage state={state}>No matching articles. Try fewer or broader words.</ReaderEmptyPage>}
      </div>
      {results.data?.pages[0]?.total !== undefined && <ReaderPageFooter state={state} total={results.data.pages[0].total} shown={items.length} stale={results.isError} twins={Boolean(caps.data?.outputs?.twins)} />}
      </div>
      {selectedArticle !== null && (
        <ArticleReader
          id={selectedArticle}
          mode={preferences.values.openMode}
          onClose={() => setSelectedArticle(null)}
          returnFocus={articleReturnTarget}
        />
      )}
    </div>
  );
}

function ArticleList({ selection }: { selection: Selection }) {
  const client = useQueryClient();
  const state: ReaderPageState = { ...readerState(), kind: selection.kind === 'brew' ? 'all' : selection.kind, id: selection.id };
  const unreadOnly = state.unread;
  const sort = state.sort;
  const updateFilters = (patch: Partial<ReaderPageState>) => navigateReader(readerPageHref({ ...state, density, ...patch, page: 1 }));
  const setUnreadOnly = (unread: boolean) => updateFilters({ unread });
  const setSort = (sort: ReaderPageState['sort']) => updateFilters({ sort });
  const caps = useCapabilities();

  const [selectedArticle, setSelectedArticle] = useState<number | null>(() => articleRouteId(location.pathname));
  const [openTags, setOpenTags] = useState(false);
  const preferences = useBrowserPreferences();
  const openMode = preferences.values.openMode;
  const markOnScroll = preferences.values.readOnScroll === 'true';
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const scrolledIds = useRef(new Set<number>());
  const scope = `${selection.kind}:${selection.id ?? 'root'}`;
  const storedDensity =
    typeof localStorage === 'undefined' ? null : localStorage.getItem(`brew:density:${scope}`);
  const density =
    (new URLSearchParams(location.search).get('density') as Density | null) ??
    (storedDensity === 'title' || storedDensity === 'magazine' || storedDensity === 'cards'
      ? storedDensity
      : 'magazine');
  const outputState = { ...state, density };
  const bulk = useBulkRead(readerPageHref(outputState));
  const askBulk = bulk.ask;
  const bulkTrigger = useRef<HTMLButtonElement>(null);
  const requestBulk = useCallback(() => {
    void askBulk({ kind: 'reader', view: selection.kind === 'today' || selection.kind === 'starred' ? selection.kind : 'all',
      ...(selection.kind === 'feed' && selection.id ? { feedId: selection.id } : {}),
      ...(selection.kind === 'folder' && selection.id ? { folderId: selection.id } : {}) }, 'Mark all articles read?', bulkTrigger.current);
  }, [askBulk, selection.kind, selection.id]);
  useTextAlternates(caps.data?.outputs?.twins ? readerPageHref(outputState) : null);
  const query = useInfiniteQuery({
    queryKey: ['articles', selection.kind, selection.id, unreadOnly, sort, state.page],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        view: ['today', 'starred'].includes(selection.kind) ? selection.kind : 'all',
        unread: String(unreadOnly),
        sort,
        limit: '50', includeTotal: 'true', offset: String((state.page - 1) * readerPageSize),
      });
      if (selection.kind === 'feed' && selection.id) params.set('feedId', String(selection.id));
      if (selection.kind === 'folder' && selection.id) params.set('folderId', String(selection.id));
      if (pageParam) params.set('cursor', pageParam);
      return getJson<ArticlePage>(`/api/articles?${params}`, signal);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const articles = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const rows = useMemo<VirtualRow[]>(() => {
    if (selection.kind !== 'today')
      return articles.map((article) => ({ kind: 'article', article }));
    const groups = articles.reduce<Map<string, ArticleSummary[]>>((result, article) => {
      const name = article.folderTitle ?? 'Unfiled';
      result.set(name, [...(result.get(name) ?? []), article]);
      return result;
    }, new Map());
    return [...groups].flatMap(([title, items]) => [
      { kind: 'header' as const, title },
      ...items.map((article) => ({ kind: 'article' as const, article })),
    ]);
  }, [articles, selection.kind]);
  const parent = useRef<HTMLDivElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const { prepareArticle, articleReturnTarget } = useArticleFocusReturn(parent, articles, listHeading);
  const openArticle = useCallback((id: number, tags = false) => {
    prepareArticle(id);
    setOpenTags(tags);
    setSelectedArticle(id);
  }, [prepareArticle]);
  const lanes = density === 'cards' && selection.kind !== 'today' ? 2 : 1;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is the mandated list engine and intentionally manages mutable measurements.
  const virtualizer = useVirtualizer({
    count: rows.length + (query.hasNextPage && !query.isError ? 1 : 0),
    getScrollElement: () => parent.current,
    estimateSize: () => (density === 'title' ? 62 : density === 'cards' ? 270 : 126),
    overscan: 8,
    lanes,
    gap: density === 'cards' ? 12 : 0,
  });
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualItems.at(-1);
    if (last && last.index >= rows.length - 4 && query.hasNextPage && !query.isError && !query.isFetchingNextPage)
      void query.fetchNextPage();
  }, [virtualItems, rows.length, query]);
  const [failedScroll, setFailedScroll] = useState<number[]>([]);
  const [readError, setReadError] = useState('');
  const markScrolled = useCallback(async (ids: number[]) => {
    const results = await Promise.allSettled(ids.map((id) => updateArticleState(client, id, { read: true })));
    const failed = ids.filter((_, index) => results[index]!.status === 'rejected');
    setFailedScroll((previous) => [...new Set([...previous.filter((id) => !ids.includes(id)), ...failed])]);
  }, [client]);
  useEffect(() => {
    if (!markOnScroll) return;
    const offset = virtualizer.scrollOffset ?? 0;
    const passed = virtualItems
      .map((item) => ({ item, row: rows[item.index] }))
      .filter(
        ({ item, row }) =>
          item.end < offset &&
          row?.kind === 'article' &&
          !row.article.readAt &&
          !scrolledIds.current.has(row.article.id),
      )
      .map(({ row }) => (row as { kind: 'article'; article: ArticleSummary }).article.id);
    if (!passed.length) return;
    for (const id of passed) scrolledIds.current.add(id);
    void markScrolled(passed);
  }, [markOnScroll, markScrolled, rows, virtualItems, virtualizer.scrollOffset]);
  const chooseDensity = useCallback(
    (next: Density) => {
      localStorage.setItem(`brew:density:${scope}`, next);
      navigateReader(readerPageHref({ ...readerState(), density: next, page: 1 }));
    },
    [scope],
  );
  const updateFocused = useCallback(async (article: ArticleSummary, values: { read?: boolean; starred?: boolean }) => {
    setReadError('');
    try {
      await updateArticleState(client, article.id, values);
    } catch (error) {
      setReadError((error as Error).message);
    }
  }, [client]);
  useLayoutEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if ((event.target as HTMLElement | null)?.closest('dialog')) return;
      if (['Enter', ' '].includes(event.key) && (event.target as HTMLElement | null)?.closest('button,a[href]')) return;
      if (event.shiftKey && key === 'a') {
        event.preventDefault();
        requestBulk();
        return;
      }
      if (key === '1' || key === '2' || key === '3') {
        event.preventDefault();
        chooseDensity(key === '1' ? 'title' : key === '2' ? 'magazine' : 'cards');
        return;
      }
      if (!articles.length) return;
      if (key === 'j' || key === 'k') {
        event.preventDefault();
        const next =
          key === 'j'
            ? Math.min(articles.length - 1, focusedIndex + 1)
            : Math.max(0, focusedIndex < 0 ? 0 : focusedIndex - 1);
        setFocusedIndex(next);
        const rowIndex = rows.findIndex(
          (row) => row.kind === 'article' && row.article.id === articles[next]?.id,
        );
        if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
        return;
      }
      const article = articles[Math.max(0, focusedIndex)];
      if (!article) return;
      if (key === 'o' || event.key === 'Enter') {
        event.preventDefault();
        openArticle(article.id);
      }
      if (key === 'm') {
        event.preventDefault();
        void updateFocused(article, { read: !article.readAt });
      }
      if (key === 's') {
        event.preventDefault();
        void updateFocused(article, { starred: !article.starredAt });
      }
      if (key === 't') {
        event.preventDefault();
        openArticle(article.id, true);
      }
      if (key === 'v') {
        event.preventDefault();
        window.open(article.url, '_blank', 'noopener,noreferrer');
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [
    articles,
    chooseDensity,
    focusedIndex,
    requestBulk,
    rows,
    openArticle,
    updateFocused,
    virtualizer,
  ]);

  return (
    <div className="reader-workspace flex h-[calc(100vh-4rem)] min-w-0">
      <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-8 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-soft">Reader</p>
          <h1 ref={listHeading} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight">{selection.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-subtle p-1" aria-label="Article filter">
            <button
              aria-pressed={!unreadOnly}
              onClick={() => setUnreadOnly(false)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${!unreadOnly ? 'bg-surface shadow-raised' : 'text-soft'}`}
            >
              All
            </button>
            <button
              aria-pressed={unreadOnly}
              onClick={() => setUnreadOnly(true)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${unreadOnly ? 'bg-surface shadow-raised' : 'text-soft'}`}
            >
              Unread
            </button>
          </div>
          <button
            data-brew-action="mark-all-read"
            ref={bulkTrigger}
            onClick={requestBulk}
            disabled={bulk.busy || !bulk.capable}
            className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs font-semibold"
          >
            Mark all read
          </button>
          <label className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={markOnScroll}
              data-brew-action="set-read-on-scroll"
              onChange={(event) => {
                if (preferences.save('readOnScroll', String(event.target.checked), 'Read on scroll')) {
                  scrolledIds.current.clear();
                  setFailedScroll([]);
                }
              }}
            />{' '}
            Read on scroll
          </label>
          <select
            aria-label="Sort articles"
            value={sort}
            onChange={(event) => setSort(event.target.value as 'newest' | 'oldest')}
            className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <select
            aria-label="Open articles"
            data-brew-action="set-open-mode"
            value={openMode}
            onChange={(event) => {
              preferences.save('openMode', event.target.value, 'Article opening mode');
            }}
            className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs"
          >
            <option value="overlay">Open in overlay</option>
            <option value="pane">Open in pane</option>
          </select>
          <div
            className="flex rounded-lg border border-line-strong bg-surface p-0.5"
            aria-label="View density"
          >
            {(['title', 'magazine', 'cards'] as const).map((value) => (
              <button
                key={value}
                title={`${value} view`}
                aria-label={`${value} view`}
                aria-pressed={density === value}
                onClick={() => chooseDensity(value)}
                className={`rounded-md px-2.5 py-1.5 text-xs capitalize ${density === value ? 'bg-inverse text-on-inverse' : 'text-soft'}`}
              >
                {value === 'title' ? '☰' : value === 'magazine' ? '▤' : '▦'}
              </button>
            ))}
          </div>
        </div>
      </header>
      <PreferenceFeedback preferences={preferences} name="Reader preferences result" />
      {readError && <p role="alert" className="px-8 py-2 text-sm text-danger">{readError}</p>}
      {failedScroll.length > 0 && <p role="alert" className="px-8 py-2 text-sm text-danger">
        Could not save {failedScroll.length} read updates.{' '}
        <button type="button" className="underline" onClick={() => void markScrolled(failedScroll)}>Retry read updates</button>
      </p>}
      <ReaderReadFeedback query={query} subject="articles" retryLabel="Retry articles" moreLabel="Retry more articles" focusRef={listHeading} announcement={query.data?.pages[0]?.total === undefined ? `${articles.length} articles loaded.` : ''} />
      <div ref={parent} data-reader-scroll data-testid="virtual-article-list" className="min-h-0 flex-1 overflow-auto">
        <div
          className="relative mx-auto max-w-5xl px-8"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualItems.map((item) => {
            const row = rows[item.index];
            const laneWidth = 100 / lanes;
            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="absolute top-0 py-1"
                style={{
                  transform: `translateY(${item.start}px)`,
                  left: lanes > 1 ? `calc(${item.lane * laneWidth}% + 1rem)` : '2rem',
                  width: lanes > 1 ? `calc(${laneWidth}% - 1.5rem)` : 'calc(100% - 4rem)',
                }}
              >
                {row ? (
                  row.kind === 'header' ? (
                    <h2 className="border-b border-line py-3 text-xs font-semibold uppercase tracking-wider text-muted">
                      {row.title}
                    </h2>
                  ) : (
                    <ArticleRow
                      article={row.article}
                      directImages={preferences.values.images === 'direct'}
                      density={density}
                      focused={articles[focusedIndex]?.id === row.article.id}
                      onOpen={() => {
                        setFocusedIndex(
                          articles.findIndex((article) => article.id === row.article.id),
                        );
                        openArticle(row.article.id);
                      }}
                    />
                  )
                ) : (
                  <p className="py-6 text-center text-xs text-muted">Loading more…</p>
                )}
              </div>
            );
          })}
        </div>
        {query.isSuccess && rows.length === 0 && <ReaderEmptyPage state={state}>Nothing here yet. A quiet inbox is a good inbox.</ReaderEmptyPage>}
      </div>
      <BulkReadUi action={bulk} />
      {query.data?.pages[0]?.total !== undefined && <ReaderPageFooter state={outputState} total={query.data.pages[0].total} shown={articles.length} stale={query.isError} twins={Boolean(caps.data?.outputs?.twins)} />}
      </div>
      {selectedArticle !== null && (
        <ArticleReader
          id={selectedArticle}
          initialTags={openTags}
          mode={openMode}
          onClose={() => setSelectedArticle(null)}
          returnFocus={articleReturnTarget}
        />
      )}
    </div>
  );
}

function ArticleRow({
  article,
  directImages,
  density,
  focused,
  onOpen,
}: {
  article: ArticleSummary;
  directImages: boolean;
  density: Density;
  focused: boolean;
  onOpen: () => void;
}) {
  const highlightStyle = article.highlightColor
    ? { borderLeftColor: article.highlightColor, borderLeftWidth: 4 }
    : undefined;
  const meta = (
    <div className="flex items-center gap-2 text-xs text-soft">
      <span>{article.feedTitle}</span>
      <span>·</span>
      <time>
        {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
          new Date(article.publishedAt),
        )}
      </time>
      {article.starredAt && (
        <span aria-label="Starred" className="text-ink">
          ★
        </span>
      )}
    </div>
  );
  const openButton = <button type="button" className="reader-article-open" aria-label={`Open article · ${article.title}`} data-brew-action="open" onClick={onOpen}>{article.title}</button>;
  if (density === 'title')
    return (
      <article
        style={highlightStyle}
        aria-label={article.title}
        {...articleDom(article)}
        data-brew-density={density}
        data-focused={focused}
        onClick={(event) => { if (!(event.target as HTMLElement).closest('a,button,input,select,textarea')) onOpen(); }}
        className={`brew-list-item flex min-h-14 cursor-pointer items-center justify-between border-b border-line bg-surface py-3 outline-none focus-visible:ring-2 focus-visible:ring-ink ${focused ? 'ring-2 ring-inset ring-ink' : ''} ${article.readAt ? 'opacity-50' : ''}`}
      >
        <h3 aria-label={article.title} className="truncate pr-4 text-sm font-semibold">{openButton}</h3>
        {meta}
      </article>
    );
  if (density === 'cards')
    return (
      <article
        style={highlightStyle}
        aria-label={article.title}
        {...articleDom(article)}
        data-brew-density={density}
        data-focused={focused}
        onClick={(event) => { if (!(event.target as HTMLElement).closest('a,button,input,select,textarea')) onOpen(); }}
        className={`h-[258px] cursor-pointer overflow-hidden rounded-2xl border border-line bg-surface shadow-raised outline-none focus-visible:ring-2 focus-visible:ring-ink ${focused ? 'ring-2 ring-ink' : ''} ${article.readAt ? 'opacity-55' : ''}`}
      >
        {article.imageUrl ? (
          <img src={imageSource(article.imageUrl, directImages)} alt="" loading="lazy" className="h-28 w-full object-cover" />
        ) : (
          <div className="h-28 bg-gradient-to-br from-art-1 to-art-3" />
        )}
        <div className="p-4">
          {meta}
          <h3 aria-label={article.title} className="mt-2 line-clamp-2 text-lg font-semibold leading-snug tracking-tight">
            {openButton}
          </h3>
          {article.summaryHtml && (
            <div
              className="mt-2 line-clamp-2 text-sm text-soft"
              dangerouslySetInnerHTML={{ __html: article.summaryHtml }}
            />
          )}
        </div>
      </article>
    );
  return (
    <article
      style={highlightStyle}
        aria-label={article.title}
        {...articleDom(article)}
        data-brew-density={density}
      data-focused={focused}
        onClick={(event) => { if (!(event.target as HTMLElement).closest('a,button,input,select,textarea')) onOpen(); }}
      className={`flex min-h-[116px] cursor-pointer gap-5 border-b border-line bg-surface py-4 outline-none focus-visible:ring-2 focus-visible:ring-ink ${focused ? 'ring-2 ring-inset ring-ink' : ''} ${article.readAt ? 'opacity-55' : ''}`}
    >
      <div className="min-w-0 flex-1">
        {meta}
        <h3 aria-label={article.title} className="mt-1 text-lg font-semibold tracking-tight">{openButton}</h3>
        {article.summaryHtml && (
          <div
            className="mt-1 line-clamp-2 text-sm text-soft"
            dangerouslySetInnerHTML={{ __html: article.summaryHtml }}
          />
        )}
      </div>
      {article.imageUrl && (
        <img
          src={imageSource(article.imageUrl, directImages)}
          alt=""
          loading="lazy"
          className="h-20 w-28 shrink-0 rounded-lg object-cover"
        />
      )}
    </article>
  );
}
