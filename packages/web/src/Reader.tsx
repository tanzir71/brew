import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ModeChip } from './components/ModeChip';
import type {
  ArticleDetail,
  ArticlePage,
  ArticleSummary,
  MarkAllReadResult,
  ReaderNavigation,
  SearchPage,
  TagSummary,
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

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load your library');
  return response.json() as Promise<T>;
}
const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.matches('input, textarea, select') || target.isContentEditable);
const imageSource = (value: string) => localStorage.getItem('brew:direct-images') === 'true' && value.startsWith('/api/img?src=') ? decodeURIComponent(value.slice(13)) : localStorage.getItem('brew:direct-images') === 'true' ? value : value.startsWith('/api/img?') ? value : `/api/img?src=${encodeURIComponent(value)}`;

export function Reader({
  searchQuery,
  onSearch,
  onClearSearch,
}: {
  searchQuery: string;
  onSearch:(query:string)=>void;
  onClearSearch: () => void;
}) {
  const queryClient = useQueryClient();
  const [navigation, setNavigation] = useState(emptyNavigation);
  const [selection, setSelection] = useState<Selection>(() => {
    const params = new URLSearchParams(location.search);
    for (const kind of ['feed', 'folder'] as const) {
      const id = Number(params.get(kind));
      if (Number.isInteger(id) && id > 0) return { kind, id, title: params.get('name') || (kind === 'feed' ? 'Feed' : 'Folder') };
    }
    const scope = params.get('scope');
    return scope === 'all' || scope === 'today' || scope === 'starred' ? { kind: scope, title: { all: 'All articles', today: 'Today', starred: 'Starred' }[scope] } : { kind: 'brew', title: 'The Brew' };
  });
  const [error, setError] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const pendingGo = useRef(false);
  const pendingGoTimer = useRef<number | null>(null);
  const [savedSearches,setSavedSearches]=useState<Array<{id:string;name:string;query:string}>>(()=>{try{return JSON.parse(localStorage.getItem('brew:saved-searches')??'[]') as Array<{id:string;name:string;query:string}>}catch{return[]}});
  const persistSearches=(next:Array<{id:string;name:string;query:string}>)=>{setSavedSearches(next);localStorage.setItem('brew:saved-searches',JSON.stringify(next))};
  useEffect(() => {
    const refresh = () => {
      void getJson<ReaderNavigation>('/api/reader/navigation')
        .then(setNavigation)
        .catch((reason: Error) => setError(reason.message));
    };
    refresh();
    const events = new EventSource('/api/events');
    events.addEventListener('article:new', () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['articles'] });
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
    setError('');
    setSelection(next);
  }, []);
  useEffect(() => {
    const show = () => setShowShortcuts(true);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showShortcuts) {
        event.preventDefault();
        setShowShortcuts(false);
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (event.key === '?') {
        event.preventDefault();
        setShowShortcuts(true);
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
  }, [choose, queryClient, showShortcuts]);
  const itemClass = (active: boolean) =>
    `flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${active ? 'bg-subtle font-semibold text-ink' : 'text-soft hover:bg-subtle hover:text-ink'}`;
  return (
    <>
      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-[15.5rem_minmax(0,1fr)]">
        <aside
          aria-label="Reader navigation"
          className="flex flex-col border-r border-line bg-canvas px-4 py-6"
        >
          <nav className="space-y-1">
            <button
              className={itemClass(selection.kind === 'brew')}
              onClick={() => choose({ kind: 'brew', title: 'The Brew' })}
            >
              <span>☕ The Brew</span>
            </button>
            <button
              className={itemClass(selection.kind === 'today')}
              onClick={() => choose({ kind: 'today', title: 'Today' })}
            >
              <span>Today</span>
              <Count value={navigation.counts.today} />
            </button>
            <button
              className={itemClass(selection.kind === 'all')}
              onClick={() => choose({ kind: 'all', title: 'All articles' })}
            >
              <span>All</span>
              <Count value={navigation.counts.all} />
            </button>
            <button
              className={itemClass(selection.kind === 'starred')}
              onClick={() => choose({ kind: 'starred', title: 'Starred' })}
            >
              <span>Starred</span>
              <Count value={navigation.counts.starred} />
            </button>
          </nav>
          <div className="my-5 h-px bg-line" />
          {savedSearches.length>0&&<section className="mb-5"><p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted">Saved searches</p>{savedSearches.map((saved)=><div key={saved.id} className="group flex items-center"><button className={`${itemClass(searchQuery===saved.query)} min-w-0 flex-1`} onClick={()=>onSearch(saved.query)}><span className="truncate">⌕ {saved.name}</span></button><button aria-label={`Delete saved search ${saved.name}`} onClick={()=>persistSearches(savedSearches.filter((item)=>item.id!==saved.id))} className="px-1 text-xs text-muted opacity-0 group-hover:opacity-100">×</button></div>)}</section>}
          <div className="space-y-4">
            {navigation.folders.map((folder) => (
              <section key={folder.id}>
                <button
                  onClick={() => choose({ kind: 'folder', id: folder.id, title: folder.title })}
                  className="flex w-full items-center justify-between px-3 py-1 text-xs font-semibold uppercase tracking-wider text-soft"
                >
                  <span>{folder.title}</span>
                  <Count value={folder.unreadCount} />
                </button>
                <div className="mt-1 space-y-0.5">
                  {folder.feeds.map((feed) => (
                    <button
                      key={feed.id}
                      className={itemClass(selection.kind === 'feed' && selection.id === feed.id)}
                      onClick={() => choose({ kind: 'feed', id: feed.id, title: feed.title })}
                    >
                      <span className="flex min-w-0 items-center gap-2"><FeedIcon id={feed.id} title={feed.title}/><span className="truncate">{feed.title}</span></span>
                      <Count value={feed.unreadCount} />
                    </button>
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
                  <button
                    key={feed.id}
                    className={itemClass(selection.kind === 'feed' && selection.id === feed.id)}
                    onClick={() => choose({ kind: 'feed', id: feed.id, title: feed.title })}
                  >
                    <span className="flex min-w-0 items-center gap-2"><FeedIcon id={feed.id} title={feed.title}/><span className="truncate">{feed.title}</span></span>
                    <Count value={feed.unreadCount} />
                  </button>
                ))}
              </section>
            )}
          </div>
          <div className="reader-mode-footer"><ModeChip /></div>
        </aside>
        <section className="min-w-0 bg-surface">
          {searchQuery ? (
            <SearchView
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
              onSave={()=>{const name=window.prompt('Saved search name',searchQuery)?.trim();if(name)persistSearches([...savedSearches,{id:crypto.randomUUID(),name,query:searchQuery}])}}
            />
          ) : error ? (
            <p role="alert" className="m-10 rounded-xl bg-danger-soft p-4 text-sm text-danger">
              {error}
            </p>
          ) : selection.kind === 'brew' ? (
            <>
              <header className="border-b border-line px-10 py-7">
                <p className="text-xs font-semibold uppercase tracking-[.18em] text-soft">
                  Reader
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">{selection.title}</h1>
              </header>
              <BrewWelcome />
            </>
          ) : (
            <ArticleList
              key={`${selection.kind}:${selection.id ?? 'root'}`}
              selection={selection}
            />
          )}
        </section>
      </div>
      {showShortcuts && <ShortcutSheet onClose={() => setShowShortcuts(false)} />}
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
  return (
    <div className="mx-auto max-w-2xl px-10 py-20 text-center">
      <p className="text-xs font-semibold uppercase tracking-[.24em] text-soft">
        Your morning paper
      </p>
      <h2 className="mt-3 text-4xl font-semibold tracking-tight">A calmer way to catch up.</h2>
      <p className="mx-auto mt-4 max-w-md text-soft">
        Your frozen daily Brew will appear here. Until then, Today gathers the last 24 hours.
      </p>
    </div>
  );
}
function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const groups = [
    [
      'Move',
      [
        ['j / k', 'Next / previous article'],
        ['o / Enter', 'Open article'],
        ['Esc', 'Close article'],
      ],
    ],
    [
      'Act',
      [
        ['m', 'Toggle read'],
        ['s', 'Toggle star'],
        ['t', 'Edit tags'],
        ['v', 'Open original'],
        ['Shift + A', 'Mark all read'],
        ['r', 'Refresh'],
      ],
    ],
    [
      'Go',
      [
        ['g b', 'The Brew'],
        ['g t', 'Today'],
        ['g a', 'All articles'],
        ['/', 'Search'],
      ],
    ],
    [
      'View',
      [
        ['1 / 2 / 3', 'Title / magazine / cards'],
        ['?', 'This shortcut guide'],
      ],
    ],
  ] as const;
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-scrim/40 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-2xl rounded-3xl border border-line bg-surface p-7 shadow-overlay"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-soft">
              Keyboard first
            </p>
            <h2 className="mt-1 text-2xl font-semibold">Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close shortcuts"
            className="rounded-full px-3 py-2 text-soft hover:bg-subtle"
          >
            ✕
          </button>
        </div>
        <div className="mt-7 grid gap-7 sm:grid-cols-2">
          {groups.map(([title, rows]) => (
            <section key={title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {title}
              </h3>
              <dl className="mt-2 space-y-2">
                {rows.map(([keys, label]) => (
                  <div key={keys} className="flex items-center justify-between gap-4 text-sm">
                    <dt className="text-soft">{label}</dt>
                    <dd>
                      <kbd className="rounded-md border border-line-strong bg-canvas px-2 py-1 font-mono text-xs">
                        {keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
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
  const [scope, setScope] = useState<'all' | 'folder' | 'starred'>('all');
  const [selectedArticle, setSelectedArticle] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const results = useInfiniteQuery({
    queryKey: ['search', query, scope, currentFolderId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        q: query,
        scope,
        limit: '50',
        offset: String(pageParam),
      });
      if (scope === 'folder' && currentFolderId !== undefined)
        params.set('folderId', String(currentFolderId));
      return getJson<SearchPage>(`/api/search?${params}`);
    },
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    enabled: scope !== 'folder' || currentFolderId !== undefined,
  });
  const items = useMemo(
    () => results.data?.pages.flatMap((page) => page.items) ?? [],
    [results.data],
  );
  const parent = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- Search results use the same mandated virtual list engine as the Reader.
  const virtualizer = useVirtualizer({
    count: items.length + (results.hasNextPage ? 1 : 0),
    getScrollElement: () => parent.current,
    estimateSize: () => 126,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualItems.at(-1);
    if (
      last &&
      last.index >= items.length - 4 &&
      results.hasNextPage &&
      !results.isFetchingNextPage
    )
      void results.fetchNextPage();
  }, [items.length, results, virtualItems]);
  useLayoutEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || selectedArticle !== null || !items.length) return;
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
        setSelectedArticle(items[Math.max(0, focusedIndex)]!.id);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [focusedIndex, items, selectedArticle, virtualizer]);
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-8 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-soft">Search</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">“{query}”</h1>
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
              disabled={currentFolderId === undefined}
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
      <div className="border-b border-line px-8 py-2 text-xs text-soft">
        {items.length} result{items.length === 1 ? '' : 's'}
        {results.data?.pages.at(-1)
          ? ` · ${results.data.pages.at(-1)!.durationMs.toFixed(1)} ms`
          : ''}
      </div>
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
                    density="magazine"
                    focused={items[focusedIndex]?.id === article.id}
                    onOpen={() => {
                      setFocusedIndex(virtual.index);
                      setSelectedArticle(article.id);
                    }}
                  />
                ) : (
                  <p className="py-6 text-center text-xs text-muted">Searching more…</p>
                )}
              </div>
            );
          })}
        </div>
        {!results.isLoading && !items.length && (
          <p className="px-10 py-20 text-center text-sm text-soft">
            No matching articles. Try fewer or broader words.
          </p>
        )}
      </div>
      {selectedArticle !== null && (
        <ArticleReader
          id={selectedArticle}
          mode="overlay"
          onClose={() => setSelectedArticle(null)}
        />
      )}
    </div>
  );
}

