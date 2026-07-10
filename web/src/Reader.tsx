import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArticlePage, ArticleSummary, ReaderNavigation } from '../../shared/api';

type Selection = { kind: 'brew' | 'all' | 'today' | 'starred' | 'feed' | 'folder'; id?: number; title: string };
const emptyNavigation: ReaderNavigation = { counts: { all: 0, today: 0, starred: 0 }, folders: [], unfiled: [] };

async function getJson<T>(url: string): Promise<T> { const response = await fetch(url); if (!response.ok) throw new Error('Could not load your library'); return response.json() as Promise<T>; }

export function Reader() {
  const [navigation, setNavigation] = useState(emptyNavigation);
  const [selection, setSelection] = useState<Selection>({ kind: 'brew', title: 'The Brew' });
  const [error, setError] = useState('');
  useEffect(() => { void getJson<ReaderNavigation>('/api/reader/navigation').then(setNavigation).catch((reason: Error) => setError(reason.message)); }, []);
  const choose = (next: Selection) => { setError(''); setSelection(next); };
  const itemClass = (active: boolean) => `flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${active ? 'bg-amber-50 font-semibold text-amber-950' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'}`;
  return <div className="grid min-h-[calc(100vh-4rem)] grid-cols-[15.5rem_minmax(0,1fr)]">
    <aside aria-label="Reader navigation" className="border-r border-stone-200 bg-stone-50 px-4 py-6"><nav className="space-y-1"><button className={itemClass(selection.kind === 'brew')} onClick={() => choose({ kind: 'brew', title: 'The Brew' })}><span>☕ The Brew</span></button><button className={itemClass(selection.kind === 'today')} onClick={() => choose({ kind: 'today', title: 'Today' })}><span>Today</span><Count value={navigation.counts.today}/></button><button className={itemClass(selection.kind === 'all')} onClick={() => choose({ kind: 'all', title: 'All articles' })}><span>All</span><Count value={navigation.counts.all}/></button><button className={itemClass(selection.kind === 'starred')} onClick={() => choose({ kind: 'starred', title: 'Starred' })}><span>Starred</span><Count value={navigation.counts.starred}/></button></nav><div className="my-5 h-px bg-stone-200"/><div className="space-y-4">{navigation.folders.map((folder) => <section key={folder.id}><button onClick={() => choose({ kind: 'folder', id: folder.id, title: folder.title })} className="flex w-full items-center justify-between px-3 py-1 text-xs font-semibold uppercase tracking-wider text-stone-500"><span>{folder.title}</span><Count value={folder.unreadCount}/></button><div className="mt-1 space-y-0.5">{folder.feeds.map((feed) => <button key={feed.id} className={itemClass(selection.kind === 'feed' && selection.id === feed.id)} onClick={() => choose({ kind: 'feed', id: feed.id, title: feed.title })}><span className="truncate">{feed.title}</span><Count value={feed.unreadCount}/></button>)}</div></section>)}{navigation.unfiled.length > 0 && <section><p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-stone-400">Unfiled</p>{navigation.unfiled.map((feed) => <button key={feed.id} className={itemClass(selection.kind === 'feed' && selection.id === feed.id)} onClick={() => choose({ kind: 'feed', id: feed.id, title: feed.title })}><span className="truncate">{feed.title}</span><Count value={feed.unreadCount}/></button>)}</section>}</div></aside>
    <section className="min-w-0 bg-white">{error ? <p role="alert" className="m-10 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : selection.kind === 'brew' ? <><header className="border-b border-stone-200 px-10 py-7"><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-700">Reader</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{selection.title}</h1></header><BrewWelcome/></> : <ArticleList selection={selection}/>}</section>
  </div>;
}

function Count({ value }: { value: number }) { return value > 0 ? <span className="ml-2 text-xs tabular-nums text-stone-400">{value}</span> : null; }
function BrewWelcome() { return <div className="mx-auto max-w-2xl px-10 py-20 text-center"><p className="text-xs font-semibold uppercase tracking-[.24em] text-amber-700">Your morning paper</p><h2 className="mt-3 text-4xl font-semibold tracking-tight">A calmer way to catch up.</h2><p className="mx-auto mt-4 max-w-md text-stone-500">Your frozen daily Brew will appear here. Until then, Today gathers the last 24 hours.</p></div>; }
type Density = 'title' | 'magazine' | 'cards';
type VirtualRow = { kind: 'article'; article: ArticleSummary } | { kind: 'header'; title: string };

function ArticleList({ selection }: { selection: Selection }) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [densityByScope, setDensityByScope] = useState<Record<string, Density>>({});
  const scope = `${selection.kind}:${selection.id ?? 'root'}`;
  const storedDensity = typeof localStorage === 'undefined' ? null : localStorage.getItem(`brew:density:${scope}`);
  const density = densityByScope[scope] ?? (storedDensity === 'title' || storedDensity === 'magazine' || storedDensity === 'cards' ? storedDensity : 'magazine');
  const query = useInfiniteQuery({
    queryKey: ['articles', selection.kind, selection.id, unreadOnly, sort], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => { const params = new URLSearchParams({ view: ['today', 'starred'].includes(selection.kind) ? selection.kind : 'all', unread: String(unreadOnly), sort, limit: '50' }); if (selection.kind === 'feed' && selection.id) params.set('feedId', String(selection.id)); if (selection.kind === 'folder' && selection.id) params.set('folderId', String(selection.id)); if (pageParam) params.set('cursor', pageParam); return getJson<ArticlePage>(`/api/articles?${params}`); },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const articles = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  const rows = useMemo<VirtualRow[]>(() => {
    if (selection.kind !== 'today') return articles.map((article) => ({ kind: 'article', article }));
    const groups = articles.reduce<Map<string, ArticleSummary[]>>((result, article) => { const name = article.folderTitle ?? 'Unfiled'; result.set(name, [...(result.get(name) ?? []), article]); return result; }, new Map());
    return [...groups].flatMap(([title, items]) => [{ kind: 'header' as const, title }, ...items.map((article) => ({ kind: 'article' as const, article }))]);
  }, [articles, selection.kind]);
  const parent = useRef<HTMLDivElement>(null);
  const lanes = density === 'cards' && selection.kind !== 'today' ? 2 : 1;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is the mandated list engine and intentionally manages mutable measurements.
  const virtualizer = useVirtualizer({ count: rows.length + (query.hasNextPage ? 1 : 0), getScrollElement: () => parent.current, estimateSize: () => density === 'title' ? 62 : density === 'cards' ? 270 : 126, overscan: 8, lanes, gap: density === 'cards' ? 12 : 0 });
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => { const last = virtualItems.at(-1); if (last && last.index >= rows.length - 4 && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage(); }, [virtualItems, rows.length, query]);
  const chooseDensity = (next: Density) => { localStorage.setItem(`brew:density:${scope}`, next); setDensityByScope((current) => ({ ...current, [scope]: next })); };

  return <div className="flex h-[calc(100vh-4rem)] flex-col"><header className="flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 px-8 py-5"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-700">Reader</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{selection.title}</h1></div><div className="flex flex-wrap items-center gap-2"><div className="flex rounded-lg bg-stone-100 p-1" aria-label="Article filter"><button onClick={() => setUnreadOnly(false)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${!unreadOnly ? 'bg-white shadow-sm' : 'text-stone-500'}`}>All</button><button onClick={() => setUnreadOnly(true)} className={`rounded-md px-3 py-1.5 text-xs font-medium ${unreadOnly ? 'bg-white shadow-sm' : 'text-stone-500'}`}>Unread</button></div><select aria-label="Sort articles" value={sort} onChange={(event) => setSort(event.target.value as 'newest' | 'oldest')} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select><div className="flex rounded-lg border border-stone-300 bg-white p-0.5" aria-label="View density">{(['title', 'magazine', 'cards'] as const).map((value) => <button key={value} title={`${value} view`} aria-label={`${value} view`} aria-pressed={density === value} onClick={() => chooseDensity(value)} className={`rounded-md px-2.5 py-1.5 text-xs capitalize ${density === value ? 'bg-stone-900 text-white' : 'text-stone-500'}`}>{value === 'title' ? '☰' : value === 'magazine' ? '▤' : '▦'}</button>)}</div></div></header><div ref={parent} data-testid="virtual-article-list" className="min-h-0 flex-1 overflow-auto"><div className="relative mx-auto max-w-5xl px-8" style={{ height: virtualizer.getTotalSize() }}>{virtualItems.map((item) => { const row = rows[item.index]; const laneWidth = 100 / lanes; return <div key={item.key} ref={virtualizer.measureElement} data-index={item.index} className="absolute top-0 py-1" style={{ transform: `translateY(${item.start}px)`, left: lanes > 1 ? `calc(${item.lane * laneWidth}% + 1rem)` : '2rem', width: lanes > 1 ? `calc(${laneWidth}% - 1.5rem)` : 'calc(100% - 4rem)' }}>{row ? row.kind === 'header' ? <h2 className="border-b border-stone-200 py-3 text-xs font-semibold uppercase tracking-wider text-stone-400">{row.title}</h2> : <ArticleRow article={row.article} density={density}/> : <p className="py-6 text-center text-xs text-stone-400">Loading more…</p>}</div>; })}</div>{!query.isLoading && rows.length === 0 && <p className="px-10 py-20 text-center text-sm text-stone-500">Nothing here yet. A quiet inbox is a good inbox.</p>}</div></div>;
}

function ArticleRow({ article, density }: { article: ArticleSummary; density: Density }) {
  const meta = <div className="flex items-center gap-2 text-xs text-stone-500"><span>{article.feedTitle}</span><span>·</span><time>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(article.publishedAt))}</time>{article.starredAt && <span aria-label="Starred" className="text-amber-600">★</span>}</div>;
  if (density === 'title') return <article className={`flex min-h-14 items-center justify-between border-b border-stone-100 bg-white py-3 ${article.readAt ? 'opacity-50' : ''}`}><h3 className="truncate pr-4 text-sm font-semibold">{article.title}</h3>{meta}</article>;
  if (density === 'cards') return <article className={`h-[258px] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm ${article.readAt ? 'opacity-55' : ''}`}>{article.imageUrl ? <img src={article.imageUrl} alt="" loading="lazy" className="h-28 w-full object-cover"/> : <div className="h-28 bg-gradient-to-br from-amber-50 to-stone-100"/>}<div className="p-4">{meta}<h3 className="mt-2 line-clamp-2 text-lg font-semibold leading-snug tracking-tight">{article.title}</h3>{article.summaryHtml && <div className="mt-2 line-clamp-2 text-sm text-stone-500" dangerouslySetInnerHTML={{ __html: article.summaryHtml }}/>}</div></article>;
  return <article className={`flex min-h-[116px] gap-5 border-b border-stone-100 bg-white py-4 ${article.readAt ? 'opacity-55' : ''}`}><div className="min-w-0 flex-1">{meta}<h3 className="mt-1 text-lg font-semibold tracking-tight">{article.title}</h3>{article.summaryHtml && <div className="mt-1 line-clamp-2 text-sm text-stone-500" dangerouslySetInnerHTML={{ __html: article.summaryHtml }}/>}</div>{article.imageUrl && <img src={article.imageUrl} alt="" loading="lazy" className="h-20 w-28 shrink-0 rounded-lg object-cover"/>}</article>;
}
