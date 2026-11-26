import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';
import type { BrewConfig } from '@brew/core/types/legacy-brew';
import type { ReaderNavigation } from '@brew/core/types/api';
import type { NewsletterOverview } from '@brew/core/types/newsletters';
import { useCapabilities } from '../hooks/useCapabilities';
import { ModeChip } from './ModeChip';
import { Kbd, NavItem, Wordmark } from './controls';
import { runAssets } from './figmaAssets';
import { Badge } from './Badge';
import { capabilityRows } from '../settings/capabilityRows';
import { useSavedSearches } from '../hooks/useSavedSearches';
import { savedSearchHref } from '../savedSearches';

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Could not load the library');
  return response.json() as Promise<T>;
}

export function AppSidebar({
  activeHref = location.pathname + location.search,
}: {
  activeHref?: string;
}) {
  const search = useRef<HTMLInputElement>(null);
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
      search.current?.focus();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);
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
  const saved = useSavedSearches();
  const [calm] = useState(() => localStorage.getItem('brew:calm') === 'true');
  const count = (value?: number) =>
    !calm && value !== undefined && value > 0 ? (
      <span className="runs-nav-count">{value}</span>
    ) : null;
  return (
    <aside className="runs-library">
      <header className="runs-library-header">
        <a className="runs-wordmark" href="/?view=brew" aria-label="Brew home">
          <Wordmark />
        </a>
        <ModeChip />
      </header>
      <form className="runs-search" action="/" role="search">
        <img src={runAssets.search} alt="" />
        <input type="hidden" name="view" value="reader" />
        <input ref={search} aria-label="Search library" name="q" placeholder="Search" />
        <Kbd>/</Kbd>
      </form>
      <nav aria-label="Library" className="runs-library-nav">
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
            <a href="/?view=brew">
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
            active={activeHref === '/?view=reader&scope=today'}
            icon={<img src={runAssets.calendar} alt="" />}
            calm={calm}
            count={navigation.data?.counts.today}
          >
            Today
          </NavItem>
          <NavItem
            href="/?view=reader&scope=all"
            active={activeHref === '/?view=reader&scope=all'}
            icon={<img src={runAssets.layers} alt="" />}
            calm={calm}
            count={navigation.data?.counts.all}
          >
            All articles
          </NavItem>
          <NavItem
            href="/?view=reader&scope=starred"
            active={activeHref === '/?view=reader&scope=starred'}
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
            <a
              key={folder.id}
              href={`/?view=reader&folder=${folder.id}&name=${encodeURIComponent(folder.title)}`}
            >
              <img src={runAssets.folder} alt="" />
              {folder.title}
              {count(folder.unreadCount)}
            </a>
          ))}
          {!navigation.data?.folders.length && (
            <a href="/?view=feeds">
              <img src={runAssets.folder} alt="" />
              Add a feed
            </a>
          )}
        </div>
        {saved.searches.length > 0 && (
          <div className="runs-nav-group">
            <p className="runs-overline">Saved searches</p>
            {saved.searches.map((item) => (
              <a key={item.id} href={savedSearchHref(item)}>
                <img src={runAssets.savedSearch} alt="" />
                {item.name}
              </a>
            ))}
          </div>
        )}
        {saved.loadError && (
          <div role="alert">
            <p>{saved.loadError}</p>
            <button type="button" onClick={saved.refresh}>
              Retry saved searches
            </button>
          </div>
        )}
        <div className="runs-nav-bottom">
          <a href="/?view=rules">
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
