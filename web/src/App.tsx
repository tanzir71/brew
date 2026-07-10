import { Component, type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import type { FeedCandidate, FeedSummary, FolderSummary } from '../../shared/api';
import { Reader } from './Reader';
import { RulesPage } from './RulesPage';
import { BrewPage } from './BrewPage';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string;
    };
    throw new Error(body.error || 'Request failed');
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

export function App() {
  return <ErrorBoundary><AppContent /></ErrorBoundary>;
}
function AppContent() {
  const [mode, setMode] = useState<'brew' | 'reader' | 'feeds' | 'rules'>('brew');
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
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
  useEffect(() => { document.title = `${mode === 'brew' ? 'The Brew' : mode === 'reader' ? 'Reader' : mode === 'rules' ? 'Rules' : 'Feeds'} · Brew`; }, [mode]);
  return (
    <main className="min-h-screen bg-stone-50 text-stone-900">
      <header className="flex h-16 items-center justify-between border-b border-stone-200 px-8">
        <button onClick={() => setMode('brew')} className="font-semibold tracking-tight">
          Brew
        </button>
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
                setSearchQuery(searchDraft.trim());
                setMode('reader');
              }
              if (event.key === 'Escape') {
                setSearchDraft('');
                setSearchQuery('');
                event.currentTarget.blur();
              }
            }}
            placeholder="Search  /"
            className="w-36 rounded-full border border-stone-300 bg-white px-4 py-2 text-xs outline-none focus:w-56 focus:border-amber-600"
          />
          <button
            onClick={() => setMode(mode === 'reader' ? 'brew' : 'reader')}
            className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium"
          >
            {mode === 'reader' ? 'The Brew' : 'Reader'}
          </button>
          <button
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            onClick={() => window.dispatchEvent(new Event('brew:show-shortcuts'))}
            className="grid h-9 w-9 place-items-center rounded-full border border-stone-300 text-sm font-semibold"
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
            className="rounded-full border border-stone-300 bg-white px-3 py-2 text-xs font-medium"
          >
            <option value="system">System theme</option>
            <option value="light">Light theme</option>
            <option value="dark">Dark theme</option>
          </select>
          <label className="sr-only" htmlFor="image-privacy">Image privacy</label>
          <select id="image-privacy" value={directImages?'direct':'proxy'} onChange={(event)=>{const direct=event.target.value==='direct';setDirectImages(direct);localStorage.setItem('brew:direct-images',String(direct))}} className="rounded-full border border-stone-300 bg-white px-3 py-2 text-xs font-medium">
            <option value="proxy">Private images</option><option value="direct">Load images directly</option>
          </select>
          <button
            onClick={() => setMode(mode === 'rules' ? 'reader' : 'rules')}
            className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            {mode === 'rules' ? 'Back to Brew' : 'Rules'}
          </button>
          <button
            onClick={() => setMode(mode === 'feeds' ? 'reader' : 'feeds')}
            className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
          >
            {mode === 'feeds' ? 'Back to Brew' : 'Manage feeds'}
          </button>
        </div>
      </header>
      {mode === 'feeds' ? (
        <FeedManager />
      ) : mode === 'rules' ? (
        <RulesPage />
      ) : mode === 'brew' ? (
        <BrewPage />
      ) : (
        <Reader
          searchQuery={searchQuery}
          onClearSearch={() => {
            setSearchDraft('');
            setSearchQuery('');
          }}
        />
      )}
    </main>
  );
}

class ErrorBoundary extends Component<{children:ReactNode},{error:boolean}>{state={error:false};static getDerivedStateFromError(){return{error:true}}render(){return this.state.error?<main className="grid min-h-screen place-items-center bg-stone-50 p-8 text-center"><div><p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Brew</p><h1 className="mt-2 text-3xl font-semibold">Something went wrong.</h1><p className="mt-2 text-stone-500">Your local data is safe. Reload to try again.</p><button onClick={()=>location.reload()} className="mt-6 rounded-full bg-stone-900 px-5 py-2 text-white">Reload Brew</button></div></main>:this.props.children}}

