import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NewsletterLetter,
  NewsletterLetterPage,
  NewsletterOverview,
  NewsletterSender,
  NewsletterSettingsPatch,
  NewsletterView,
} from '@brew/core/types/newsletters';
import type { Capabilities } from '@brew/core/types/capabilities';
import { AppSidebar } from './components/AppSidebar';
import { Avatar, Button, IconButton, SegmentedControl } from './components/controls';
import { Badge } from './components/Badge';
import { Icon } from './components/Icon';
import { useCapabilities } from './hooks/useCapabilities';
import { GmailForwardingDialog, SenderSettingsDialog } from './newsletters/Dialogs';
import { LetterPane } from './newsletters/LetterPane';
import { letterDate, senderInitial } from './newsletters/dates';
import { senderInNewsletterView } from '@brew/core/types/newsletters';
import { newsletterJson, newsletterRefreshKeys } from './newsletters/api';

type Location = {
  view: NewsletterView;
  senderId: number | null;
  letterId: number | null;
  page: number;
  sort: 'recent' | 'name' | 'unread';
};
function currentLocation(): Location {
  const params = new URLSearchParams(location.search);
  const positive = (value: string | null | undefined) =>
    value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const view = params.get('view');
  const sort = params.get('sort');
  return {
    view: ['favorites', 'skipped', 'blocked'].includes(view ?? '')
      ? (view as NewsletterView)
      : 'inbox',
    senderId: positive(params.get('sender')),
    letterId: positive(location.pathname.match(/^\/letters\/([1-9]\d*)\/?$/)?.[1]),
    page: positive(params.get('page')) ?? 1,
    sort: sort === 'name' || sort === 'unread' ? sort : 'recent',
  };
}
const mailDescriptions: Record<NonNullable<Capabilities['inboundMail']>, string> = {
  'cloudflare-email':
    'Subscribe to newsletters with this address. Mail arrives through Cloudflare Email Routing.',
  imap: 'Subscribe to newsletters with this address. Brew checks your dedicated mailbox.',
  webhook: 'Subscribe to newsletters with this address. Your mail provider forwards letters here.',
  'email-to-feed': 'Subscribe to your private email-to-feed URL through Add source.',
};

