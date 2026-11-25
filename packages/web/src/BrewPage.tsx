import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BrewConfig as LegacyConfig } from '@brew/core/types/legacy-brew';
import type { BrewConfig, BrewConfigDraft, BrewIssue } from '@brew/core/types/brew';
import { defaultDelivery, legacySections, newBrewSection } from '@brew/core/composition-model';
import { AppSidebar } from './components/AppSidebar';
import { TopBar } from './components/patterns';
import { Button } from './components/controls';
import { ModalSheet } from './components/Sheet';
import { BrewRead } from './brew/BrewRead';
import { useBrewReadState } from './brew/useBrewReadState';
import { composeJson } from './brew/useComposeDraft';
const BrewCompose = lazy(() =>
  import('./brew/BrewCompose').then((module) => ({ default: module.BrewCompose })),
);
const parsedId = (value: string | null | undefined) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
function remember(id: number, issue?: number, compose = false) {
  localStorage.setItem('brew:last-brew', String(id));
  window.history.replaceState({}, '', `/b/${id}${compose ? '/compose' : issue ? `/${issue}` : ''}`);
}
export function BrewPage({ preferences }: { preferences: ReactNode }) {
  const client = useQueryClient();
  const [chosen, setChosen] = useState(() =>
    parsedId(
      location.pathname.startsWith('/b/')
        ? location.pathname.split('/')[2]
        : (new URLSearchParams(location.search).get('brew') ??
            localStorage.getItem('brew:last-brew')),
    ),
  );
  const [issueId, setIssueId] = useState(() =>
    parsedId(location.pathname.split('/')[3] ?? new URLSearchParams(location.search).get('issue')),
  );
  const [editing, setEditing] = useState(location.pathname.endsWith('/compose'));
  const [more, setMore] = useState(false);
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [markAll, setMarkAll] = useState(false);
  const configs = useQuery({
    queryKey: ['brew-configs'],
    queryFn: ({ signal }) => composeJson<LegacyConfig[]>('/api/brew-configs', { signal }),
  });
  const selected = chosen ?? configs.data?.[0]?.id ?? null;
  const selectedRef = useRef(selected);
  useLayoutEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  const history = useQuery({
    queryKey: ['brew-history', selected],
    enabled: selected !== null && !editing,
    queryFn: ({ signal }) =>
      composeJson<BrewIssue[]>(`/api/brew-configs/${selected}/history`, { signal }),
  });
  const issue = history.data?.find((value) => value.id === issueId) ?? history.data?.[0] ?? null;
  const state = useBrewReadState(!editing ? issue?.id : undefined);
  const config = configs.data?.find((value) => value.id === selected);
  useEffect(() => {
    if (!issue || editing) return;
    const frame = requestAnimationFrame(() => window.scrollTo(0, issue.scrollPosition));
    let timer = 0;
    const save = () => {
      clearTimeout(timer);
      timer = window.setTimeout(
        () =>
          void composeJson(`/api/brews/${issue.id}/scroll`, {
            method: 'PUT',
            body: JSON.stringify({ position: window.scrollY }),
          }).catch(() => setNotice('Reading position could not be saved.')),
        250,
      );
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener('scroll', save);
    };
  }, [issue, editing]);
  const choose = (id: number) => {
    setChosen(id);
    setIssueId(null);
    setEditing(false);
    setNotice('');
    remember(id);
  };
  const selectIssue = (value: BrewIssue) => {
    setIssueId(value.id);
    remember(value.brewConfigId, value.id);
  };
  const create = async () => {
    if (creating) return;
    setCreating(true);
    setNotice('');
    try {
      const draft: BrewConfigDraft = {
        name: 'Morning',
        enabled: true,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        schedule: { kind: 'daily', time: '07:00' },
        delivery: defaultDelivery(),
        sections: [newBrewSection(crypto.randomUUID())],
      };
      const value = await composeJson<BrewConfig>('/api/brew-configs/composition', {
        method: 'POST',
        body: JSON.stringify(draft),
      });
      const legacy: LegacyConfig = {
        id: value.id,
        name: value.name,
        createdAt: value.createdAt,
        enabled: value.enabled,
        scheduleCron: value.scheduleCron,
        sections: legacySections(value.sections),
      };
      client.setQueryData<LegacyConfig[]>(['brew-configs'], (old) => [...(old ?? []), legacy]);
      setChosen(value.id);
      setIssueId(null);
      setEditing(true);
      setMore(false);
      remember(value.id, undefined, true);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setCreating(false);
    }
  };
  const generate = async () => {
    if (selected === null) return;
    const id = selected;
    const next = await composeJson<BrewIssue>(`/api/brew-configs/${id}/generate`, {
      method: 'POST',
    });
    client.setQueryData<BrewIssue[]>(['brew-history', id], (old) =>
      [next, ...(old ?? []).filter((value) => value.id !== next.id)].slice(0, 30),
    );
    if (selectedRef.current === id) {
      setIssueId(next.id);
      setEditing(false);
      setMore(false);
      remember(id, next.id);
    }
  };
  const startCompose = () => {
    if (selected === null) {
      void create();
      return;
    }
    setEditing(true);
    remember(selected, undefined, true);
  };
  const read = () => {
    setEditing(false);
    if (selected !== null) remember(selected, issue?.id);
  };
  const position = issue ? (history.data?.findIndex((value) => value.id === issue.id) ?? -1) : -1;
  if (configs.isPending)
    return (
      <main role="status" className="brew-read-loading">
        Loading your Brews…
      </main>
    );
  return (
    <div className={`runs-app brew-read-app ${editing ? 'brew-compose-app' : ''}`}>
      <AppSidebar activeHref={`/?view=brew&brew=${selected}`} />
      <div className="brew-read-main">
        {editing && selected !== null ? (
          <Suspense
            fallback={
              <main role="status" className="brew-read-loading">
                Loading Compose…
              </main>
            }
          >
            <BrewCompose
              key={selected}
              id={selected}
              brews={(configs.data ?? []).map((value) => ({
                id: String(value.id),
                name: value.name,
              }))}
              onBrewChange={choose}
              onRead={read}
              onGenerate={generate}
            />
          </Suspense>
        ) : (
          <>
            <TopBar
              brews={
                configs.data?.length
                  ? configs.data.map((value) => ({ id: String(value.id), name: value.name }))
                  : [{ id: '', name: 'Your Brews' }]
              }
              brewId={String(selected ?? '')}
              onBrewChange={(id) => choose(Number(id))}
              view="read"
              onViewChange={(value) => {
                if (value === 'compose') startCompose();
              }}
              date={
                issue
                  ? new Intl.DateTimeFormat('en-GB', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      timeZone: 'timezone' in issue ? issue.timezone : state.data?.timeZone ?? 'UTC',
                    }).format(new Date(issue.generatedAt))
                  : ''
              }
              onPrevious={
                history.data?.[position + 1]
                  ? () => selectIssue(history.data![position + 1]!)
                  : undefined
              }
              onNext={position > 0 ? () => selectIssue(history.data![position - 1]!) : undefined}
              onMarkAllRead={issue ? () => setMarkAll(true) : undefined}
              onMore={() => setMore(true)}
            />
            {configs.isError || history.isError ? (
              <main className="compose-load-error">
                <h1>Could not load your Brew.</h1>
                <Button
                  onClick={() => {
                    void configs.refetch();
                    void history.refetch();
                  }}
                >
                  Retry
                </Button>
              </main>
            ) : history.isFetching && !history.data && selected !== null ? (
              <main role="status" className="brew-read-loading">
                Loading this Brew…
              </main>
            ) : (
              <BrewRead
                key={issue?.id ?? 'empty'}
                snapshot={issue}
                config={config}
                previous={history.data?.[position + 1]}
                onSelect={selectIssue}
                onCompose={startCompose}
                markAllRequested={markAll}
                onMarkAllClosed={() => setMarkAll(false)}
              />
            )}
          </>
        )}
        {notice && (
          <p role="status" className="brew-page-notice">
            {notice}
          </p>
        )}
        <ModalSheet open={more} onClose={() => setMore(false)} title="Brew options">
          <div className="brew-options">
            <Button disabled={creating} onClick={() => void create()}>
              New Brew
            </Button>
            <Button
              variant="secondary"
              disabled={selected === null}
              onClick={() => void generate().catch((error) => setNotice((error as Error).message))}
            >
              Generate now
            </Button>
            <a href="/?view=feeds">Manage feeds</a>
            {preferences}
            <label>
              Edition date
              <select
                value={issue?.id ?? ''}
                onChange={(event) => {
                  const value = history.data?.find(
                    (value) => value.id === Number(event.target.value),
                  );
                  if (value) {
                    selectIssue(value);
                    setMore(false);
                  }
                }}
              >
                <option value="" disabled>
                  Choose an edition
                </option>
                {history.data?.map((value) => (
                  <option key={value.id} value={value.id}>
                    {new Date(value.generatedAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </ModalSheet>
      </div>
    </div>
  );
}
