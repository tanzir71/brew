import { useWebMcpSurface } from './webmcp/useWebMcpSurface';
import { useReaderSyncEvents } from './hooks/useReaderSyncEvents';
import { agentPageHref } from './agentLocation';
import { ReaderHelp } from './components/ReaderHelp';
import { Button, Wordmark } from './components/controls';
import { AgentMode } from './components/AgentMode';
import { WebMcpProvider } from './webmcp/WebMcpProvider';
import { FeedManager } from './FeedManager';
import { Component, type ReactNode, lazy, Suspense, useEffect, useRef, useState } from 'react';
const Reader = lazy(() => import('./Reader').then((module) => ({ default: module.Reader })));
import { RulesPage } from './RulesPage';
import { BrewPage } from './BrewPage';
import { initialBrowserPreferences, useBrowserPreferences } from './hooks/useBrowserPreferences';
import { GeneralPreferences, PreferenceFeedback } from './settings/BrowserPreferences';
import { articleRouteId } from './articleRoute';
import { closeSearchHref, isReaderLocation, navigateReader, searchHref } from './readerLocation';
const WhereBrewRuns = lazy(() =>
  import('./settings/WhereBrewRuns').then((module) => ({ default: module.WhereBrewRuns })),
);
const AgentAccess = lazy(() =>
  import('./settings/AgentAccess').then((module) => ({ default: module.AgentAccess })),
);
const AppsSync = lazy(() =>
  import('./settings/AppsSync').then((module) => ({ default: module.AppsSync })),
);
const NewslettersPage = lazy(() =>
  import('./NewslettersPage').then((module) => ({ default: module.NewslettersPage })),
);

export function App() {
  return (
    <ErrorBoundary>
      <AgentMode>
        <WebMcpProvider>
          <AppContent />
        </WebMcpProvider>
      </AgentMode>
    </ErrorBoundary>
  );
}
function AppContent() {
  useReaderSyncEvents();
  const [mode, setMode] = useState<'brew' | 'reader' | 'feeds' | 'rules'>(() => {
    if (/^\/rules(?:\/[1-9]\d*)?$/.test(location.pathname)) return 'rules';
    if (location.pathname === '/feeds') return 'feeds';
    if (location.pathname === '/reader') return 'reader';
    if (articleRouteId(location.pathname) !== null || isReaderLocation()) return 'reader';
    if (location.pathname.startsWith('/b/')) return 'brew';
    const view = new URLSearchParams(location.search).get('view');
    return view === 'brew' || view === 'reader' || view === 'feeds' || view === 'rules'
      ? view
      : initialBrowserPreferences().landing;
  });
  const [searchDraft, setSearchDraft] = useState(
    () => new URLSearchParams(location.search).get('q') ?? '',
  );
  const [searchQuery, setSearchQuery] = useState(
    () => new URLSearchParams(location.search).get('q')?.trim() ?? '',
  );
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
      setSearchDraft(q);
      setSearchQuery(q.trim());
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  const isAgents = location.pathname === '/settings/agents';
  const isApps = location.pathname === '/settings/apps';
  const isRuns = location.pathname === '/settings/runs' || isAgents || isApps;
  const isLetters = /^\/letters(?:\/|$)/.test(location.pathname);
  const globalSearch = useRef<HTMLInputElement>(null);
  useWebMcpSurface(
    globalSearch,
    { names: ['search_items'] },
    !isRuns && !isLetters && mode === 'feeds',
  );
  const preferences = useBrowserPreferences();
  const { theme } = preferences.values;
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
  useEffect(() => {
    document.title = `${isLetters ? 'Newsletters' : isApps ? 'Apps & sync' : isAgents ? 'Agent access' : isRuns ? 'Where Brew runs' : mode === 'brew' ? 'The Brew' : mode === 'reader' ? 'Reader' : mode === 'rules' ? 'Rules' : 'Feeds'} · Brew`;
  }, [mode, isRuns, isAgents, isApps, isLetters]);
  if (isLetters)
    return (
      <Suspense
        fallback={
          <main role="status" className="p-8">
            Loading newsletters…
          </main>
        }
      >
        <NewslettersPage />
      </Suspense>
    );
  if (isRuns)
    return (
      <Suspense
        fallback={
          <main role="status" className="p-8">
            Loading settings…
          </main>
        }
      >
        {isApps ? <AppsSync /> : isAgents ? <AgentAccess /> : <WhereBrewRuns />}
      </Suspense>
    );
  if (mode === 'brew') return <BrewPage preferences={<GeneralPreferences />} />;
  if (mode === 'rules')
    return (
      <>
        <RulesPage />
        <ReaderHelp reader={false} />
      </>
    );
  if (mode === 'reader')
    return (
      <>
        <Suspense fallback={<main role="status">Loading library…</main>}>
          <Reader
            searchQuery={searchQuery}
            onClearSearch={() => navigateReader(closeSearchHref())}
          />
        </Suspense>
        <ReaderHelp reader />
      </>
    );
  return (
    <main
      aria-label="Manage feeds"
      data-brew-view="feeds"
      className="min-h-screen bg-canvas text-ink"
    >
      <nav
        aria-label="Library"
        className="flex h-16 items-center justify-between border-b border-line px-8"
      >
        <a href={agentPageHref('/')} aria-label="Brew home">
          <Wordmark />
        </a>
        <div className="flex items-center gap-3">
          <label className="sr-only" htmlFor="global-search">
            Search library
          </label>
          <input
            ref={globalSearch}
            id="global-search"
            data-brew-action="search-library"
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter')
                navigateReader(
                  searchDraft.trim() ? searchHref(searchDraft.trim()) : closeSearchHref(),
                );
            }}
            placeholder="Search  /"
            className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
          />
          <a className="brew-compact-control" href={agentPageHref('/?view=reader&scope=all')}>
            Reader
          </a>
          <a className="brew-compact-control" href={agentPageHref('/rules')}>
            Rules
          </a>
          <a className="brew-compact-control" href={agentPageHref('/settings/runs')}>
            Settings
          </a>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => window.dispatchEvent(new Event('brew:show-shortcuts'))}
          >
            Keyboard shortcuts
          </Button>
          <GeneralPreferences />
        </div>
      </nav>
      <PreferenceFeedback preferences={preferences} name="General preferences result" />
      <FeedManager />
      <ReaderHelp reader={false} />
    </main>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="grid min-h-screen place-items-center bg-canvas p-8 text-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-soft">Brew</p>
          <h1 className="mt-2 text-3xl font-semibold">Something went wrong.</h1>
          <p className="mt-2 text-soft">Your local data is safe. Reload to try again.</p>
          <button
            onClick={() => location.reload()}
            className="mt-6 rounded-full bg-inverse px-5 py-2 text-on-inverse"
          >
            Reload Brew
          </button>
        </div>
      </main>
    ) : (
      this.props.children
    );
  }
}