function ArticleList({ selection }: { selection: Selection }) {
  const client = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [densityByScope, setDensityByScope] = useState<Record<string, Density>>({});
  const [selectedArticle, setSelectedArticle] = useState<number | null>(null);
  const [openMode, setOpenMode] = useState<'overlay' | 'pane'>(() =>
    localStorage.getItem('brew:article-open-mode') === 'pane' ? 'pane' : 'overlay',
  );
  const [markOnScroll, setMarkOnScroll] = useState(
    () => localStorage.getItem('brew:mark-read-on-scroll') === 'true',
  );
  const [undo, setUndo] = useState<(MarkAllReadResult & { articleIds: number[] }) | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const scrolledIds = useRef(new Set<number>());
  const scope = `${selection.kind}:${selection.id ?? 'root'}`;
  const storedDensity =
    typeof localStorage === 'undefined' ? null : localStorage.getItem(`brew:density:${scope}`);
  const density =
    densityByScope[scope] ??
    (storedDensity === 'title' || storedDensity === 'magazine' || storedDensity === 'cards'
      ? storedDensity
      : 'magazine');
  const query = useInfiniteQuery({
    queryKey: ['articles', selection.kind, selection.id, unreadOnly, sort],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        view: ['today', 'starred'].includes(selection.kind) ? selection.kind : 'all',
        unread: String(unreadOnly),
        sort,
        limit: '50',
      });
      if (selection.kind === 'feed' && selection.id) params.set('feedId', String(selection.id));
      if (selection.kind === 'folder' && selection.id) params.set('folderId', String(selection.id));
      if (pageParam) params.set('cursor', pageParam);
      return getJson<ArticlePage>(`/api/articles?${params}`);
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
  const lanes = density === 'cards' && selection.kind !== 'today' ? 2 : 1;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is the mandated list engine and intentionally manages mutable measurements.
  const virtualizer = useVirtualizer({
    count: rows.length + (query.hasNextPage ? 1 : 0),
    getScrollElement: () => parent.current,
    estimateSize: () => (density === 'title' ? 62 : density === 'cards' ? 270 : 126),
    overscan: 8,
    lanes,
    gap: density === 'cards' ? 12 : 0,
  });
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualItems.at(-1);
    if (last && last.index >= rows.length - 4 && query.hasNextPage && !query.isFetchingNextPage)
      void query.fetchNextPage();
  }, [virtualItems, rows.length, query]);
  const patchReadState = useCallback(
    (ids: number[], readAt: string | null) => {
      const selected = new Set(ids);
      client.setQueriesData<InfiniteData<ArticlePage>>({ queryKey: ['articles'] }, (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                items: page.items.map((article) =>
                  selected.has(article.id) ? { ...article, readAt } : article,
                ),
              })),
            }
          : current,
      );
    },
    [client],
  );
  const patchStarState = useCallback(
    (id: number, starredAt: string | null) => {
      client.setQueriesData<InfiniteData<ArticlePage>>({ queryKey: ['articles'] }, (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                items: page.items.map((article) =>
                  article.id === id ? { ...article, starredAt } : article,
                ),
              })),
            }
          : current,
      );
    },
    [client],
  );
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
    patchReadState(passed, new Date().toISOString());
    void Promise.all(
      passed.map((id) =>
        fetch(`/api/articles/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ read: true }),
        }),
      ),
    ).then(() => window.dispatchEvent(new Event('brew:navigation-refresh')));
  }, [markOnScroll, patchReadState, rows, virtualItems, virtualizer.scrollOffset]);
  useEffect(() => {
    if (!undo) return;
    const timeout = window.setTimeout(
      () => setUndo(null),
      Math.max(0, new Date(undo.expiresAt).getTime() - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [undo]);
  const chooseDensity = useCallback(
    (next: Density) => {
      localStorage.setItem(`brew:density:${scope}`, next);
      setDensityByScope((current) => ({ ...current, [scope]: next }));
    },
    [scope],
  );
  const markAll = useCallback(async () => {
    const articleIds = articles.filter((article) => !article.readAt).map((article) => article.id);
    patchReadState(articleIds, new Date().toISOString());
    const body: { view: 'all' | 'today' | 'starred'; feedId?: number; folderId?: number } = {
      view: selection.kind === 'today' || selection.kind === 'starred' ? selection.kind : 'all',
    };
    if (selection.kind === 'feed' && selection.id) body.feedId = selection.id;
    if (selection.kind === 'folder' && selection.id) body.folderId = selection.id;
    try {
      const response = await fetch('/api/articles/mark-all-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Could not mark articles read');
      const result = (await response.json()) as MarkAllReadResult;
      setUndo({ ...result, articleIds });
      window.dispatchEvent(new Event('brew:navigation-refresh'));
    } catch {
      patchReadState(articleIds, null);
    }
  }, [articles, patchReadState, selection.id, selection.kind]);
  const undoMarkAll = async () => {
    if (!undo) return;
    const current = undo;
    setUndo(null);
    patchReadState(current.articleIds, null);
    const response = await fetch('/api/articles/mark-all-read/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ undoToken: current.undoToken }),
    });
    if (!response.ok) {
      void query.refetch();
      return;
    }
    window.dispatchEvent(new Event('brew:navigation-refresh'));
  };
  const updateFocused = useCallback(
    async (article: ArticleSummary, values: { read?: boolean; starred?: boolean }) => {
      if (values.read !== undefined)
        patchReadState([article.id], values.read ? new Date().toISOString() : null);
      if (values.starred !== undefined)
        patchStarState(article.id, values.starred ? new Date().toISOString() : null);
      const response = await fetch(`/api/articles/${article.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        void query.refetch();
        return;
      }
      const saved = (await response.json()) as ArticleDetail;
      patchReadState([article.id], saved.readAt);
      patchStarState(article.id, saved.starredAt);
      window.dispatchEvent(new Event('brew:navigation-refresh'));
    },
    [patchReadState, patchStarState, query],
  );
  useLayoutEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const dialog = document.querySelector<HTMLElement>('[aria-label="Article reader"]');
      if (dialog) {
        if (key === 'm') {
          event.preventDefault();
          dialog.querySelector<HTMLButtonElement>('[data-shortcut="m"]')?.click();
        }
        if (key === 's') {
          event.preventDefault();
          dialog.querySelector<HTMLButtonElement>('[data-shortcut="s"]')?.click();
        }
        if (key === 't') {
          event.preventDefault();
          dialog.querySelector<HTMLButtonElement>('[data-shortcut="t"]')?.click();
        }
        if (key === 'v') {
          event.preventDefault();
          dialog.querySelector<HTMLAnchorElement>('a[href]')?.click();
        }
        return;
      }
      if (event.shiftKey && key === 'a') {
        event.preventDefault();
        void markAll();
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
        setSelectedArticle(article.id);
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
        setSelectedArticle(article.id);
        window.setTimeout(() => {
          const dialog = document.querySelector<HTMLElement>('[aria-label="Article reader"]');
          dialog?.querySelector<HTMLButtonElement>('[data-shortcut="t"]')?.click();
        }, 80);
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
    markAll,
    rows,
    selectedArticle,
    updateFocused,
    virtualizer,
  ]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-8 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-soft">Reader</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{selection.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-subtle p-1" aria-label="Article filter">
            <button
              onClick={() => setUnreadOnly(false)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${!unreadOnly ? 'bg-surface shadow-raised' : 'text-soft'}`}
            >
              All
            </button>
            <button
              onClick={() => setUnreadOnly(true)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${unreadOnly ? 'bg-surface shadow-raised' : 'text-soft'}`}
            >
              Unread
            </button>
          </div>
          <button
            onClick={markAll}
            className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs font-semibold"
          >
            Mark all read
          </button>
          <label className="flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={markOnScroll}
              onChange={(event) => {
                setMarkOnScroll(event.target.checked);
                localStorage.setItem('brew:mark-read-on-scroll', String(event.target.checked));
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
            value={openMode}
            onChange={(event) => {
              const mode = event.target.value as 'overlay' | 'pane';
              setOpenMode(mode);
              localStorage.setItem('brew:article-open-mode', mode);
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
                      density={density}
                      focused={articles[focusedIndex]?.id === row.article.id}
                      onOpen={() => {
                        setFocusedIndex(
                          articles.findIndex((article) => article.id === row.article.id),
                        );
                        setSelectedArticle(row.article.id);
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
        {!query.isLoading && rows.length === 0 && (
          <p className="px-10 py-20 text-center text-sm text-soft">
            Nothing here yet. A quiet inbox is a good inbox.
          </p>
        )}
      </div>
      {undo && (
        <div
          role="status"
          className="brew-undo-toast fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full bg-inverse px-5 py-3 text-sm text-on-inverse shadow-overlay"
        >
          <span>Marked {undo.updated} read.</span>
          <button onClick={undoMarkAll} className="font-semibold text-on-inverse">
            Undo
          </button>
        </div>
      )}
      {selectedArticle !== null && (
        <ArticleReader
          id={selectedArticle}
          mode={openMode}
          onClose={() => setSelectedArticle(null)}
        />
      )}
    </div>
  );
}

function ArticleRow({
  article,
  density,
  focused,
  onOpen,
}: {
  article: ArticleSummary;
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
  const activate = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };
  if (density === 'title')
    return (
      <article
        style={highlightStyle}
        role="button"
        tabIndex={0}
        data-focused={focused}
        onClick={onOpen}
        onKeyDown={activate}
        className={`brew-list-item flex min-h-14 cursor-pointer items-center justify-between border-b border-line bg-surface py-3 outline-none focus-visible:ring-2 focus-visible:ring-ink ${focused ? 'ring-2 ring-inset ring-ink' : ''} ${article.readAt ? 'opacity-50' : ''}`}
      >
        <h3 className="truncate pr-4 text-sm font-semibold">{article.title}</h3>
        {meta}
      </article>
    );
  if (density === 'cards')
    return (
      <article
        style={highlightStyle}
        role="button"
        tabIndex={0}
        data-focused={focused}
        onClick={onOpen}
        onKeyDown={activate}
        className={`h-[258px] cursor-pointer overflow-hidden rounded-2xl border border-line bg-surface shadow-raised outline-none focus-visible:ring-2 focus-visible:ring-ink ${focused ? 'ring-2 ring-ink' : ''} ${article.readAt ? 'opacity-55' : ''}`}
      >
        {article.imageUrl ? (
          <img src={imageSource(article.imageUrl)} alt="" loading="lazy" className="h-28 w-full object-cover" />
        ) : (
          <div className="h-28 bg-gradient-to-br from-art-1 to-art-3" />
        )}
        <div className="p-4">
          {meta}
          <h3 className="mt-2 line-clamp-2 text-lg font-semibold leading-snug tracking-tight">
            {article.title}
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
      role="button"
      tabIndex={0}
      data-focused={focused}
      onClick={onOpen}
      onKeyDown={activate}
      className={`flex min-h-[116px] cursor-pointer gap-5 border-b border-line bg-surface py-4 outline-none focus-visible:ring-2 focus-visible:ring-ink ${focused ? 'ring-2 ring-inset ring-ink' : ''} ${article.readAt ? 'opacity-55' : ''}`}
    >
      <div className="min-w-0 flex-1">
        {meta}
        <h3 className="mt-1 text-lg font-semibold tracking-tight">{article.title}</h3>
        {article.summaryHtml && (
          <div
            className="mt-1 line-clamp-2 text-sm text-soft"
            dangerouslySetInnerHTML={{ __html: article.summaryHtml }}
          />
        )}
      </div>
      {article.imageUrl && (
        <img
          src={imageSource(article.imageUrl)}
          alt=""
          loading="lazy"
          className="h-20 w-28 shrink-0 rounded-lg object-cover"
        />
      )}
    </article>
  );
}

export function ArticleReader({
  id,
  mode,
  onClose,
}: {
  id: number;
  mode: 'overlay' | 'pane';
  onClose: () => void;
}) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['article', id],
    queryFn: () => getJson<ArticleDetail>(`/api/articles/${id}`),
  });
  const [extracting, setExtracting] = useState(false);
  const [message, setMessage] = useState('');
  const [showTags, setShowTags] = useState(false);
  const [readingPrefs,setReadingPrefs]=useState(()=>{try{return JSON.parse(localStorage.getItem('brew:reading-prefs')??'{}') as {font?:'sans'|'serif';width?:'narrow'|'wide';lineHeight?:'compact'|'relaxed'}}catch{return{}}});
  const updatePrefs=(values:Partial<typeof readingPrefs>)=>setReadingPrefs((current)=>{const next={...current,...values};localStorage.setItem('brew:reading-prefs',JSON.stringify(next));return next});
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  const extract = async () => {
    setExtracting(true);
    setMessage('');
    try {
      const response = await fetch(`/api/articles/${id}/full-text`, { method: 'POST' });
      const body = (await response.json()) as ArticleDetail & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not load full article');
      client.setQueryData(['article', id], body);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load full article');
    } finally {
      setExtracting(false);
    }
  };
  const copy = async () => {
    if (!detail.data) return;
    await navigator.clipboard.writeText(detail.data.url);
    setMessage('Link copied.');
  };
  const patchLists = (next: ArticleDetail) =>
    client.setQueriesData<InfiniteData<ArticlePage>>({ queryKey: ['articles'] }, (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.map((article) =>
                article.id === next.id
                  ? { ...article, readAt: next.readAt, starredAt: next.starredAt }
                  : article,
              ),
            })),
          }
        : current,
    );
  const updateState = async (values: { read?: boolean; starred?: boolean }) => {
    const previous = detail.data;
    if (!previous) return;
    const optimistic: ArticleDetail = {
      ...previous,
      readAt:
        values.read === undefined ? previous.readAt : values.read ? new Date().toISOString() : null,
      starredAt:
        values.starred === undefined
          ? previous.starredAt
          : values.starred
            ? new Date().toISOString()
            : null,
    };
    client.setQueryData(['article', id], optimistic);
    patchLists(optimistic);
    try {
      const response = await fetch(`/api/articles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) throw new Error('Could not update article');
      const saved = (await response.json()) as ArticleDetail;
      client.setQueryData(['article', id], saved);
      patchLists(saved);
      window.dispatchEvent(new Event('brew:navigation-refresh'));
    } catch (error) {
      client.setQueryData(['article', id], previous);
      patchLists(previous);
      setMessage(error instanceof Error ? error.message : 'Could not update article');
    }
  };
  const shell =
    mode === 'overlay'
      ? 'fixed inset-0 top-16 z-40 bg-scrim/30 p-4 md:p-8'
      : 'fixed bottom-0 right-0 top-16 z-30 w-[min(48rem,58vw)] border-l border-line bg-surface shadow-overlay';
  return (
    <div
      className={shell}
      onMouseDown={(event) => {
        if (mode === 'overlay' && event.target === event.currentTarget) onClose();
      }}
    >
      <article
        role="dialog"
        aria-modal={mode === 'overlay'}
        aria-label="Article reader"
        className={`${mode === 'overlay' ? 'mx-auto h-full max-w-3xl rounded-2xl' : 'h-full'} overflow-y-auto bg-surface shadow-overlay`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              aria-label="Close article"
              className="rounded-full px-3 py-2 text-soft hover:bg-subtle"
            >
              ✕
            </button>
            {detail.data && (
              <>
                <a
                  href={detail.data.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg px-3 py-2 text-xs font-medium hover:bg-subtle"
                >
                  View original ↗
                </a>
                <button
                  onClick={copy}
                  className="rounded-lg px-3 py-2 text-xs font-medium hover:bg-subtle"
                >
                  Copy link
                </button>
              </>
            )}
          </div>
          <div className="flex gap-1" aria-label="Reading preferences"><select aria-label="Reader font" value={readingPrefs.font??'serif'} onChange={(event)=>updatePrefs({font:event.target.value as 'sans'|'serif'})} className="rounded border px-2 py-1 text-xs"><option value="sans">Sans</option><option value="serif">Serif</option></select><select aria-label="Reader width" value={readingPrefs.width??'narrow'} onChange={(event)=>updatePrefs({width:event.target.value as 'narrow'|'wide'})} className="rounded border px-2 py-1 text-xs"><option value="narrow">Narrow</option><option value="wide">Wide</option></select><select aria-label="Reader line height" value={readingPrefs.lineHeight??'relaxed'} onChange={(event)=>updatePrefs({lineHeight:event.target.value as 'compact'|'relaxed'})} className="rounded border px-2 py-1 text-xs"><option value="compact">Compact</option><option value="relaxed">Relaxed</option></select></div>
        </div>
        {detail.isLoading ? (
          <p className="p-12 text-center text-sm text-soft">Opening article…</p>
        ) : detail.isError || !detail.data ? (
          <p role="alert" className="p-12 text-center text-sm text-danger">
            Could not open this article.
          </p>
        ) : (
          <div className={`mx-auto px-7 py-12 ${readingPrefs.width==='wide'?'max-w-[880px]':'max-w-[680px]'}`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-soft">
              {detail.data.feedTitle}
            </p>
            <h1 className="mt-3 type-display-l">
              {detail.data.title}
            </h1>
            <div className="mt-4 flex flex-wrap gap-2 text-sm text-soft">
              {detail.data.author && <span>By {detail.data.author}</span>}
              <span>{detail.data.readTimeMinutes} min read</span>
              <time>
                {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                  new Date(detail.data.publishedAt),
                )}
              </time>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                data-shortcut="m"
                onClick={() => updateState({ read: !detail.data.readAt })}
                className="rounded-full border border-line-strong px-4 py-2 text-sm font-semibold"
              >
                {detail.data.readAt ? 'Mark unread' : 'Mark read'}
              </button>
              <button
                data-shortcut="s"
                onClick={() => updateState({ starred: !detail.data.starredAt })}
                aria-pressed={Boolean(detail.data.starredAt)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${detail.data.starredAt ? 'starred-burst border-line-strong bg-subtle text-soft' : 'border-line-strong'}`}
              >
                {detail.data.starredAt ? '★ Starred' : '☆ Star'}
              </button>
              <button
                data-shortcut="t"
                onClick={() => setShowTags((value) => !value)}
                className="rounded-full border border-line-strong px-4 py-2 text-sm font-semibold"
              >
                Tag{detail.data.tags.length ? ` · ${detail.data.tags.length}` : ''}
              </button>
            </div>
            {showTags && (
              <TagEditor
                article={detail.data}
                onChange={(next) => client.setQueryData(['article', id], next)}
              />
            )}{' '}
            {!detail.data.fullTextHtml && (
              <button
                disabled={extracting}
                onClick={extract}
                className="mt-8 rounded-full border border-line-strong px-4 py-2 text-sm font-semibold hover:bg-canvas disabled:opacity-50"
              >
                {extracting ? 'Loading full article…' : 'Load full article'}
              </button>
            )}
            {message && (
              <p role="status" className="mt-3 text-sm text-soft">
                {message}
              </p>
            )}
            {detail.data.enclosureUrl && detail.data.enclosureType?.startsWith('audio/') && (
              <audio
                aria-label={`Listen to ${detail.data.title}`}
                controls
                preload="none"
                className="mt-7 w-full"
                src={`/api/media?src=${encodeURIComponent(detail.data.enclosureUrl)}`}
              />
            )}
            <div
              data-reading-font={readingPrefs.font??'serif'}
              data-reading-line-height={readingPrefs.lineHeight??'relaxed'}
              className={`article-content mt-9 type-reading-body text-ink [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-5 [&_h2]:mt-9 [&_h2]:text-2xl [&_img]:my-7 [&_img]:h-auto [&_img]:max-w-full [&_p]:my-5`}
              dangerouslySetInnerHTML={{
                __html:
                  detail.data.fullTextHtml ??
                  detail.data.contentHtml ??
                  detail.data.summaryHtml ??
                  '<p>No article content was provided.</p>',
              }}
            />
          </div>
        )}
      </article>
    </div>
  );
}

