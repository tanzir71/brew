import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppSidebar } from './components/AppSidebar';
import { TopBar } from './components/patterns';
import { Button } from './components/controls';
import { ModalSheet } from './components/Sheet';
import { BrewRead } from './brew/BrewRead';
import { useBrewReadState } from './brew/useBrewReadState';
import type { ReaderNavigation, TagSummary } from '@brew/core/types/api';
import type { BrewConfig, BrewConfigDraft, BrewSection, BrewSnapshot } from '@brew/core/types/brew';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) throw new Error('Could not load the Brew');
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
const newSection = (): BrewSection => ({
  id: crypto.randomUUID(),
  title: 'Today’s picks',
  source: 'today',
  maxItems: 5,
  layout: 'magazine',
  sort: 'newest',
  onlyUnread: true,
});
const blank = (): BrewConfigDraft => ({
  name: 'Morning',
  scheduleCron: '0 7 * * *',
  enabled: true,
  sections: [newSection()],
});

export function BrewPage({ preferences }: { preferences: ReactNode }) {
  const [configs, setConfigs] = useState<BrewConfig[]>([]);
  const [selected, setSelected] = useState<number | null>(() => {
    const id = Number(
      location.pathname.split('/')[1] === 'b'
        ? location.pathname.split('/')[2]
        : (new URLSearchParams(location.search).get('brew') ??
            localStorage.getItem('brew:last-brew')),
    );
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  const [draft, setDraft] = useState<BrewConfigDraft>(blank);
  const [history, setHistory] = useState<BrewSnapshot[]>([]);
  const [snapshot, setSnapshot] = useState<BrewSnapshot | null>(null);
  const [editing, setEditing] = useState(location.pathname.endsWith('/compose'));
  const [message, setMessage] = useState('');
  const [navigation, setNavigation] = useState<ReaderNavigation | null>(null);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const dragged = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [issueLoading, setIssueLoading] = useState(false);
  const [markAllRequested, setMarkAllRequested] = useState(false);
  const readState = useBrewReadState(snapshot?.id);
  const selectIssue = (issue: BrewSnapshot) => {
    setSnapshot(issue);
    historyReplace(issue.brewConfigId, issue.id);
  };

  const refresh = useCallback(async () => {
    const [next, nav, nextTags] = await Promise.all([
      request<BrewConfig[]>('/api/brew-configs'),
      request<ReaderNavigation>('/api/reader/navigation'),
      request<TagSummary[]>('/api/tags'),
    ]);
    setConfigs(next);
    setNavigation(nav);
    setTags(nextTags);
    if (selected === null && !creating && next[0]) setSelected(next[0].id);
  }, [selected, creating]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the existing composer data from the server.
    void refresh()
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (selected === null) return;
    const controller = new AbortController();
    const config = configs.find((item) => item.id === selected);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronize the edition loading indicator with this abortable request.
    setIssueLoading(true);
    void request<BrewSnapshot[]>(`/api/brew-configs/${selected}/history`, {
      signal: controller.signal,
    })
      .then((items) => {
        if (controller.signal.aborted) return;
        if (config)
          setDraft({
            name: config.name,
            scheduleCron: config.scheduleCron,
            enabled: config.enabled,
            sections: structuredClone(config.sections),
          });
        setHistory(items);
        const issueId = Number(
          location.pathname.split('/')[3] ?? new URLSearchParams(location.search).get('issue'),
        );
        setSnapshot(items.find((item) => item.id === issueId) ?? items[0] ?? null);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) {
          setSnapshot(null);
          setMessage(error.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIssueLoading(false);
      });
    return () => controller.abort();
  }, [configs, selected]);
  useEffect(() => {
    if (!snapshot) return;
    const frame = requestAnimationFrame(() => window.scrollTo(0, snapshot.scrollPosition));
    let timeout = 0;
    const save = () => {
      clearTimeout(timeout);
      timeout = window.setTimeout(
        () =>
          void request(`/api/brews/${snapshot.id}/scroll`, {
            method: 'PUT',
            body: JSON.stringify({ position: window.scrollY }),
          }).catch(() => setMessage('Reading position could not be saved.')),
        250,
      );
    };
    window.addEventListener('scroll', save);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      window.removeEventListener('scroll', save);
    };
  }, [snapshot]);
  const save = async () => {
    const config = await request<BrewConfig>(
      selected === null ? '/api/brew-configs' : `/api/brew-configs/${selected}`,
      { method: selected === null ? 'POST' : 'PUT', body: JSON.stringify(draft) },
    );
    setCreating(false);
    setSelected(config.id);
    setEditing(false);
    setMessage('Brew saved.');
    await refresh();
  };
  const generate = async () => {
    if (selected === null) {
      setMessage('Save this Brew before generating it.');
      return;
    }
    const next = await request<BrewSnapshot>(`/api/brew-configs/${selected}/generate`, {
      method: 'POST',
    });
    setSnapshot(next);
    historyReplace(next.brewConfigId, next.id);
    setHistory((current) => [next, ...current].slice(0, 30));
    setEditing(false);
  };
  const updateSection = (index: number, values: Partial<BrewSection>) =>
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section, item) =>
        item === index ? { ...section, ...values } : section,
      ),
    }));
  const sourceChoices = (section: BrewSection): Array<{ id: number; title: string }> =>
    section.source === 'folder'
      ? (navigation?.folders.map((item) => ({ id: item.id, title: item.title })) ?? [])
      : section.source === 'feed'
        ? [
            ...(navigation?.folders.flatMap((item) => item.feeds) ?? []),
            ...(navigation?.unfiled ?? []),
          ].map((item) => ({ id: item.id, title: item.title }))
        : section.source === 'tag'
          ? tags.map((item) => ({ id: item.id, title: item.name }))
          : [];
  if (loading)
    return (
      <div role="status" className="grid min-h-screen place-items-center text-sm text-soft">
        Brewing your edition…
      </div>
    );
  const currentIndex = snapshot ? history.findIndex((item) => item.id === snapshot.id) : -1;
  const config = configs.find((item) => item.id === selected);
  const nextBrew = () => {
    setCreating(true);
    setSelected(null);
    setDraft(blank());
    setSnapshot(null);
    setHistory([]);
    setEditing(true);
    setMore(false);
  };
  return (
    <div className="runs-app brew-read-app">
      <AppSidebar activeHref={`/?view=brew&brew=${selected}`} />
      <div className="brew-read-main">
        <TopBar
          brews={
            configs.length
              ? configs.map((item) => ({ id: String(item.id), name: item.name }))
              : [{ id: '', name: 'Your Brews' }]
          }
          brewId={String(selected ?? '')}
          onBrewChange={(id) => {
            setCreating(false);
            setSnapshot(null);
            setSelected(Number(id));
            historyReplace(Number(id));
            setEditing(false);
          }}
          view={editing ? 'compose' : 'read'}
          onViewChange={(view) => {
            setEditing(view === 'compose');
            if (selected !== null) {
              if (view === 'compose') window.history.replaceState({}, '', `/b/${selected}/compose`);
              else historyReplace(selected, snapshot?.id);
            }
          }}
          date={
            snapshot
              ? new Intl.DateTimeFormat('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  timeZone: readState.data?.timeZone ?? 'UTC',
                }).format(new Date(snapshot.generatedAt))
              : ''
          }
          onPrevious={
            history[currentIndex + 1] ? () => selectIssue(history[currentIndex + 1]!) : undefined
          }
          onNext={currentIndex > 0 ? () => selectIssue(history[currentIndex - 1]!) : undefined}
          onMarkAllRead={snapshot && !editing ? () => setMarkAllRequested(true) : undefined}
          onMore={() => setMore(true)}
        />
        {message && (
          <p role="status" className="mx-auto mt-4 max-w-5xl px-6 text-sm text-soft">
            {message}
          </p>
        )}
        {editing ? (
          <main className="mx-auto max-w-5xl px-6 py-10">
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex-1 text-xs uppercase tracking-wider text-soft">
                Brew name
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="mt-2 block w-full rounded-xl border border-line-strong bg-surface px-4 py-3 text-xl normal-case"
                />
              </label>
              <label className="text-xs uppercase tracking-wider text-soft">
                Schedule
                <input
                  value={draft.scheduleCron}
                  onChange={(e) => setDraft({ ...draft, scheduleCron: e.target.value })}
                  className="mt-2 block rounded-xl border border-line-strong bg-surface px-4 py-3 font-mono text-sm normal-case"
                />
              </label>
              <label className="pb-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                />{' '}
                Scheduled
              </label>
              <button
                onClick={() => void save()}
                className="rounded-xl bg-inverse px-5 py-3 text-sm font-semibold text-on-inverse"
              >
                Save Brew
              </button>
              {selected !== null && (
                <button
                  onClick={() =>
                    void request(`/api/brew-configs/${selected}`, { method: 'DELETE' }).then(() => {
                      const next = configs.filter((item) => item.id !== selected);
                      setConfigs(next);
                      setSelected(next[0]?.id ?? null);
                      setSnapshot(null);
                    })
                  }
                  className="rounded-xl border border-danger/30 px-4 py-3 text-sm text-danger"
                >
                  Delete Brew
                </button>
              )}
            </div>
            <div className="mt-8 space-y-4">
              {draft.sections.map((section, index) => (
                <article
                  key={section.id}
                  draggable
                  onDragStart={() => (dragged.current = index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragged.current === null || dragged.current === index) return;
                    setDraft((current) => {
                      const sections = [...current.sections];
                      const [moved] = sections.splice(dragged.current!, 1);
                      sections.splice(index, 0, moved!);
                      return { ...current, sections };
                    });
                    dragged.current = null;
                  }}
                  className="rounded-2xl border border-line bg-surface p-5 shadow-raised"
                >
                  <div className="grid gap-3 md:grid-cols-4">
                    <input
                      aria-label={`Section ${index + 1} title`}
                      value={section.title}
                      onChange={(e) => updateSection(index, { title: e.target.value })}
                      className="rounded-lg border border-line-strong px-3 py-2 font-semibold"
                    />
                    <select
                      aria-label={`Section ${index + 1} source`}
                      value={section.source}
                      onChange={(e) =>
                        updateSection(index, {
                          source: e.target.value as BrewSection['source'],
                          sourceId: undefined,
                        })
                      }
                      className="rounded-lg border border-line-strong px-3 py-2"
                    >
                      <option value="today">Today — all</option>
                      <option value="folder">Folder</option>
                      <option value="feed">Feed</option>
                      <option value="tag">Tag</option>
                      <option value="starred">Starred</option>
                      <option value="featured">Featured by rules</option>
                      <option value="weekly_review">Weekly review</option>
                    </select>
                    {['folder', 'feed', 'tag'].includes(section.source) ? (
                      <select
                        aria-label={`Section ${index + 1} source item`}
                        value={section.sourceId ?? ''}
                        onChange={(e) => updateSection(index, { sourceId: Number(e.target.value) })}
                        className="rounded-lg border border-line-strong px-3 py-2"
                      >
                        <option value="">Choose…</option>
                        {sourceChoices(section).map((choice) => (
                          <option key={choice.id} value={choice.id}>
                            {choice.title}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={`Section ${index + 1} divider`}
                        placeholder="Optional divider"
                        value={section.divider ?? ''}
                        onChange={(e) => updateSection(index, { divider: e.target.value })}
                        className="rounded-lg border border-line-strong px-3 py-2"
                      />
                    )}
                    <button
                      aria-label={`Remove section ${index + 1}`}
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          sections: current.sections.filter((_, item) => item !== index),
                        }))
                      }
                      className="text-right text-sm text-danger"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-sm">
                    <label>
                      Divider{' '}
                      <input
                        aria-label={`Section ${index + 1} divider text`}
                        value={section.divider ?? ''}
                        onChange={(event) => updateSection(index, { divider: event.target.value })}
                        className="ml-1 rounded border p-1"
                        placeholder="Optional"
                      />
                    </label>
                    <label>
                      Layout{' '}
                      <select
                        value={section.layout}
                        onChange={(e) =>
                          updateSection(index, { layout: e.target.value as BrewSection['layout'] })
                        }
                        className="ml-1 rounded border p-1"
                      >
                        <option value="lead">lead</option>
                        <option>hero</option>
                        <option value="headlines">headlines</option>
                        <option>list</option>
                        <option>grid</option>
                        <option>magazine</option>
                      </select>
                    </label>
                    <label>
                      Items{' '}
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={section.maxItems}
                        onChange={(e) => updateSection(index, { maxItems: Number(e.target.value) })}
                        className="ml-1 w-14 rounded border p-1"
                      />
                    </label>
                    <label>
                      Sort{' '}
                      <select
                        value={section.sort}
                        onChange={(e) =>
                          updateSection(index, { sort: e.target.value as BrewSection['sort'] })
                        }
                        className="ml-1 rounded border p-1"
                      >
                        <option value="newest">newest</option>
                        <option value="longest">longest read</option>
                      </select>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={section.onlyUnread}
                        onChange={(e) => updateSection(index, { onlyUnread: e.target.checked })}
                      />{' '}
                      Only unread
                    </label>
                    <span className="ml-auto cursor-grab text-muted">Drag to reorder ⠿</span>
                  </div>
                </article>
              ))}
              <button
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    sections: [...current.sections, newSection()],
                  }))
                }
                className="rounded-xl border border-dashed border-line-strong px-5 py-3 text-sm"
              >
                + Add section
              </button>
            </div>
          </main>
        ) : issueLoading ? (
          <main className="brew-read-loading" role="status">
            Loading this Brew…
          </main>
        ) : (
          <BrewRead
            key={snapshot?.id ?? 'empty'}
            snapshot={snapshot}
            config={config}
            previous={history[currentIndex + 1]}
            onSelect={selectIssue}
            onCompose={() => setEditing(true)}
            markAllRequested={markAllRequested}
            onMarkAllClosed={() => setMarkAllRequested(false)}
          />
        )}
        <ModalSheet open={more} onClose={() => setMore(false)} title="Brew options">
          <div className="brew-options">
            <Button onClick={nextBrew}>New Brew</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setMore(false);
                void generate().catch((error: Error) => setMessage(error.message));
              }}
              disabled={selected === null}
            >
              Generate now
            </Button>
            <a href="/?view=feeds">Manage feeds</a>
            {preferences}
            <label>
              Edition date
              <select
                value={snapshot?.id ?? ''}
                onChange={(event) => {
                  const issue = history.find((item) => item.id === Number(event.target.value));
                  if (issue) {
                    selectIssue(issue);
                    setMore(false);
                  }
                }}
              >
                <option value="" disabled>
                  Choose an edition
                </option>
                {history.map((issue) => (
                  <option key={issue.id} value={issue.id}>
                    {new Date(issue.generatedAt).toLocaleString()}
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

function historyReplace(configId: number, issueId?: number) {
  localStorage.setItem('brew:last-brew', String(configId));
  const url = `/b/${configId}${issueId ? `/${issueId}` : ''}`;
  window.history.replaceState({}, '', url);
}