export function NewslettersPage() {
  const client = useQueryClient();
  const [route, setRoute] = useState(currentLocation);
  const routeRef = useRef(route);
  const [mobilePane, setMobilePane] = useState<'senders' | 'letters' | 'letter'>(() =>
    route.letterId ? 'letter' : 'letters',
  );
  const [gmail, setGmail] = useState(false);
  const [settingsId, setSettingsId] = useState<number | null>(null);
  const [copied, setCopied] = useState('');
  const [senderError, setSenderError] = useState<{
    id: number;
    patch: NewsletterSettingsPatch;
    message: string;
  } | null>(null);
  const calm = localStorage.getItem('brew:calm') === 'true';
  const caps = useCapabilities();
  const overview = useQuery({
    queryKey: ['newsletter-overview'],
    queryFn: ({ signal }) =>
      newsletterJson<NewsletterOverview>('/api/newsletters/overview', signal),
  });
  const mailbox = useQuery({
    queryKey: ['source-mailbox'],
    queryFn: ({ signal }) =>
      newsletterJson<{ address: string | null }>('/api/sources/mailbox', signal),
  });
  const navigate = useCallback((patch: Partial<Location>) => {
    const next = { ...routeRef.current, ...patch };
    routeRef.current = next;
    const params = new URLSearchParams();
    if (next.view !== 'inbox') params.set('view', next.view);
    if (next.senderId) params.set('sender', String(next.senderId));
    if (next.page > 1) params.set('page', String(next.page));
    if (next.sort !== 'recent') params.set('sort', next.sort);
    history.pushState(
      null,
      '',
      `/letters${next.letterId ? `/${next.letterId}` : ''}${params.size ? `?${params}` : ''}`,
    );
    setRoute(next);
  }, []);
  useEffect(() => {
    const pop = () => {
      const next = currentLocation();
      routeRef.current = next;
      setRoute(next);
      setMobilePane(next.letterId ? 'letter' : 'letters');
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    const events = new EventSource('/api/events');
    const refresh = () => {
      for (const key of ['newsletter-overview', 'newsletter-letters', 'reader-navigation'])
        void client.invalidateQueries({ queryKey: [key] });
    };
    events.addEventListener('article:new', refresh);
    return () => events.close();
  }, [client]);
  const query = useQuery({
    queryKey: ['newsletter-letters', route.view, route.senderId, route.page],
    queryFn: ({ signal }) =>
      newsletterJson<NewsletterLetterPage>(
        `/api/newsletters/letters?view=${route.view}&page=${route.page}${route.senderId ? `&sender=${route.senderId}` : ''}`,
        signal,
      ),
  });
  const selectedId = route.letterId ?? query.data?.items[0]?.id;
  const letter = useQuery({
    queryKey: ['newsletter-letter', selectedId],
    enabled: !!selectedId,
    queryFn: ({ signal }) =>
      newsletterJson<NewsletterLetter>(`/api/newsletters/letters/${selectedId}`, signal),
  });
  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: NewsletterSettingsPatch }) =>
      newsletterJson<NewsletterSender>(`/api/newsletters/senders/${id}`, undefined, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onMutate: () => setSenderError(null),
    onError: (error, value) => setSenderError({ ...value, message: error.message }),
    onSuccess: async (sender) => {
      client.setQueriesData<NewsletterLetter>({ queryKey: ['newsletter-letter'] }, (current) =>
        current?.feedId === sender.id ? { ...current, sender } : current,
      );
      await Promise.all(
        newsletterRefreshKeys.map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
  const updateSender = async (id: number, patch: NewsletterSettingsPatch) => {
    await mutation.mutateAsync({ id, patch });
  };
  const senders = useMemo(
    () =>
      [...(overview.data?.senders ?? [])].sort((a, b) => {
        const weight = (sender: NewsletterSender) =>
          sender.settings.blocked ? 2 : sender.settings.skipInbox ? 1 : 0;
        return (
          weight(a) - weight(b) ||
          (route.sort === 'name'
            ? a.title.localeCompare(b.title)
            : route.sort === 'unread'
              ? b.unreadCount - a.unreadCount
              : (b.latestAt ? Date.parse(b.latestAt) : 0) -
                (a.latestAt ? Date.parse(a.latestAt) : 0)) ||
          a.title.localeCompare(b.title)
        );
      }),
    [overview.data?.senders, route.sort],
  );
  const settingSender =
    overview.data?.senders.find((sender) => sender.id === settingsId) ??
    (letter.data?.sender.id === settingsId ? letter.data.sender : undefined);
  const emptySender = overview.data?.senders.find((sender) => sender.id === route.senderId);
  const mechanism = caps.data?.inboundMail;
  const address =
    mechanism && mechanism !== 'email-to-feed' && !caps.isError && !mailbox.isError
      ? (mailbox.data?.address ?? null)
      : null;
  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied('Address copied');
    } catch {
      setCopied('Could not copy. Select the address below and copy it.');
    }
  };
  const selectSender = (sender: NewsletterSender | null) => {
    const view = !sender
      ? route.view
      : sender.settings.blocked
        ? 'blocked'
        : sender.settings.skipInbox
          ? 'skipped'
          : route.view === 'favorites' && sender.settings.favorite
            ? 'favorites'
            : 'inbox';
    navigate({ senderId: sender?.id ?? null, view, page: 1, letterId: null });
    setMobilePane('letters');
  };
  const viewUnread = senders
    .filter((sender) => senderInNewsletterView(sender.settings, route.view))
    .reduce((sum, sender) => sum + sender.unreadCount, 0);
  const range = query.data?.total
    ? `${(route.page - 1) * query.data.pageSize + 1}–${Math.min(route.page * query.data.pageSize, query.data.total)}`
    : '0';
  return (
    <div className="runs-app letters-app" data-mobile-pane={mobilePane}>
      <AppSidebar activeHref="/letters" />
      <main className="letters-main" aria-label="Newsletters">
        <header className="letters-topbar">
          <div className="letters-topbar-title">
            <Icon name="inbox" size={18} />
            <h1>Newsletters</h1>
            {!calm && <span>{viewUnread} unread</span>}
          </div>
          <span className="letters-spacer" />
          <SegmentedControl
            label="Newsletter view"
            options={[
              { value: 'inbox', label: 'Inbox' },
              { value: 'favorites', label: 'Favorites' },
              { value: 'skipped', label: 'Skipped' },
              { value: 'blocked', label: 'Blocked' },
            ]}
            value={route.view}
            onValueChange={(view) => {
              navigate({ view: view as NewsletterView, senderId: null, letterId: null, page: 1 });
              setMobilePane('letters');
            }}
          />
          <span className="letters-spacer" />
          <button
            className="letters-header-address"
            disabled={!address}
            onClick={() => void copy()}
            aria-label="Copy Brew address"
          >
            <Icon name="mail" size={14} />
            <code>
              {address ?? (mechanism === 'email-to-feed' ? 'Email-to-feed URL' : 'Connect mail')}
            </code>
            <Icon name="copy" size={14} />
          </button>
          <div className="letters-mobile-nav">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMobilePane(mobilePane === 'senders' ? 'letters' : 'senders')}
            >
              {mobilePane === 'senders' ? 'Back to letters' : 'Senders'}
            </Button>
            {mobilePane === 'letter' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigate({ letterId: null });
                  setMobilePane('letters');
                }}
              >
                Back to letters
              </Button>
            )}
          </div>
        </header>
        {senderError && (
          <p className="letters-action-error" role="alert">
            Could not save{' '}
            {overview.data?.senders.find((sender) => sender.id === senderError.id)?.title ??
              'sender'}
            : {senderError.message}{' '}
            <button
              disabled={mutation.isPending}
              onClick={() =>
                void updateSender(senderError.id, senderError.patch).catch(() => undefined)
              }
            >
              Retry sender settings
            </button>
          </p>
        )}
        <div className="letters-panes">
          <aside className="letters-senders" aria-label="Newsletter senders">
            <div className="letters-senders-heading">
              <span>Senders</span>
              <label>
                Sort:{' '}
                <select
                  aria-label="Sort senders"
                  value={route.sort}
                  onChange={(event) => navigate({ sort: event.target.value as Location['sort'] })}
                >
                  <option value="recent">recent</option>
                  <option value="name">name</option>
                  <option value="unread">unread</option>
                </select>
              </label>
            </div>
            {overview.isError ? (
              <p role="alert">
                Could not load senders.{' '}
                <button onClick={() => void overview.refetch()}>Retry senders</button>
              </p>
            ) : overview.isPending ? (
              <p role="status">Loading senders…</p>
            ) : (
              <div className="letters-senders-list">
                <button
                  className="letters-sender"
                  aria-pressed={!route.senderId}
                  onClick={() => selectSender(null)}
                >
                  <Icon name="inbox" size={16} />
                  <span>All senders</span>
                  {!calm && <small>{viewUnread}</small>}
                </button>
                {senders.map((sender) => (
                  <button
                    key={sender.id}
                    className="letters-sender"
                    data-skipped={sender.settings.skipInbox || sender.settings.blocked}
                    aria-pressed={route.senderId === sender.id}
                    onClick={() => selectSender(sender)}
                  >
                    <Avatar id={sender.id} initial={senderInitial(sender.title)} />
                    <span>{sender.title}</span>
                    {sender.settings.favorite && <Icon name="star" size={12} />}
                    <small>
                      {sender.settings.blocked
                        ? 'Blocked'
                        : sender.settings.skipInbox
                          ? 'Skipped'
                          : !calm && sender.unreadCount > 0
                            ? sender.unreadCount
                            : ''}
                    </small>
                  </button>
                ))}
              </div>
            )}
            <section className="letters-address-card" aria-label="Your Brew address">
              <h2>Your Brew address</h2>
              <button
                className="letters-card-copy"
                disabled={!address}
                onClick={() => void copy()}
                aria-label="Copy receiving address"
              >
                <code>{address ?? 'Not connected'}</code>
                <Icon name="copy" size={14} />
              </button>
              <p>
                {mechanism
                  ? mailDescriptions[mechanism]
                  : 'Connect a mailbox or mail provider to receive letters at your own address.'}
              </p>
              <div className="letters-address-footer">
                <Badge tone={address ? 'positive' : 'warning'}>
                  {address
                    ? 'Works here'
                    : mailbox.isError || caps.isError
                      ? 'Address unavailable'
                      : mechanism === 'email-to-feed'
                        ? 'Needs a feed URL'
                        : 'Needs mail add-on'}
                </Badge>
                <button onClick={() => setGmail(true)}>Forward from Gmail</button>
              </div>
              {!address && <a href="/settings/runs#setup-newsletters">Set up mail</a>}
              {(mailbox.isError || caps.isError) && (
                <button
                  onClick={() => {
                    void mailbox.refetch();
                    void caps.refetch();
                  }}
                >
                  Retry connection
                </button>
              )}
              {copied && <p role="status">{copied}</p>}
            </section>
          </aside>
          <section className="letters-list" aria-label="Letters">
            <header className="letters-list-heading">
              <span>
                {query.data?.items[0] &&
                letterDate(query.data.items[0].publishedAt, true).startsWith('Today ')
                  ? 'Today'
                  : 'Letters'}
              </span>
              {!calm && (
                <span>{query.data ? `Showing ${range} of ${query.data.total}` : 'Loading…'}</span>
              )}
            </header>
            <div className="letters-list-scroll">
              {query.isPending ? (
                <p className="letters-empty" role="status">
                  Loading letters…
                </p>
              ) : query.isError ? (
                <p className="letters-empty" role="alert">
                  Could not load letters.{' '}
                  <button onClick={() => void query.refetch()}>Retry letters</button>
                </p>
              ) : query.data.items.length ? (
                query.data.items.map((item) => (
                  <button
                    className="letters-row"
                    data-unread={!item.readAt}
                    key={item.id}
                    aria-pressed={selectedId === item.id}
                    aria-label={`Read ${item.title}`}
                    onClick={() => {
                      navigate({ letterId: item.id });
                      setMobilePane('letter');
                    }}
                  >
                    <span className="letters-row-meta">
                      {!item.readAt && <span className="letters-unread" aria-label="Unread" />}
                      <Avatar id={item.feedId} initial={senderInitial(item.feedTitle)} />
                      <strong>{item.feedTitle}</strong>
                      <time dateTime={item.publishedAt}>{letterDate(item.publishedAt)}</time>
                    </span>
                    <strong className="letters-row-title">{item.title}</strong>
                    <span className="letters-row-excerpt">{item.excerpt}</span>
                  </button>
                ))
              ) : (
                <div className="letters-empty">
                  <h2>No letters in {route.view === 'inbox' ? 'your Inbox' : route.view}</h2>
                  <p>
                    {route.view === 'inbox'
                      ? address
                        ? 'Subscribe with your Brew address to receive your first letter.'
                        : 'Connect mail, then subscribe with your receiving address.'
                      : 'Choose another sender or view.'}
                  </p>
                  {emptySender && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSettingsId(emptySender.id)}
                    >
                      Sender settings
                    </Button>
                  )}
                </div>
              )}
            </div>
            {query.data && query.data.total > query.data.pageSize && (
              <nav className="letters-pagination" aria-label="Letter pages">
                <IconButton
                  label="Previous letters"
                  icon="chevron-left"
                  disabled={route.page === 1}
                  onClick={() => navigate({ page: route.page - 1, letterId: null })}
                />
                <span>
                  Page {route.page} of {Math.ceil(query.data.total / query.data.pageSize)}
                </span>
                <IconButton
                  label="Next letters"
                  icon="chevron-right"
                  disabled={route.page * query.data.pageSize >= query.data.total}
                  onClick={() => navigate({ page: route.page + 1, letterId: null })}
                />
              </nav>
            )}
          </section>
          {!selectedId ? (
            <section className="letters-letter letters-empty" aria-label="Letter reading pane">
              <Icon name="mail" size={24} />
              <h2>Your letters, cleaned up</h2>
              <p>Choose a letter to read it here.</p>
              {!address && <a href="/settings/runs#setup-newsletters">Set up mail</a>}
            </section>
          ) : overview.isError ? (
            <section className="letters-letter letters-empty" role="alert">
              Could not load sender details.{' '}
              <button onClick={() => void overview.refetch()}>Retry sender details</button>
            </section>
          ) : letter.isPending || !overview.data ? (
            <section className="letters-letter letters-empty" role="status">
              Loading letter…
            </section>
          ) : letter.isError ? (
            <section className="letters-letter letters-empty" role="alert">
              <p>{letter.error.message}</p>
              <Button variant="secondary" onClick={() => void letter.refetch()}>
                Retry letter
              </Button>
              <button onClick={() => navigate({ letterId: null })}>Back to letters</button>
            </section>
          ) : (
            <LetterPane
              key={letter.data.id}
              letter={letter.data}
              overview={overview.data}
              explicitOpen={route.letterId === letter.data.id}
              pending={mutation.isPending}
              saveSender={(patch) => updateSender(letter.data.sender.id, patch)}
              settings={() => setSettingsId(letter.data.sender.id)}
            />
          )}
        </div>
      </main>
      {gmail && <GmailForwardingDialog address={address} close={() => setGmail(false)} />}
      {settingSender && (
        <SenderSettingsDialog
          key={settingSender.id}
          sender={settingSender}
          brews={overview.data?.brews ?? []}
          save={(patch) => updateSender(settingSender.id, patch)}
          close={() => setSettingsId(null)}
        />
      )}
    </div>
  );
}