function TagEditor({
  article,
  onChange,
}: {
  article: ArticleDetail;
  onChange: (article: ArticleDetail) => void;
}) {
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => getJson<TagSummary[]>('/api/tags') });
  const [name, setName] = useState('');
  const save = async (selected: TagSummary[]) => {
    const previous = article.tags;
    onChange({ ...article, tags: selected });
    const response = await fetch(`/api/articles/${article.id}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagIds: selected.map((tag) => tag.id) }),
    });
    if (response.ok) onChange((await response.json()) as ArticleDetail);
    else onChange({ ...article, tags: previous });
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    const response = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) return;
    const tag = (await response.json()) as TagSummary;
    setName('');
    await save([...article.tags, tag]);
  };
  return (
    <div className="mt-4 rounded-2xl border border-line bg-canvas p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-soft">Tags</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {tags.data?.map((tag) => {
          const active = article.tags.some((item) => item.id === tag.id);
          return (
            <button
              key={tag.id}
              aria-pressed={active}
              onClick={() =>
                save(
                  active
                    ? article.tags.filter((item) => item.id !== tag.id)
                    : [...article.tags, tag],
                )
              }
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${active ? 'bg-inverse text-on-inverse' : 'border border-line-strong bg-surface'}`}
            >
              {tag.name}
            </button>
          );
        })}
      </div>
      <form onSubmit={create} className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor={`new-tag-${article.id}`}>
          New tag
        </label>
        <input
          id={`new-tag-${article.id}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New tag"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
        />
        <button className="rounded-lg bg-inverse px-3 text-xs font-semibold text-on-inverse">
          Add
        </button>
      </form>
    </div>
  );
}
