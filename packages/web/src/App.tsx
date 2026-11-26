import { ReaderHelp } from './components/ReaderHelp';
import { FeedManager } from './FeedManager';
import { Component, type ReactNode, lazy, Suspense, useEffect, useState } from 'react';
const Reader = lazy(() => import('./Reader').then((module) => ({ default: module.Reader })));
import { RulesPage } from './RulesPage';
import { BrewPage } from './BrewPage';
import { runAssets } from './components/figmaAssets';
import { initialBrowserPreferences, useBrowserPreferences } from './hooks/useBrowserPreferences';
import { GeneralPreferences, PreferenceFeedback } from './settings/BrowserPreferences';
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
    return view === 'brew' || view === 'reader' || view === 'feeds' || view === 'rules' ? view : initialBrowserPreferences().landing;
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
  const preferences = useBrowserPreferences();
  const { theme, images, landing } = preferences.values;
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
  if (mode === 'brew') return <BrewPage preferences={<GeneralPreferences />} />;
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
            data-brew-action="show-shortcuts"
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
            data-brew-action="set-theme"
            value={theme}
            onChange={(event) => {
              preferences.save('theme', event.target.value, 'Theme');
            }}
            className="rounded-full border border-line-strong bg-surface px-3 py-2 text-xs font-medium"
          >
            <option value="system">System theme</option>
            <option value="light">Light theme</option>
            <option value="dark">Dark theme</option>
          </select>
          <label className="sr-only" htmlFor="image-privacy">Image privacy</label>
          <select id="image-privacy" data-brew-action="set-image-privacy" value={images} onChange={(event)=>preferences.save('images', event.target.value, 'Image privacy')} className="rounded-full border border-line-strong bg-surface px-3 py-2 text-xs font-medium">
            <option value="proxy">Private images</option><option value="direct">Load images directly</option>
          </select>
          <label className="sr-only" htmlFor="landing-picker">Default landing page</label><select id="landing-picker" data-brew-action="set-landing" aria-label="Default landing page" value={landing} onChange={(event)=>preferences.save('landing', event.target.value, 'Default landing page')} className="rounded-full border border-line-strong bg-surface px-3 py-2 text-xs font-medium"><option value="brew">Start at Brew</option><option value="reader">Start at Reader</option></select>
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
      <PreferenceFeedback preferences={preferences} name="General preferences result" />
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
      <ReaderHelp reader={mode === 'reader'} />
    </main>
  );
}

class ErrorBoundary extends Component<{children:ReactNode},{error:boolean}>{state={error:false};static getDerivedStateFromError(){return{error:true}}render(){return this.state.error?<main className="grid min-h-screen place-items-center bg-canvas p-8 text-center"><div><p className="text-xs font-semibold uppercase tracking-wider text-soft">Brew</p><h1 className="mt-2 text-3xl font-semibold">Something went wrong.</h1><p className="mt-2 text-soft">Your local data is safe. Reload to try again.</p><button onClick={()=>location.reload()} className="mt-6 rounded-full bg-inverse px-5 py-2 text-on-inverse">Reload Brew</button></div></main>:this.props.children}}
