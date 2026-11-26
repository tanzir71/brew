import { agentPageHref } from './agentLocation';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { ModalSheet } from './components/Sheet';
import { OwnerActionConfirmation, OwnerActionResult } from './components/OwnerActionUi';
import { Badge } from './components/Badge';
import { Icon } from './components/Icon';
import { useCapabilities } from './hooks/useCapabilities';
import { articleDom } from './articleDom';
import { GmailForwardingDialog, SenderSettingsDialog } from './newsletters/Dialogs';
import { LetterPane } from './newsletters/LetterPane';
import { letterDate, senderInitial } from './newsletters/dates';
import { senderInNewsletterView } from '@brew/core/types/newsletters';
import {
  newsletterHref as baseNewsletterHref,
  newsletterListHref as baseNewsletterListHref,
  newsletterLocation,
  newsletterSenderRoute,
  type NewsletterLocation,
} from '@brew/core/app-pages';
import { usePageAlternates } from './hooks/usePageAlternates';
import { newsletterJson } from './newsletters/api';
import { useSenderActions } from './newsletters/useSenderActions';
import { SenderActions, SenderChangeReview } from './newsletters/SenderActions';

const newsletterHref = (route: NewsletterLocation) => agentPageHref(baseNewsletterHref(route));
const newsletterListHref = (route: NewsletterLocation) => agentPageHref(baseNewsletterListHref(route));
type Location = NewsletterLocation;
const currentLocation = () => newsletterLocation(new URL(location.href));
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
  const [senderMenuId, setSenderMenuId] = useState<number | null>(null);
  const senderMenuReturn = useRef<HTMLElement | null>(null);
  const settingsReturn = useRef<HTMLElement | null>(null);
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
    if (patch.letterId === null) next.letterSenderId = null;
    history.pushState(null, '', newsletterHref(next));
    setRoute(next);
  }, []);
  useEffect(() => {
    const pop = () => {
      const next = currentLocation();
      routeRef.current = next;
      setRoute(next);
      setMobilePane(next.letterId ? 'letter' : 'letters');
      setSenderMenuId(null);
      setSettingsId(null);
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
  const identitySender = route.letterSenderId ?? route.senderId;
  const senderMissing =
    overview.isSuccess &&
    identitySender !== null &&
    !overview.data.senders.some((sender) => sender.id === identitySender);
  const identityError = senderMissing
    ? 'Sender not found.'
    : route.letterId !== null && letter.data && letter.data.feedId !== route.letterSenderId
      ? 'This letter does not belong to the requested sender.'
      : '';
  usePageAlternates(identityError ? null : newsletterListHref(route), 'Newsletters list');
  const flow = useSenderActions(newsletterHref(route));
  const senderError = flow.error;
  const updateSender = (id: number, patch: NewsletterSettingsPatch, opener?: HTMLElement | null) =>
    flow.save(
      id,
      patch,
      overview.data?.senders.find((sender) => sender.id === id)?.title ?? 'sender',
      opener,
    );
  const openSettings = (id: number, opener?: HTMLElement | null) => {
    settingsReturn.current = opener ?? (document.activeElement as HTMLElement);
    setSenderMenuId(null);
    setSettingsId(id);
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
  const menuSender = overview.data?.senders.find((sender) => sender.id === senderMenuId);
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
  const destination = (patch: Partial<Location>) =>
    newsletterHref({
      ...route,
      ...patch,
      ...(patch.letterId === null ? { letterSenderId: null } : {}),
    });
  const follow = (
    event: MouseEvent<HTMLAnchorElement>,
    patch: Partial<Location>,
    pane?: 'senders' | 'letters' | 'letter',
  ) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(patch);
    if (pane) setMobilePane(pane);
  };
  const pageLink = (
    page: number,
    label: string,
    icon: 'chevron-left' | 'chevron-right',
    enabled: boolean,
  ) =>
    enabled ? (
      <a
        className="brew-icon-button"
        aria-label={label}
        href={destination({ page, letterId: null })}
        onClick={(event) => follow(event, { page, letterId: null }, 'letters')}
      >
        <Icon name={icon} size={16} />
      </a>
    ) : (
      <button type="button" className="brew-icon-button" aria-label={label} disabled>
        <Icon name={icon} size={16} />
      </button>
    );
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
            <h1 tabIndex={-1}>Newsletters</h1>
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
              <a
                className="brew-button brew-button--secondary brew-button--sm"
                href={destination({ letterId: null })}
                onClick={(event) => follow(event, { letterId: null }, 'letters')}
              >
                Back to letters
              </a>
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
              disabled={flow.busy}
              onClick={() =>
                void updateSender(senderError.id, senderError.patch).catch(() => undefined)
              }
            >
              Retry sender settings
            </button>
          </p>
        )}
        {flow.preparing && (
          <p role="status" className="letters-action-error">
            Reviewing sender settings…{' '}
            <Button size="sm" variant="secondary" onClick={flow.cancelPreview}>
              Cancel review
            </Button>
          </p>
        )}
        <OwnerActionResult action={flow.owner} showSetup={false} />
        {flow.owner.error && !flow.owner.intent && (
          <p className="letters-action-error">
            <a href={newsletterHref(route)}>Reload Newsletters</a>
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
              <nav className="letters-senders-list" aria-label="Newsletter senders">
                <a
                  className="letters-sender"
                  aria-current={route.senderId === null ? 'page' : undefined}
                  href={newsletterHref(newsletterSenderRoute(route, null))}
                  onClick={(event) => follow(event, newsletterSenderRoute(route, null), 'letters')}
                >
                  <Icon name="inbox" size={16} />
                  <span>All senders</span>
                  {!calm && <small>{viewUnread}</small>}
                </a>
                {senders.map((sender) => (
                  <div
                    key={sender.id}
                    className="letters-sender-row"
                    data-active={route.senderId === sender.id}
                    data-brew-kind="sender"
                    data-brew-id={sender.id}
                    data-brew-blocked={sender.settings.blocked}
                    data-brew-skipped={sender.settings.skipInbox}
                  >
                    <a
                      className="letters-sender"
                      data-skipped={sender.settings.skipInbox || sender.settings.blocked}
                      aria-current={route.senderId === sender.id ? 'page' : undefined}
                      href={newsletterHref(newsletterSenderRoute(route, sender))}
                      onClick={(event) =>
                        follow(event, newsletterSenderRoute(route, sender), 'letters')
                      }
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
                    </a>
                    <IconButton
                      icon="more"
                      label={`More actions for sender ${sender.title}`}
                      className="letters-sender-more"
                      data-brew-action="more"
                      data-brew-sender={sender.id}
                      aria-haspopup="dialog"
                      disabled={flow.busy}
                      onClick={(event) => {
                        senderMenuReturn.current = event.currentTarget;
                        setSenderMenuId(sender.id);
                      }}
                    />
                  </div>
                ))}
              </nav>
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
              {copied && (
                <p role="status" aria-label="Address result">
                  {copied}
                </p>
              )}
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
              <span aria-live="polite" aria-atomic="true" className={calm ? 'sr-only' : undefined}>
                {query.data ? `Showing ${range} of ${query.data.total}` : 'Loading…'}
              </span>
            </header>
            <div className="letters-list-scroll">
              {senderMissing ? (
                <p className="letters-empty" role="alert">
                  Sender not found. <a href="/letters">All senders</a>
                </p>
              ) : query.isPending ? (
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
                  <a
                    className="letters-row"
                    {...articleDom(item, 'letter')}
                    data-brew-action="open"
                    data-unread={!item.readAt}
                    key={item.id}
                    aria-current={
                      selectedId === item.id
                        ? route.letterId === null
                          ? 'true'
                          : 'page'
                        : undefined
                    }
                    aria-label={`Read ${item.title}`}
                    href={destination({ letterId: item.id, letterSenderId: item.feedId })}
                    onClick={(event) =>
                      follow(event, { letterId: item.id, letterSenderId: item.feedId }, 'letter')
                    }
                  >
                    <span className="letters-row-meta">
                      {!item.readAt && <span className="letters-unread" aria-label="Unread" />}
                      <Avatar id={item.feedId} initial={senderInitial(item.feedTitle)} />
                      <strong>{item.feedTitle}</strong>
                      <time dateTime={item.publishedAt}>{letterDate(item.publishedAt)}</time>
                    </span>
                    <strong className="letters-row-title">{item.title}</strong>
                    <span className="letters-row-excerpt">{item.excerpt}</span>
                  </a>
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
                      onClick={(event) => openSettings(emptySender.id, event.currentTarget)}
                    >
                      Sender settings
                    </Button>
                  )}
                </div>
              )}
            </div>
            {query.data && query.data.total > query.data.pageSize && (
              <nav className="letters-pagination" aria-label="Letter pages">
                {pageLink(route.page - 1, 'Previous letters', 'chevron-left', route.page > 1)}
                <span>
                  Page {route.page} of {Math.ceil(query.data.total / query.data.pageSize)}
                </span>
                {pageLink(
                  route.page + 1,
                  'Next letters',
                  'chevron-right',
                  route.page * query.data.pageSize < query.data.total,
                )}
              </nav>
            )}
          </section>
          {identityError ? (
            <section className="letters-letter letters-empty" role="alert">
              <p>{identityError}</p>
              <a
                href={newsletterListHref({
                  ...route,
                  senderId: senderMissing ? null : route.senderId,
                })}
                onClick={(event) =>
                  follow(
                    event,
                    { senderId: senderMissing ? null : route.senderId, letterId: null },
                    'letters',
                  )
                }
              >
                Back to letters
              </a>
            </section>
          ) : !selectedId ? (
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
              <a
                href={destination({ letterId: null })}
                onClick={(event) => follow(event, { letterId: null }, 'letters')}
              >
                Back to letters
              </a>
            </section>
          ) : (
            <LetterPane
              key={letter.data.id}
              letter={letter.data}
              overview={overview.data}
              explicitOpen={route.letterId === letter.data.id}
              pending={flow.busy}
              capable={flow.capable}
              senderHref={newsletterHref(newsletterSenderRoute(route, letter.data.sender))}
              saveSender={(patch, opener) => updateSender(letter.data.sender.id, patch, opener)}
              settings={(opener) => openSettings(letter.data.sender.id, opener)}
            />
          )}
        </div>
      </main>
      {gmail && <GmailForwardingDialog address={address} close={() => setGmail(false)} />}
      <ModalSheet
        open={Boolean(menuSender)}
        title="Sender actions"
        onClose={() => setSenderMenuId(null)}
        returnFocusRef={senderMenuReturn}
      >
        {menuSender && (
          <>
            <p className="mb-4">{menuSender.title}</p>
            <SenderActions
              sender={menuSender}
              brewAvailable={Boolean(
                overview.data?.brews.some((brew) => brew.id === menuSender.settings.brewId),
              )}
              capable={flow.capable}
              pending={flow.busy}
              href={newsletterHref(newsletterSenderRoute(route, menuSender))}
              settings={() => openSettings(menuSender.id, senderMenuReturn.current)}
              save={(patch) => {
                setSenderMenuId(null);
                void updateSender(menuSender.id, patch, senderMenuReturn.current).catch(
                  () => undefined,
                );
              }}
            />
          </>
        )}
      </ModalSheet>
      {settingSender && (
        <SenderSettingsDialog
          key={settingSender.id}
          sender={settingSender}
          brews={overview.data?.brews ?? []}
          save={(patch) => updateSender(settingSender.id, patch)}
          close={() => {
            flow.clearError();
            setSettingsId(null);
          }}
          returnFocusRef={settingsReturn}
          capable={flow.capable}
          reviewing={flow.preparing}
          cancelReview={flow.cancelPreview}
        />
      )}
      <OwnerActionConfirmation action={flow.owner} returnFocusRef={flow.returnFocus}>
        {flow.preview && <SenderChangeReview preview={flow.preview} />}
      </OwnerActionConfirmation>
    </div>
  );
}
