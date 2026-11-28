import './environment';
import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FirstRun } from '../../../packages/web/src/settings/FirstRun';
import { IconSprite } from '../../../packages/web/src/components/Icon';
import { Button, Wordmark } from '../../../packages/web/src/components/controls';
import { initialBrowserPreferences } from '../../../packages/web/src/hooks/useBrowserPreferences';
import { openBrowserLibrary, type BrowserLibrary } from '../src/index';
import type { BrowserStart } from '../src/start';
import { connectBrowserHttp } from './bridge';
import { navigationLinks } from '../../../packages/web/src/navigationHref';
import {
  browserBase,
  browserHref,
  browserHistory,
  browserLocation,
  localNavigation,
  publishBrowserEvent,
} from './environment';
import '../../../packages/web/src/styles.css';
import '../../../packages/web/src/styles/first-run.css';

navigationLinks.href = browserHref;

const preferences = initialBrowserPreferences();
const resolved =
  preferences.theme === 'system'
    ? matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    : preferences.theme;
document.documentElement.dataset.resolvedTheme = resolved;
document.documentElement.dataset.theme = preferences.theme;
const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } });
let appModule: Promise<{ default: typeof import('../../../packages/web/src/App').App }> | undefined;
const loadApp = () =>
  (appModule ??= import('../../../packages/web/src/App')
    .then((module) => ({ default: module.App }))
    .catch((error) => {
      appModule = undefined;
      throw error;
    }));
export const App = lazy(loadApp);
let library: BrowserLibrary | undefined;
let disconnect: (() => void) | undefined;
let opening: Promise<BrowserLibrary> | undefined;
async function open() {
  return (opening ??= (async () => {
    const current = await openBrowserLibrary({
      assetBase: browserBase.href,
      webmcp: import.meta.env.VITE_BREW_WEBMCP === '1',
      onCycle: (result) => {
        if (result.results.some((result) => result.newItems > 0)) {
          publishBrowserEvent('article:new', result);
          void client.invalidateQueries();
        }
      },
      notifications: { notify: (article) => publishBrowserEvent('notification', article) },
      onError: (message) =>
        window.dispatchEvent(new CustomEvent('brew:runtime-error', { detail: message })),
    });
    performance.mark('brew:library-open');
    try {
      disconnect = await connectBrowserHttp(current, browserBase);
      performance.mark('brew:connection-ready');
      library = current;
      return current;
    } catch (error) {
      await current.close();
      throw error;
    }
  })().catch((error) => {
    opening = undefined;
    throw error;
  }));
}
async function startStatus(current: BrowserLibrary) {
  const response = await current.fetch('/api/browser/start');
  performance.mark('brew:start-status');
  if (!response.ok) throw new Error('Could not open the saved library.');
  return response.json() as Promise<BrowserStart>;
}
function enter(result: BrowserStart, first: boolean) {
  if (first || browserLocation.pathname === '/') {
    const landing = first ? 'brew' : initialBrowserPreferences().landing;
    browserHistory.replaceState(
      null,
      '',
      landing === 'brew'
        ? result.configId
          ? result.issueId
            ? `/b/${result.configId}/${result.issueId}`
            : `/b/${result.configId}`
          : '/'
        : `/${landing}`,
    );
  }
}
export function BrowserRoot() {
  const [phase, setPhase] = useState<'opening' | 'first-run' | 'app' | 'error'>('opening');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [, renderRoute] = useState(0);
  const connect = useCallback(async () => {
    const current = await open();
    const status = await startStatus(current);
    if (status.ready) {
      await loadApp();
      enter(status, false);
    }
    return status;
  }, []);
  const connected = useCallback((status: BrowserStart) => {
    setError('');
    setPhase(status.ready ? 'app' : 'first-run');
  }, []);
  const failed = useCallback((error: unknown) => {
    setError(error instanceof Error ? error.message : 'Could not open this browser’s library.');
    setPhase('error');
  }, []);
  useEffect(() => {
    void connect().then(connected, failed);
  }, [connect, connected, failed]);
  useEffect(() => {
    const restore = () => renderRoute((value) => value + 1);
    const failure = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener('popstate', restore);
    window.addEventListener('brew:runtime-error', failure);
    document.addEventListener('click', localNavigation);
    return () => {
      window.removeEventListener('popstate', restore);
      window.removeEventListener('brew:runtime-error', failure);
      document.removeEventListener('click', localNavigation);
    };
  }, []);
  const start = async () => {
    setStarting(true);
    setError('');
    try {
      const [result] = await Promise.all([
        (async () => {
          const current = await open();
          const response = await current.fetch('/api/browser/start', { method: 'POST' });
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error ?? result.message ?? 'Could not create your first Brew.');
          return result;
        })(),
        loadApp(),
      ]);
      enter(result, true);
      await client.invalidateQueries();
      setPhase('app');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not start Brew.');
    } finally {
      setStarting(false);
    }
  };
  if (phase === 'opening' || phase === 'error')
    return (
      <main className="first-run">
        <Wordmark />
        {phase === 'opening' ? (
          <p className="first-run-feedback" role="status">
            Opening your library…
          </p>
        ) : (
          <div className="first-run-feedback" role="alert">
            <p>{error}</p>
            <Button
              onClick={() => {
                setPhase('opening');
                setError('');
                void connect().then(connected, failed);
              }}
            >
              Try again
            </Button>
          </div>
        )}
      </main>
    );
  if (phase === 'first-run')
    return (
      <FirstRun
        onStart={() => void start()}
        starting={starting}
        error={error}
        onRetry={() => void start()}
      />
    );
  const view =
    browserLocation.pathname.match(/^\/(letters|settings|rules|feeds)/)?.[1] ?? 'library';
  return (
    <>
      <Suspense fallback={<main role="status">Opening your Brew…</main>}>
        <App key={view} />
      </Suspense>
      {error && (
        <p className="reader-offline" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
window.addEventListener('pagehide', () => {
  disconnect?.();
  void library?.close();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
createRoot(document.getElementById('root')!).render(
  <>
    <IconSprite />
    <QueryClientProvider client={client}>
      <BrowserRoot />
    </QueryClientProvider>
  </>,
);
