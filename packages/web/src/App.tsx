import { FeedManager } from './FeedManager';
import { Component, type ReactNode, lazy, Suspense, useEffect, useState } from 'react';
const Reader = lazy(() => import('./Reader').then((module) => ({ default: module.Reader })));
import { RulesPage } from './RulesPage';
import { BrewPage } from './BrewPage';
import { runAssets } from './components/figmaAssets';
import { articleRouteId } from './articleRoute';
import { closeSearchHref, isReaderLocation, navigateReader, searchHref } from './readerLocation';
const WhereBrewRuns = lazy(() => import('./settings/WhereBrewRuns').then((module) => ({ default: module.WhereBrewRuns })));
const NewslettersPage = lazy(() => import('./NewslettersPage').then((module) => ({ default: module.NewslettersPage })));

export function App() {
  return <ErrorBoundary><AppContent /></ErrorBoundary>;
}
function AppContent() {
  const [mode, setMode] = useState<'brew' | 'reader' | 'feeds' | 'rules'>(()=>{
    if (/^\/rules(?:\/[1-9]\d*)?$/.test(location.pathname)) return 'rules';
    if (location.pathname === '/feeds') return 'feeds';
    if (location.pathname === '/reader') return 'reader';
    if (articleRouteId(location.pathname) !== null || isReaderLocation()) return 'reader';
    if (location.pathname.startsWith('/b/')) return 'brew';
    const view = new URLSearchParams(location.search).get('view');
    return view === 'brew' || view === 'reader' || view === 'feeds' || view === 'rules' ? view : localStorage.getItem('brew:landing')==='reader'?'reader':'brew';
  });
  const [searchDraft, setSearchDraft] = useState(() => new URLSearchParams(location.search).get('q') ?? '');
  const [searchQuery, setSearchQuery] = useState(() => new URLSearchParams(location.search).get('q')?.trim() ?? '');
  useEffect(() => {
    const restore = () => {
      const view = new URLSearchParams(location.search).get('view');
      if (isReaderLocation() || view === 'reader') setMode('reader');
      else if (/^\/rules(?:\/[1-9]\d*)?$/.test(location.pathname)) setMode('rules');
      else if (location.pathname === '/feeds') setMode('feeds');
      else if (location.pathname === '/reader') setMode('reader');
      else if (view === 'rules' || view === 'feeds' || view === 'brew') setMode(view);
      else if (location.pathname.startsWith('/b/')) setMode('brew');
      const q = new URLSearchParams(location.search).get('q') ?? '';
      setSearchDraft(q); setSearchQuery(q.trim());
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  const isRuns = location.pathname === '/settings/runs';
  const isLetters = /^\/letters(?:\/|$)/.test(location.pathname);
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    const saved = localStorage.getItem('brew:theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const [directImages,setDirectImages]=useState(()=>localStorage.getItem('brew:direct-images')==='true');
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.resolvedTheme = resolved;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => { document.title = `${isLetters ? 'Newsletters' : isRuns ? 'Where Brew runs' : mode === 'brew' ? 'The Brew' : mode === 'reader' ? 'Reader' : mode === 'rules' ? 'Rules' : 'Feeds'} · Brew`; }, [mode, isRuns, isLetters]);
  if (isLetters) return <Suspense fallback={<main role="status" className="p-8">Loading newsletters…</main>}><NewslettersPage /></Suspense>;
  if (isRuns) return <Suspense fallback={<main role="status" className="p-8">Loading settings…</main>}><WhereBrewRuns /></Suspense>;
  if (mode === 'brew') return <BrewPage preferences={<>
    <label>Theme<select aria-label="Theme" value={theme} onChange={(event)=>{const value=event.target.value as 'system'|'light'|'dark';setTheme(value);localStorage.setItem('brew:theme',value)}}><option value="system">System theme</option><option value="light">Light theme</option><option value="dark">Dark theme</option></select></label>
    <label>Image privacy<select value={directImages?'direct':'proxy'} onChange={(event)=>{const value=event.target.value==='direct';setDirectImages(value);localStorage.setItem('brew:direct-images',String(value))}}><option value="proxy">Private images</option><option value="direct">Load images directly</option></select></label>
    <label>Default landing page<select value={localStorage.getItem('brew:landing')??'brew'} onChange={(event)=>{localStorage.setItem('brew:landing',event.target.value);if(event.target.value==='reader')setMode('reader')}}><option value="brew">Start at Brew</option><option value="reader">Start at Reader</option></select></label>
  </>} />;
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="flex h-16 items-center justify-between border-b border-line px-8">
        <div className="flex items-center gap-3"><a href="/" aria-label="Brew home" className="font-semibold tracking-tight">
          Brew
        </a><a href="/settings/runs" className="legacy-settings-link" aria-label="Settings · Where Brew runs"><img src={runAssets.settings} alt="" /></a></div>
        <div className="flex items-center gap-3">
          <label className="sr-only" htmlFor="global-search">
            Search
          </label>
          <input
            id="global-search"
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                navigateReader(searchDraft.trim() ? searchHref(searchDraft.trim()) : closeSearchHref());
                setMode('reader');
              }
              if (event.key === 'Escape') {
                setSearchDraft('');
                setSearchQuery('');
                if (location.pathname === '/search') navigateReader(closeSearchHref());
                event.currentTarget.blur();
              }
            }}
            placeholder="Search  /"
            className="w-36 rounded-full border border-line-strong bg-surface px-4 py-2 text-xs outline-none focus:w-56 focus:border-ink"
          />
          <a
            href={mode === 'reader' ? '/' : '/?view=reader&scope=all'}
            className="rounded-full border border-line-strong px-4 py-2 text-sm font-medium"
          >
            {mode === 'reader' ? 'The Brew' : 'Reader'}
          </a>
          <button
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            onClick={() => window.dispatchEvent(new Event('brew:show-shortcuts'))}
            className="grid h-9 w-9 place-items-center rounded-full border border-line-strong text-sm font-semibold"
          >
            ?
          </button>
          <label className="sr-only" htmlFor="theme-picker">
            Theme
          </label>
          <select
            id="theme-picker"
            value={theme}
            onChange={(event) => {
              const next = event.target.value as 'system' | 'light' | 'dark';
              setTheme(next);
              localStorage.setItem('brew:theme', next);
            }}
            className="rounded-full border border-line-strong bg-surface px-3 py-2 text-xs font-medium"
          >
            <option value="system">System theme</option>
            <option value="light">Light theme</option>
            <option value="dark">Dark theme</option>
          </select>
          <label className="sr-only" htmlFor="image-privacy">Image privacy</label>
          <select id="image-privacy" value={directImages?'direct':'proxy'} onChange={(event)=>{const direct=event.target.value==='direct';setDirectImages(direct);localStorage.setItem('brew:direct-images',String(direct))}} className="rounded-full border border-line-strong bg-surface px-3 py-2 text-xs font-medium">
            <option value="proxy">Private images</option><option value="direct">Load images directly</option>
          </select>
          <label className="sr-only" htmlFor="landing-picker">Default landing page</label><select id="landing-picker" aria-label="Default landing page" value={localStorage.getItem('brew:landing')??'brew'} onChange={(event)=>{localStorage.setItem('brew:landing',event.target.value);setMode(event.target.value as 'brew'|'reader')}} className="rounded-full border border-line-strong bg-surface px-3 py-2 text-xs font-medium"><option value="brew">Start at Brew</option><option value="reader">Start at Reader</option></select>
          <a
            href={mode === 'rules' ? '/' : '/?view=rules'}
            className="rounded-full border border-line-strong px-4 py-2 text-sm font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {mode === 'rules' ? 'Back to Brew' : 'Rules'}
          </a>
          <a
            href={mode === 'feeds' ? '/' : '/?view=feeds'}
            className="rounded-full border border-line-strong px-4 py-2 text-sm font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {mode === 'feeds' ? 'Back to Brew' : 'Manage feeds'}
          </a>
        </div>
      </header>
      {mode === 'feeds' ? (
        <FeedManager />
      ) : mode === 'rules' ? (
        <RulesPage />
      ) : (
        <Suspense fallback={<div role="status" className="p-8">Loading library…</div>}><Reader
          searchQuery={searchQuery}
          onClearSearch={() => navigateReader(closeSearchHref())}
        /></Suspense>
      )}
    </main>
  );
}

class ErrorBoundary extends Component<{children:ReactNode},{error:boolean}>{state={error:false};static getDerivedStateFromError(){return{error:true}}render(){return this.state.error?<main className="grid min-h-screen place-items-center bg-canvas p-8 text-center"><div><p className="text-xs font-semibold uppercase tracking-wider text-soft">Brew</p><h1 className="mt-2 text-3xl font-semibold">Something went wrong.</h1><p className="mt-2 text-soft">Your local data is safe. Reload to try again.</p><button onClick={()=>location.reload()} className="mt-6 rounded-full bg-inverse px-5 py-2 text-on-inverse">Reload Brew</button></div></main>:this.props.children}}
