import { useEffect, useMemo, useState } from 'react';
import type { ArticleSummary, ReaderNavigation } from '../../shared/api';

type Selection = { kind: 'brew' | 'all' | 'today' | 'starred' | 'feed' | 'folder'; id?: number; title: string };
const emptyNavigation: ReaderNavigation = { counts: { all: 0, today: 0, starred: 0 }, folders: [], unfiled: [] };

async function getJson<T>(url: string): Promise<T> { const response = await fetch(url); if (!response.ok) throw new Error('Could not load your library'); return response.json() as Promise<T>; }

export function Reader() {
  const [navigation, setNavigation] = useState(emptyNavigation);
  const [selection, setSelection] = useState<Selection>({ kind: 'brew', title: 'The Brew' });
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { void getJson<ReaderNavigation>('/api/reader/navigation').then(setNavigation).catch((reason: Error) => setError(reason.message)); }, []);
  const articleUrl = useMemo(() => {
    if (selection.kind === 'brew') return null;
    const params = new URLSearchParams({ view: ['today', 'starred'].includes(selection.kind) ? selection.kind : 'all' });
    if (selection.kind === 'feed' && selection.id) params.set('feedId', String(selection.id));
    if (selection.kind === 'folder' && selection.id) params.set('folderId', String(selection.id));
    return `/api/articles?${params}`;
  }, [selection]);
  useEffect(() => { if (!articleUrl) return; let current = true; void getJson<ArticleSummary[]>(articleUrl).then((value) => { if (current) setArticles(value); }).catch((reason: Error) => setError(reason.message)); return () => { current = false; }; }, [articleUrl]);

  const choose = (next: Selection) => { setError(''); setSelection(next); };
  const itemClass = (active: boolean) => `flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${active ? 'bg-amber-50 font-semibold text-amber-950' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'}`;
  return <div className="grid min-h-[calc(100vh-4rem)] grid-cols-[15.5rem_minmax(0,1fr)]">
    <aside aria-label="Reader navigation" className="border-r border-stone-200 bg-stone-50 px-4 py-6"><nav className="space-y-1"><button className={itemClass(selection.kind === 'brew')} onClick={() => choose({ kind: 'brew', title: 'The Brew' })}><span>☕ The Brew</span></button><button className={itemClass(selection.kind === 'today')} onClick={() => choose({ kind: 'today', title: 'Today' })}><span>Today</span><Count value={navigation.counts.today}/></button><button className={itemClass(selection.kind === 'all')} onClick={() => choose({ kind: 'all', title: 'All articles' })}><span>All</span><Count value={navigation.counts.all}/></button><button className={itemClass(selection.kind === 'starred')} onClick={() => choose({ kind: 'starred', title: 'Starred' })}><span>Starred</span><Count value={navigation.counts.starred}/></button></nav><div className="my-5 h-px bg-stone-200"/><div className="space-y-4">{navigation.folders.map((folder) => <section key={folder.id}><button onClick={() => choose({ kind: 'folder', id: folder.id, title: folder.title })} className="flex w-full items-center justify-between px-3 py-1 text-xs font-semibold uppercase tracking-wider text-stone-500"><span>{folder.title}</span><Count value={folder.unreadCount}/></button><div className="mt-1 space-y-0.5">{folder.feeds.map((feed) => <button key={feed.id} className={itemClass(selection.kind === 'feed' && selection.id === feed.id)} onClick={() => choose({ kind: 'feed', id: feed.id, title: feed.title })}><span className="truncate">{feed.title}</span><Count value={feed.unreadCount}/></button>)}</div></section>)}{navigation.unfiled.length > 0 && <section><p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-stone-400">Unfiled</p>{navigation.unfiled.map((feed) => <button key={feed.id} className={itemClass(selection.kind === 'feed' && selection.id === feed.id)} onClick={() => choose({ kind: 'feed', id: feed.id, title: feed.title })}><span className="truncate">{feed.title}</span><Count value={feed.unreadCount}/></button>)}</section>}</div></aside>
    <section className="min-w-0 bg-white"><header className="border-b border-stone-200 px-10 py-7"><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-700">Reader</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{selection.title}</h1></header>{error ? <p role="alert" className="m-10 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : selection.kind === 'brew' ? <BrewWelcome/> : <ArticleList articles={articles} grouped={selection.kind === 'today'}/>}</section>
  </div>;
}

function Count({ value }: { value: number }) { return value > 0 ? <span className="ml-2 text-xs tabular-nums text-stone-400">{value}</span> : null; }
function BrewWelcome() { return <div className="mx-auto max-w-2xl px-10 py-20 text-center"><p className="text-xs font-semibold uppercase tracking-[.24em] text-amber-700">Your morning paper</p><h2 className="mt-3 text-4xl font-semibold tracking-tight">A calmer way to catch up.</h2><p className="mx-auto mt-4 max-w-md text-stone-500">Your frozen daily Brew will appear here. Until then, Today gathers the last 24 hours.</p></div>; }
function ArticleList({ articles, grouped }: { articles: ArticleSummary[]; grouped: boolean }) {
  if (!articles.length) return <p className="px-10 py-20 text-center text-sm text-stone-500">Nothing here yet. A quiet inbox is a good inbox.</p>;
  const groups = grouped ? articles.reduce<Map<string, ArticleSummary[]>>((result, article) => { const name = article.folderTitle ?? 'Unfiled'; result.set(name, [...(result.get(name) ?? []), article]); return result; }, new Map()) : new Map<string, ArticleSummary[]>([['', articles]]);
  return <div className="mx-auto max-w-4xl px-10 py-6">{[...groups].map(([name, items]) => <section key={name} className="mb-8">{name && <h2 className="mb-2 border-b border-stone-200 pb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">{name}</h2>}{items.map((article) => <article key={article.id} className={`border-b border-stone-100 py-5 ${article.readAt ? 'opacity-55' : ''}`}><div className="flex items-center gap-2 text-xs text-stone-500"><span>{article.feedTitle}</span><span>·</span><time>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(article.publishedAt))}</time>{article.starredAt && <span aria-label="Starred" className="text-amber-600">★</span>}</div><h3 className="mt-1 text-lg font-semibold tracking-tight">{article.title}</h3>{article.author && <p className="mt-1 text-xs text-stone-500">By {article.author}</p>}</article>)}</section>)}</div>;
}
