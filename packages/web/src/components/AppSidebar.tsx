import { useWebMcpSurface } from '../webmcp/useWebMcpSurface';
import { agentPageHref } from '../agentLocation';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useId, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { BrewConfig } from '@brew/core/types/legacy-brew';
import type { ReaderNavigation } from '@brew/core/types/api';
import type { NewsletterOverview } from '@brew/core/types/newsletters';
import { useCapabilities } from '../hooks/useCapabilities';
import { ModeChip } from './ModeChip';
import { Avatar, IconButton, Kbd, NavItem, Wordmark } from './controls';
import { runAssets } from './figmaAssets';
import { Badge } from './Badge';
import { capabilityRows } from '../settings/capabilityRows';
import { useSavedSearches } from '../hooks/useSavedSearches';
import { SavedSearchList } from './SavedSearches';
import { parseReaderPage } from '@brew/core/reader-pages';
import { navigateReader, searchHref } from '../readerLocation';

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Could not load the library');
  return response.json() as Promise<T>;
}

function sidebarCollapsed() {
  try {
    return localStorage.getItem('brew:sidebar-collapsed') === 'true';
  } catch {
    return false;
  }
}

export function AppSidebar({
  activeHref = location.pathname + location.search,
  label,
  detailedLibrary = false,
  savedSearches: sharedSearches,
  navigationRef,
}: {
  activeHref?: string;
  label?: string;
  detailedLibrary?: boolean;
  savedSearches?: ReturnType<typeof useSavedSearches>;
  navigationRef?: Ref<HTMLElement>;
}) {
  const activeUrl = new URL(activeHref, location.origin);
  activeUrl.searchParams.delete('agent');
  activeHref = activeUrl.pathname + activeUrl.search;
  const readerRoute = parseReaderPage(activeUrl);
  const search = useRef<HTMLInputElement>(null);
  const sidebarId = useId();
  const [collapsed, setCollapsed] = useState(sidebarCollapsed);
  const [sidebarNotice, setSidebarNotice] = useState('');
  const changeSidebar = useCallback((value: boolean) => {
    setCollapsed(value);
    try {
      localStorage.setItem('brew:sidebar-collapsed', String(value));
      setSidebarNotice('');
    } catch {
      setSidebarNotice(
        'Sidebar changed for this page. Browser storage could not save this choice.',
      );
    }
  }, []);
  useLayoutEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.key !== '/' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.isContentEditable ||
        target?.closest('input, textarea, select')
      )
        return;
      event.preventDefault();
      changeSidebar(false);
      requestAnimationFrame(() => search.current?.focus());
    };
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'brew:sidebar-collapsed')
        setCollapsed(sidebarCollapsed());
    };
    window.addEventListener('keydown', focusSearch);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('keydown', focusSearch);
      window.removeEventListener('storage', storage);
    };
  }, [changeSidebar]);
  const capabilities = useCapabilities();
  const newsletterState = capabilityRows(capabilities.data, capabilities.isError).find(
    (row) => row.id === 'newsletters',
  )!;
  const configs = useQuery({
    queryKey: ['brew-configs'],
    queryFn: ({ signal }) => getJson<BrewConfig[]>('/api/brew-configs', signal),
  });
  const navigation = useQuery({
    queryKey: ['reader-navigation'],
    queryFn: ({ signal }) => getJson<ReaderNavigation>('/api/reader/navigation', signal),
  });
  const newsletters = useQuery({
    queryKey: ['newsletter-overview'],
    queryFn: ({ signal }) => getJson<NewsletterOverview>('/api/newsletters/overview', signal),
  });
  useWebMcpSurface(
    search,
    { names: ['search_items', ...(!configs.isPending && !configs.isError ? ['list_brews'] : [])] },
    !collapsed,
  );
  const localSaved = useSavedSearches();
  const saved = sharedSearches ?? localSaved;
  const newsletterFeedIds = new Set(newsletters.data?.senders?.map((sender) => sender.id) ?? []);
  const unfiled = navigation.data?.unfiled.filter((feed) => !newsletterFeedIds.has(feed.id)) ?? [];
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [calm] = useState(() => localStorage.getItem('brew:calm') === 'true');
  const count = (value?: number) =>
    !calm && value !== undefined && value > 0 ? (
      <span className="runs-nav-count">{value}</span>
    ) : null;
  return (
    <aside className="runs-library" aria-label={label} data-collapsed={collapsed}>
      <header className="runs-library-header">
        <a className="runs-wordmark" href={agentPageHref('/?view=brew')} aria-label="Brew home">
          <Wordmark />
        </a>
        <ModeChip />
        <IconButton
          className="runs-sidebar-toggle"
          icon={collapsed ? 'chevron-right' : 'chevron-left'}
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          aria-controls={sidebarId}
          data-brew-action="toggle-sidebar"
          onClick={() => changeSidebar(!collapsed)}
        />
      </header>
      <p className="sr-only runs-sidebar-notice" role="status">
        {sidebarNotice}
      </p>
      <form
        className="runs-search"
        action="/"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const query = search.current?.value.trim() ?? '';
          if (query) navigateReader(searchHref(query));
        }}
      >
        <img src={runAssets.search} alt="" />
        <input type="hidden" name="view" value="reader" />
        {new URLSearchParams(location.search).get('agent') === '1' && (
          <input type="hidden" name="agent" value="1" />
        )}
        <input
          ref={search}
          key={activeUrl.searchParams.get('q') ?? ''}
          defaultValue={activeUrl.searchParams.get('q') ?? ''}
          aria-label="Search library"
          name="q"
          placeholder="Search"
        />
        <Kbd>/</Kbd>
      </form>
      <nav
        id={sidebarId}
        ref={navigationRef}
        tabIndex={navigationRef ? -1 : undefined}
        aria-label="Library"
        className="runs-library-nav"
        onClick={(event) => {
          if (
            label !== 'Reader navigation' ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          const anchor = (event.target as Element).closest('a');
          if (!anchor) return;
          const target = new URL(anchor.href);
          if (target.origin !== location.origin || !parseReaderPage(target)) return;
          event.preventDefault();
          navigateReader(target.pathname + target.search);
        }}
      >
        <div className="runs-nav-group">
          {configs.data?.length ? (
            configs.data.map((config) => (
              <NavItem
                key={config.id}
                href={`/?view=brew&brew=${config.id}`}
                active={activeHref === `/?view=brew&brew=${config.id}`}
                icon={<img src={runAssets.brew} alt="" />}
              >
                {config.name}
              </NavItem>
            ))
          ) : (
            <a href={agentPageHref('/?view=brew')}>
              <img src={runAssets.brew} alt="" />
              Brews
            </a>
          )}
        </div>
        <div className="runs-nav-group">
          {capabilities.data?.inboundMail ||
          activeHref.startsWith('/letters') ||
          newsletters.data?.senders.length ? (
            <NavItem
              href="/letters"
              active={activeHref.startsWith('/letters')}
              icon={<img src={runAssets.inbox} alt="" />}
              calm={calm}
              count={newsletters.data?.unreadCount}
            >
              Newsletters
            </NavItem>
          ) : (
            <div className="runs-newsletter-locked">
              <button disabled>
                <img src={runAssets.inbox} alt="" />
                Newsletters<Badge tone={newsletterState.tone}>{newsletterState.label}</Badge>
              </button>
              <a
                href={
                  location.pathname === '/settings/runs'
                    ? '#setup-newsletters'
                    : '/settings/runs#setup-newsletters'
                }
                aria-label="Set up Newsletters"
              >
                Set up
              </a>
            </div>
          )}
          <NavItem
            href="/?view=reader&scope=today"
            active={readerRoute?.kind === 'today'}
            icon={<img src={runAssets.calendar} alt="" />}
            calm={calm}
            count={navigation.data?.counts.today}
          >
            Today
          </NavItem>
          <NavItem
            href="/?view=reader&scope=all"
            active={readerRoute?.kind === 'all'}
            icon={<img src={runAssets.layers} alt="" />}
            calm={calm}
            count={navigation.data?.counts.all}
          >
            All articles
          </NavItem>
          <NavItem
            href="/?view=reader&scope=starred"
            active={readerRoute?.kind === 'starred'}
            icon={<img src={runAssets.star} alt="" />}
            calm={calm}
            count={navigation.data?.counts.starred}
          >
            Starred
          </NavItem>
        </div>
        <div className="runs-nav-group">
          <p className="runs-overline">Folders</p>
          {navigation.data?.folders.map((folder) => (
            <div key={folder.id} className="library-folder">
              <div className="library-folder-row">
                <a
                  href={agentPageHref(
                    `/?view=reader&folder=${folder.id}&name=${encodeURIComponent(folder.title)}`,
                  )}
                  aria-current={
                    readerRoute?.kind === 'folder' && readerRoute.id === folder.id
                      ? 'page'
                      : undefined
                  }
                  className={
                    readerRoute?.kind === 'folder' && readerRoute.id === folder.id
                      ? 'brew-nav-item--active'
                      : undefined
                  }
                >
                  <img src={runAssets.folder} alt="" />
                  {folder.title}
                  {count(folder.unreadCount)}
                </a>
                {detailedLibrary && folder.feeds.length > 0 && (
                  <IconButton
                    icon={expanded.has(folder.id) ? 'chevron-down' : 'chevron-right'}
                    label={`${expanded.has(folder.id) ? 'Collapse' : 'Expand'} ${folder.title} folder`}
                    aria-expanded={expanded.has(folder.id)}
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(folder.id)) next.delete(folder.id);
                        else next.add(folder.id);
                        return next;
                      })
                    }
                  />
                )}
              </div>
              {detailedLibrary &&
                expanded.has(folder.id) &&
                folder.feeds.map((feed) => (
                  <NavItem
                    key={feed.id}
                    href={`/?view=reader&feed=${feed.id}`}
                    active={readerRoute?.kind === 'feed' && readerRoute.id === feed.id}
                    count={feed.unreadCount}
                    icon={<Avatar id={feed.id} initial={feed.title} />}
                  >
                    {feed.title}
                  </NavItem>
                ))}
            </div>
          ))}
          {!navigation.data?.folders.length && (
            <a href={agentPageHref('/?view=feeds')}>
              <img src={runAssets.folder} alt="" />
              Add a feed
            </a>
          )}
        </div>
        {detailedLibrary && unfiled.length > 0 && (
          <div className="runs-nav-group">
            <p className="runs-overline">Unfiled</p>
            {unfiled.map((feed) => (
              <NavItem
                key={feed.id}
                href={`/?view=reader&feed=${feed.id}`}
                active={readerRoute?.kind === 'feed' && readerRoute.id === feed.id}
                count={feed.unreadCount}
                icon={<Avatar id={feed.id} initial={feed.title} />}
              >
                {feed.title}
              </NavItem>
            ))}
          </div>
        )}
        <SavedSearchList action={saved} />
        <div className="runs-nav-bottom">
          <a
            href={agentPageHref('/rules')}
            aria-current={
              activeHref.startsWith('/rules') || activeUrl.searchParams.get('view') === 'rules'
                ? 'page'
                : undefined
            }
            className={
              activeHref.startsWith('/rules') || activeUrl.searchParams.get('view') === 'rules'
                ? 'brew-nav-item--active'
                : undefined
            }
          >
            <img src={runAssets.rules} alt="" />
            Rules
          </a>
          <NavItem
            href="/settings/runs"
            active={activeHref === '/settings/runs'}
            icon={<img src={runAssets.settings} alt="" />}
          >
            Settings
          </NavItem>
          <p className="runs-library-status">
            <span aria-hidden="true">●</span>
            {navigation.isError ? 'Library unavailable' : 'Your own library'}
          </p>
        </div>
      </nav>
    </aside>
  );
}