function FeedManager() {
  const [feeds, setFeeds] = useState<FeedSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [url, setUrl] = useState('');
  const [candidates, setCandidates] = useState<FeedCandidate[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [folderTitle, setFolderTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [section, setSection] = useState<'feeds' | 'health'>('feeds');
  const refresh = useCallback(async () => {
    const [nextFeeds, nextFolders] = await Promise.all([
      api<FeedSummary[]>('/api/feeds'),
      api<FolderSummary[]>('/api/folders'),
    ]);
    setFeeds(nextFeeds);
    setFolders(nextFolders);
  }, []);
  useEffect(() => {
    void Promise.all([api<FeedSummary[]>('/api/feeds'), api<FolderSummary[]>('/api/folders')])
      .then(([nextFeeds, nextFolders]) => {
        setFeeds(nextFeeds);
        setFolders(nextFolders);
      })
      .catch((error: Error) => setMessage(error.message));
  }, []);

  async function discover(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ candidates: FeedCandidate[] }>('/api/feeds/discover', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      setCandidates(result.candidates);
      if (!result.candidates.length) setMessage('No feeds were found at that address.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Discovery failed');
    } finally {
      setBusy(false);
    }
  }
  async function addFeed(candidate: FeedCandidate) {
    setBusy(true);
    setMessage('');
    try {
      await api('/api/feeds', {
        method: 'POST',
        body: JSON.stringify({ url: candidate.url, folderId }),
      });
      setCandidates([]);
      setUrl('');
      setMessage(`Added ${candidate.title}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add feed');
    } finally {
      setBusy(false);
    }
  }
  async function addFolder(event: FormEvent) {
    event.preventDefault();
    if (!folderTitle.trim()) return;
    await api('/api/folders', { method: 'POST', body: JSON.stringify({ title: folderTitle }) });
    setFolderTitle('');
    await refresh();
  }
  async function importOpml(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ imported: number; skipped: number }>('/api/opml/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/x-opml' },
        body: await file.text(),
      });
      setMessage(
        `Imported ${result.imported} feeds${result.skipped ? `; skipped ${result.skipped} already subscribed` : ''}.`,
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not import OPML');
    } finally {
      setBusy(false);
    }
  }
  async function renameFeed(feed: FeedSummary) {
    const title = window.prompt('Feed name', feed.title)?.trim();
    if (!title) return;
    await api(`/api/feeds/${feed.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title, folderId: feed.folderId }),
    });
    await refresh();
  }
  async function removeFeed(feed: FeedSummary) {
    if (!window.confirm(`Delete “${feed.title}” and its articles?`)) return;
    await api(`/api/feeds/${feed.id}`, { method: 'DELETE' });
    await refresh();
  }
  async function renameFolder(folder: FolderSummary) {
    const title = window.prompt('Folder name', folder.title)?.trim();
    if (!title) return;
    await api(`/api/folders/${folder.id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
    await refresh();
  }
  async function removeFolder(folder: FolderSummary) {
    if (!window.confirm(`Delete folder “${folder.title}”? Feeds will become unfiled.`)) return;
    await api(`/api/folders/${folder.id}`, { method: 'DELETE' });
    await refresh();
  }
  async function retryFeed(feed: FeedSummary) {
    setBusy(true);
    setMessage(`Fetching ${feed.title}…`);
    try {
      const result = await api<{ outcome: string; newItems: number; error?: string }>(
        `/api/feeds/${feed.id}/fetch`,
        { method: 'POST' },
      );
      setMessage(
        result.outcome === 'error'
          ? `Fetch failed: ${result.error}`
          : `Fetched ${feed.title}; ${result.newItems} new.`,
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Fetch failed');
    } finally {
      setBusy(false);
    }
  }

  if (section === 'health')
    return (
      <section className="mx-auto max-w-5xl px-8 py-12">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-amber-700">
              Settings
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Feed health</h1>
            <p className="mt-2 text-sm text-stone-500">
              Fetch status and failure history stay on this machine.
            </p>
          </div>
          <button
            onClick={() => setSection('feeds')}
            className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm"
          >
            Manage feeds
          </button>
        </div>
        {message && (
          <p role="status" className="mt-5 rounded-xl bg-stone-100 px-4 py-3 text-sm">
            {message}
          </p>
        )}
        <div className="mt-8 overflow-hidden rounded-2xl border border-stone-200 bg-white">
          <div className="hidden grid-cols-[minmax(0,1fr)_8rem_7rem_7rem_auto] gap-4 border-b border-stone-200 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-stone-500 md:grid">
            <span>Feed</span>
            <span>Last attempt</span>
            <span>Status</span>
            <span>Failures</span>
            <span></span>
          </div>
          {feeds.length === 0 ? (
            <p className="p-8 text-center text-sm text-stone-500">No feeds to monitor.</p>
          ) : (
            feeds.map((feed) => (
              <article
                key={feed.id}
                className="grid items-center gap-3 border-b border-stone-100 px-5 py-4 last:border-0 md:grid-cols-[minmax(0,1fr)_8rem_7rem_7rem_auto]"
              >
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium">{feed.title}</h2>
                  {feed.healthWarning && (
                    <span className="mt-1 inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                      Failing over 7 days
                    </span>
                  )}
                </div>
                <span className="text-xs text-stone-500">
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
                  className={`w-fit rounded-full px-2 py-1 text-xs font-semibold ${feed.lastStatus && feed.lastStatus >= 200 && feed.lastStatus < 400 ? 'bg-emerald-50 text-emerald-700' : feed.lastStatus ? 'bg-red-50 text-red-700' : 'bg-stone-100 text-stone-600'}`}
                >
                  {feed.lastStatus ?? '—'}
                </span>
                <span className="text-xs text-stone-600">{feed.consecutiveFailures || 'None'}</span>
                <button
                  disabled={busy}
                  onClick={() => retryFeed(feed)}
                  className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-medium disabled:opacity-50"
                >
                  Fetch now
                </button>
              </article>
            ))
          )}
        </div>
      </section>
    );

  return (
    <div className="mx-auto grid max-w-5xl gap-12 px-8 py-12 md:grid-cols-[minmax(0,1fr)_18rem]">
      <section>
        <p className="text-xs font-semibold uppercase tracking-[.2em] text-amber-700">Library</p>
        <div className="mt-2 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold tracking-tight">Feeds</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSection('health')}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-medium hover:bg-stone-50"
            >
              Feed health
            </button>
            <label className="cursor-pointer rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-medium hover:bg-stone-50">
              Import OPML
              <input
                type="file"
                accept=".opml,.xml,text/x-opml"
                disabled={busy}
                onChange={(event) => {
                  void importOpml(event.target.files?.[0]);
                  event.target.value = '';
                }}
                className="sr-only"
              />
            </label>
            <a
              href="/api/opml/export"
              download
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-medium hover:bg-stone-50"
            >
              Export OPML
            </a>
          </div>
        </div>
        <p className="mt-2 text-sm text-stone-500">
          Paste a feed or website address. Brew will find RSS, Atom, and JSON feeds.
        </p>
        <form onSubmit={discover} className="mt-8 flex gap-2">
          <label className="sr-only" htmlFor="feed-url">
            Feed or website URL
          </label>
          <input
            id="feed-url"
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
            className="min-w-0 flex-1 rounded-xl border border-stone-300 bg-white px-4 py-3 outline-none focus:border-amber-700 focus:ring-2 focus:ring-amber-100"
          />
          <button
            disabled={busy}
            className="rounded-xl bg-stone-900 px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Looking…' : 'Find feed'}
          </button>
        </form>
        {message && (
          <p role="status" className="mt-3 text-sm text-stone-600">
            {message}
          </p>
        )}
        {candidates.length > 0 && (
          <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-3">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">
              Choose a feed
            </p>
            {candidates.map((candidate) => (
              <button
                key={candidate.url}
                disabled={busy}
                onClick={() => addFeed(candidate)}
                className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left hover:bg-stone-50"
              >
                <span>
                  <span className="block font-medium">{candidate.title}</span>
                  <span className="block max-w-lg truncate text-xs text-stone-500">
                    {candidate.url}
                  </span>
                </span>
                <span className="rounded-full bg-stone-100 px-2 py-1 text-[10px] font-bold uppercase">
                  {candidate.type}
                </span>
              </button>
            ))}
            <div className="mt-2 border-t border-stone-100 px-2 pt-3">
              <label className="text-xs text-stone-500">
                Save in{' '}
                <select
                  value={folderId ?? ''}
                  onChange={(event) =>
                    setFolderId(event.target.value ? Number(event.target.value) : null)
                  }
                  className="ml-2 rounded-lg border border-stone-300 px-2 py-1"
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
          </div>
        )}
        <div className="mt-10 space-y-2">
          {feeds.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
              No feeds yet.
            </div>
          ) : (
            feeds.map((feed) => (
              <article
                key={feed.id}
                className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white px-5 py-4"
              >
                <div className="min-w-0">
                  <h2 className="font-medium">{feed.title}</h2>
                  <p className="truncate text-xs text-stone-500">{feed.url}</p>
                </div>
                <div className="ml-4 flex gap-2">
                  <button
                    onClick={() => renameFeed(feed)}
                    className="rounded-lg px-3 py-2 text-xs font-medium hover:bg-stone-100"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => removeFeed(feed)}
                    className="rounded-lg px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      <aside>
        <h2 className="text-sm font-semibold">Folders</h2>
        <form onSubmit={addFolder} className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor="folder-title">
            New folder name
          </label>
          <input
            id="folder-title"
            value={folderTitle}
            onChange={(event) => setFolderTitle(event.target.value)}
            placeholder="New folder"
            className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
          <button
            className="rounded-lg border border-stone-300 bg-white px-3 text-lg"
            aria-label="Create folder"
          >
            +
          </button>
        </form>
        <div className="mt-4 space-y-1">
          {folders.map((folder) => (
            <div
              key={folder.id}
              className="group flex items-center justify-between rounded-lg px-2 py-2 hover:bg-stone-100"
            >
              <span className="text-sm">{folder.title}</span>
              <span className="flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  onClick={() => renameFolder(folder)}
                  aria-label={`Rename ${folder.title}`}
                  className="px-1 text-xs"
                >
                  Edit
                </button>
                <button
                  onClick={() => removeFolder(folder)}
                  aria-label={`Delete ${folder.title}`}
                  className="px-1 text-xs text-red-700"
                >
                  ×
                </button>
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
