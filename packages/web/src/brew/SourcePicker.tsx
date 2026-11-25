import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeedSummary, FolderSummary, TagSummary } from '@brew/core/types/api';
import type { BrewSection, BrewSourceRef } from '@brew/core/types/brew';
import type { RuleRecord } from '@brew/core/types/rules';
import type {
  SourceDiscovery,
  SourceCandidate,
  SavedSourceSearch,
  SourceMailbox,
} from '@brew/core/types/sources';
import {
  Button,
  Checkbox,
  Input,
  Avatar,
  SegmentedControl,
  Chip,
  IconButton,
} from '../components/controls';
import { Icon } from '../components/Icon';
import { Badge } from '../components/Badge';
import { ModalSheet } from '../components/Sheet';
import { useCapabilities } from '../hooks/useCapabilities';
import { composeJson } from './useComposeDraft';

const key = (source: BrewSourceRef) => `${source.kind}:${source.id ?? ''}`;
type LocalSearch = { clientId: string; name: string; query: string };
function localSearches(): LocalSearch[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('brew:saved-searches') ?? '[]');
    return Array.isArray(value)
      ? value
          .filter(
            (item): item is { id: string; name: string; query: string } =>
              !!item &&
              typeof item.id === 'string' &&
              typeof item.name === 'string' &&
              typeof item.query === 'string',
          )
          .map(({ id, ...item }) => ({ ...item, clientId: id }))
      : [];
  } catch {
    return [];
  }
}
const tabs = ['Feeds', 'Folders', 'Tags', 'Newsletters', 'Searches', 'Rules', 'Starred'];
export function SourcePicker({
  section,
  onApply,
  onClose,
}: {
  section: BrewSection;
  onApply: (sources: BrewSourceRef[]) => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const caps = useCapabilities();
  const [selected, setSelected] = useState(section.sources);
  const [candidates, setCandidates] = useState<SourceCandidate[]>([]);
  const [selectedSearches, setSelectedSearches] = useState<LocalSearch[]>([]);
  const [tab, setTab] = useState('Feeds');
  const [filter, setFilter] = useState('');
  const [input, setInput] = useState('');
  const [retry, setRetry] = useState(0);
  const [discovery, setDiscovery] = useState<SourceDiscovery | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [browserSearches] = useState(localSearches);
  const urlRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const feeds = useQuery({
    queryKey: ['source-feeds'],
    retry: false,
    queryFn: ({ signal }) => composeJson<FeedSummary[]>('/api/feeds', { signal }),
  });
  const folders = useQuery({
    queryKey: ['source-folders'],
    retry: false,
    queryFn: ({ signal }) => composeJson<FolderSummary[]>('/api/folders', { signal }),
  });
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: ({ signal }) => composeJson<TagSummary[]>('/api/tags', { signal }),
  });
  const rules = useQuery({
    queryKey: ['source-rules'],
    retry: false,
    queryFn: ({ signal }) => composeJson<RuleRecord[]>('/api/rules', { signal }),
  });
  const searches = useQuery({
    queryKey: ['source-searches'],
    queryFn: ({ signal }) => composeJson<SavedSourceSearch[]>('/api/sources/searches', { signal }),
  });
  const mailbox = useQuery({
    queryKey: ['source-mailbox'],
    queryFn: ({ signal }) => composeJson<SourceMailbox>('/api/sources/mailbox', { signal }),
  });
  const queries = [feeds, folders, tags, rules, searches];
  const isUrl = (value: string) =>
    /^(?:[a-z][a-z\d+.-]*:\/\/|(?:feed|pcast):|[^\s/]+\.[^\s]+|localhost:\d+)/i.test(value.trim());
  const urlLike = isUrl(input);
  const changeInput = (value: string) => {
    setInput(value);
    setDiscovery(null);
    setDiscoveryError('');
    setDiscovering(isUrl(value));
    setCopied(false);
  };
  const retryDiscovery = () => {
    setDiscoveryError('');
    setDiscovering(urlLike);
    setRetry((value) => value + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    if (!urlLike) return () => controller.abort();
    const timer = window.setTimeout(
      () =>
        void composeJson<SourceDiscovery>('/api/sources/discover', {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({ url: input.trim() }),
        })
          .then((value) => {
            if (!controller.signal.aborted) {
              setDiscovery(value);
              setDiscoveryError('');
            }
          })
          .catch((failure: Error) => {
            if (!controller.signal.aborted) setDiscoveryError(failure.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setDiscovering(false);
          }),
      350,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input, urlLike, retry]);
  const toggle = (source: BrewSourceRef, checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...current.filter((item) => key(item) !== key(source)), source]
        : current.filter((item) => key(item) !== key(source)),
    );
  const chooseCandidate = (candidate: SourceCandidate, checked: boolean) => {
    const existing = feeds.data?.find((feed) => feed.url === candidate.url);
    if (existing) {
      toggle({ kind: 'feed', id: existing.id }, checked);
      return;
    }
    setCandidates((current) =>
      checked
        ? [...current.filter((item) => item.url !== candidate.url), candidate]
        : current.filter((item) => item.url !== candidate.url),
    );
  };
  const refresh = () =>
    Promise.all(
      [
        'source-feeds',
        'source-folders',
        'source-searches',
        'reader-navigation',
        'feeds',
        'folders',
      ].map((queryKey) => client.invalidateQueries({ queryKey: [queryKey] })),
    );
  const apply = async () => {
    setBusy(true);
    setError('');
    const next = [...selected];
    const completedUrls = new Set<string>();
    const completedSearches = new Set<string>();
    try {
      let library = feeds.data ?? [];
      for (const candidate of candidates) {
        let feed = library.find((item) => item.url === candidate.url);
        if (!feed) {
          const response = await fetch('/api/feeds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: candidate.url }),
          });
          if (response.status === 409) {
            library = await composeJson<FeedSummary[]>('/api/feeds');
            feed = library.find((item) => item.url === candidate.url);
            if (!feed)
              throw new Error(
                'This feed is already subscribed under another URL. Refresh the library to select it.',
              );
          } else {
            const value = await response.json();
            if (!response.ok) throw new Error(value.error ?? 'Could not add this feed.');
            feed = value as FeedSummary;
            library = [...library, feed];
          }
        }
        next.push({ kind: 'feed', id: feed.id });
        completedUrls.add(candidate.url);
      }
      for (const search of selectedSearches) {
        const saved = await composeJson<SavedSourceSearch>('/api/sources/searches', {
          method: 'POST',
          body: JSON.stringify(search),
        });
        next.push({ kind: 'saved_search', id: saved.id });
        completedSearches.add(search.clientId);
      }
      await refresh();
      if (alive.current)
        onApply([...new Map(next.map((source) => [key(source), source])).values()]);
    } catch (failure) {
      if (alive.current) {
        setSelected([...new Map(next.map((source) => [key(source), source])).values()]);
        setCandidates((current) => current.filter((item) => !completedUrls.has(item.url)));
        setSelectedSearches((current) =>
          current.filter((item) => !completedSearches.has(item.clientId)),
        );
        setError(
          `${(failure as Error).message}${completedUrls.size ? ' Added feeds are in your library; retry to finish this section.' : ''}`,
        );
      }
      await refresh();
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const importOpml = async (file: File) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (file.size > 1_000_000) throw new Error('Choose an OPML file smaller than 1 MB.');
      const response = await composeJson<{
        imported: number;
        skipped: number;
        foldersCreated: number;
      }>('/api/opml/import', { method: 'POST', body: JSON.stringify(await file.text()) });
      await refresh();
      if (alive.current) {
        setTab('Feeds');
        setFilter('');
        changeInput('');
        setNotice(
          `Imported ${response.imported} ${response.imported === 1 ? 'feed' : 'feeds'}; skipped ${response.skipped} existing ${response.skipped === 1 ? 'feed' : 'feeds'}. Choose the ones to include in this section.`,
        );
      }
    } catch (failure) {
      if (alive.current) setError((failure as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const list: Array<{
    name: string;
    caption?: string;
    source?: BrewSourceRef;
    search?: LocalSearch;
    id: string;
    disabled?: boolean;
  }> =
    tab === 'Feeds'
      ? (feeds.data ?? []).map((feed) => ({
          id: `feed:${feed.id}`,
          name: feed.title,
          caption: folders.data?.find((folder) => folder.id === feed.folderId)?.title,
          source: { kind: 'feed', id: feed.id },
        }))
      : tab === 'Folders'
        ? (folders.data ?? []).map((folder) => ({
            id: `folder:${folder.id}`,
            name: folder.title,
            caption: `${feeds.data?.filter((feed) => feed.folderId === folder.id).length ?? 0} feeds`,
            source: { kind: 'folder', id: folder.id },
          }))
        : tab === 'Tags'
          ? (tags.data ?? []).map((tag) => ({
              id: `tag:${tag.id}`,
              name: tag.name,
              source: { kind: 'tag', id: tag.id },
            }))
          : tab === 'Searches'
            ? [
                ...(searches.data ?? []).map((search) => ({
                  id: `saved_search:${search.id}`,
                  name: search.name,
                  caption: search.query,
                  source: { kind: 'saved_search' as const, id: search.id },
                })),
                ...browserSearches
                  .filter(
                    (search) => !searches.data?.some((saved) => saved.clientId === search.clientId),
                  )
                  .map((search) => ({
                    id: search.clientId,
                    name: search.name,
                    caption: search.query,
                    search,
                  })),
              ]
            : tab === 'Rules'
              ? [
                  {
                    id: 'featured:',
                    name: 'Featured by rules',
                    caption: `${rules.data?.filter((rule) => rule.enabled && rule.actions.some((action) => action.type === 'feature_in_brew')).length ?? 0} enabled feature rules`,
                    source: { kind: 'featured' },
                  },
                ]
              : tab === 'Starred'
                ? [
                    { id: 'starred:', name: 'Starred', source: { kind: 'starred' } },
                    { id: 'today:', name: 'Today', source: { kind: 'today' } },
                    {
                      id: 'weekly_review:',
                      name: 'Weekly review',
                      caption: 'Starred in the last seven days',
                      source: { kind: 'weekly_review' },
                    },
                  ]
                : [];
  const term = `${filter} ${urlLike ? '' : input}`.trim().toLocaleLowerCase();
  const visible = list.filter((item) =>
    term
      .split(/\s+/)
      .every((word) => `${item.name} ${item.caption ?? ''}`.toLocaleLowerCase().includes(word)),
  );
  const known = new Set([
    ...(feeds.data ?? []).map((feed) => `feed:${feed.id}`),
    ...(folders.data ?? []).map((folder) => `folder:${folder.id}`),
    ...(tags.data ?? []).map((tag) => `tag:${tag.id}`),
    ...(searches.data ?? []).map((search) => `saved_search:${search.id}`),
    'today:',
    'starred:',
    'featured:',
    'weekly_review:',
    'newsletters:',
  ]);
  const unavailable = queries.every((query) => query.data)
    ? selected.filter((source) => !known.has(key(source)))
    : [];
  const total = selected.length + candidates.length + selectedSearches.length;
  const address = caps.data?.inboundMail ? mailbox.data?.address : null;
  const copy = async () => {
    try {
      if (address) {
        await navigator.clipboard.writeText(address);
        setCopied(true);
      }
    } catch {
      setError('Could not copy the address. Select and copy it below.');
    }
  };
  return (
    <ModalSheet
      open
      className="source-sheet"
      title={`Add a source to “${section.title}”`}
      initialFocusRef={urlRef}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="download" size={14} />}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Import OPML
          </Button>
          <span className="brew-spacer" />
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !total || queries.some((query) => !query.data)}
            onClick={() => void apply()}
          >
            {busy ? 'Adding sources…' : `Add ${total} ${total === 1 ? 'source' : 'sources'}`}
          </Button>
        </>
      }
    >
      <div className="source-sheet-body">
        <Input
          label="URL or search"
          hideLabel
          className="source-url"
          disabled={busy}
          placeholder="Paste a URL or search your library"
          inputRef={urlRef}
          value={input}
          onChange={(event) => changeInput(event.target.value)}
          icon={<Icon name="link" size={16} />}
          endAdornment={<span role="status">{discovering ? 'Looking for feeds…' : ''}</span>}
        />
        {discoveryError && (
          <div role="alert" className="source-error">
            {discoveryError}
            <Button size="sm" variant="secondary" onClick={retryDiscovery}>
              Retry discovery
            </Button>
          </div>
        )}
        {discovery && (
          <div className="source-discovery">
            <header>
              <Icon name="rss" size={14} />
              <span>
                Found {discovery.candidates.length}{' '}
                {discovery.candidates.length === 1 ? 'feed' : 'feeds'} on{' '}
                {new URL(discovery.inputUrl).hostname}
              </span>
            </header>
            {discovery.kind !== 'web' && (
              <p className="source-detected">
                {
                  (
                    {
                      youtube: 'YouTube channel',
                      subreddit: 'Subreddit',
                      mastodon: 'Mastodon',
                      bluesky: 'Bluesky',
                      podcast: 'Podcast',
                      web: 'Website',
                    } as const
                  )[discovery.kind]
                }{' '}
                detected · native feed
              </p>
            )}
            {discovery.candidates.map((candidate) => {
              const existing = feeds.data?.find((feed) => feed.url === candidate.url);
              const checked =
                candidates.some((item) => item.url === candidate.url) ||
                (!!existing &&
                  selected.some((source) => source.kind === 'feed' && source.id === existing.id));
              return (
                <div className="source-row source-candidate" key={candidate.url}>
                  <Checkbox
                    aria-label={candidate.title}
                    checked={checked}
                    disabled={busy}
                    onChange={(event) => chooseCandidate(candidate, event.target.checked)}
                    label={
                      <>
                        <Avatar id={candidate.url} initial={candidate.title[0] ?? 'F'} />
                        <span className="source-row-title">
                          <strong>{candidate.title}</strong>
                          <small>
                            {candidate.type === 'json'
                              ? 'JSON Feed'
                              : candidate.type === 'atom'
                                ? 'Atom'
                                : 'RSS'}
                            {candidate.cadence ? ` · ${candidate.cadence}` : ''}
                          </small>
                        </span>
                        {existing && <Badge tone="neutral">Subscribed</Badge>}
                      </>
                    }
                  />
                </div>
              );
            })}
            {discovery.notice && (
              <div className="source-detected">
                {discovery.notice}
                <Button variant="ghost" size="sm" onClick={retryDiscovery}>
                  Retry discovery
                </Button>
              </div>
            )}
            {discovery.newsletter && (
              <div className="source-newsletter">
                <Icon name="mail" size={16} />
                <div>
                  <strong>{discovery.newsletter.title} is also a newsletter</strong>
                  <p>
                    {address
                      ? 'Subscribe with your Brew address and it lands in Newsletters.'
                      : 'Connect mail to receive it at your private Brew address.'}
                  </p>
                  {!address && (
                    <span className="source-mail-gate">
                      <Badge tone="warning">
                        {mailbox.isError ? 'Address unavailable' : 'Needs mail add-on'}
                      </Badge>
                      <a href="/settings/runs#setup-newsletters">Set up</a>
                    </span>
                  )}
                  {address && error.startsWith('Could not copy') && <code>{address}</code>}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Icon name="copy" size={14} />}
                  disabled={!address || busy}
                  onClick={() => void copy()}
                >
                  {copied ? 'Copied' : 'Copy address'}
                </Button>
              </div>
            )}
          </div>
        )}
        {candidates.some(
          (candidate) => !discovery?.candidates.some((item) => item.url === candidate.url),
        ) && (
          <div className="source-pending" aria-label="Selected feeds">
            {candidates
              .filter(
                (candidate) => !discovery?.candidates.some((item) => item.url === candidate.url),
              )
              .map((candidate) => (
                <span key={candidate.url}>
                  {candidate.title}
                  <IconButton
                    icon="x"
                    label={`Remove pending ${candidate.title}`}
                    disabled={busy}
                    onClick={() => chooseCandidate(candidate, false)}
                  />
                </span>
              ))}
          </div>
        )}
        <SegmentedControl
          label="Source library"
          options={tabs.map((value) => ({ value, label: value }))}
          value={tab}
          onValueChange={setTab}
        />
        {!!unavailable.length && (
          <div aria-label="Unavailable section sources">
            {unavailable.map((source) => (
              <Checkbox
                key={key(source)}
                label={`Unavailable ${source.kind} ${source.id ?? ''}`}
                checked
                disabled={busy}
                onChange={() => toggle(source, false)}
              />
            ))}
          </div>
        )}
        {queries.some((query) => query.isError) ? (
          <div role="alert" className="source-error">
            Could not load every library source.
            <Button
              size="sm"
              variant="secondary"
              onClick={() => queries.forEach((query) => void query.refetch())}
            >
              Retry library
            </Button>
          </div>
        ) : (
          <>
            <div className="source-library">
              <Input
                label={`Filter ${tab.toLowerCase()}`}
                hideLabel
                className="source-filter"
                placeholder={`Filter ${list.length} ${tab.toLowerCase()}`}
                icon={<Icon name="search" size={14} />}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <div className="source-library-list" aria-label={`${tab} in your library`}>
                {queries.some((query) => query.isPending) ? (
                  <p role="status">Loading your library…</p>
                ) : (
                  visible.map((item) => {
                    const checked = item.source
                      ? selected.some((source) => key(source) === key(item.source!))
                      : selectedSearches.some(
                          (search) => search.clientId === item.search?.clientId,
                        );
                    return (
                      <div className="source-row" key={item.id}>
                        <Checkbox
                          checked={checked}
                          aria-label={item.name}
                          disabled={busy || item.disabled}
                          onChange={(event) => {
                            if (item.source) toggle(item.source, event.target.checked);
                            else if (item.search)
                              setSelectedSearches((current) =>
                                event.target.checked
                                  ? [...current, item.search!]
                                  : current.filter(
                                      (search) => search.clientId !== item.search!.clientId,
                                    ),
                              );
                          }}
                          label={
                            <>
                              <Avatar
                                id={item.source?.id ?? item.id}
                                initial={item.name[0] ?? 'F'}
                              />
                              <span className="source-row-title">{item.name}</span>
                              {item.caption && (
                                <small className="source-row-caption">{item.caption}</small>
                              )}
                              {item.source &&
                                section.sources.some(
                                  (source) => key(source) === key(item.source!),
                                ) && <Badge tone="neutral">In this section</Badge>}
                            </>
                          }
                        />
                      </div>
                    );
                  })
                )}
                {!queries.some((query) => query.isPending) &&
                  !visible.length &&
                  tab !== 'Newsletters' && (
                    <p className="source-empty">
                      {list.length
                        ? 'No sources match this filter.'
                        : `No ${tab.toLowerCase()} in your library yet.`}
                    </p>
                  )}
                {tab === 'Newsletters' && (
                  <div className="source-empty">
                    <Checkbox
                      label="All newsletter senders"
                      checked={selected.some((source) => source.kind === 'newsletters')}
                      disabled={busy || !selected.some((source) => source.kind === 'newsletters')}
                      onChange={() =>
                        setSelected((current) =>
                          current.filter((source) => source.kind !== 'newsletters'),
                        )
                      }
                    />
                    <Badge tone="warning">
                      {caps.data?.inboundMail ? 'Set up Newsletters' : 'Needs mail add-on'}
                    </Badge>
                    <a href="/settings/runs#setup-newsletters">Set up Newsletters</a>
                  </div>
                )}
              </div>
            </div>
            {tab === 'Rules' && (
              <a className="source-manage" href="/?view=rules">
                Manage rules
              </a>
            )}
          </>
        )}
        <div className="source-detection-hint">
          <span>Paste a link and Brew looks for the feed:</span>
          {['YouTube channel', 'Subreddit', 'Mastodon', 'Bluesky', 'Podcast'].map((value) => (
            <Chip key={value} icon={<Icon name="link" size={14} />}>
              {value}
            </Chip>
          ))}
        </div>
        {notice && (
          <p className="source-message" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="source-error" role="alert">
            {error}
          </p>
        )}
        <input
          hidden
          type="file"
          accept=".opml,.xml,text/x-opml,text/xml,application/xml"
          aria-label="Import OPML file"
          ref={fileRef}
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void importOpml(file);
          }}
        />
      </div>
    </ModalSheet>
  );
}
