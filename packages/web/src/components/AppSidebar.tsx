import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { BrewConfig } from '@brew/core/types/brew';
import type { ReaderNavigation } from '@brew/core/types/api';
import { useCapabilities } from '../hooks/useCapabilities';
import { ModeChip } from './ModeChip';
import { runAssets } from './figmaAssets';
import { Badge } from './Badge';
import { capabilityRows } from '../settings/capabilityRows';

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Could not load the library');
  return response.json() as Promise<T>;
}

export function AppSidebar() {
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
  const [saved] = useState<Array<{ id: string; name: string; query: string }>>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('brew:saved-searches') ?? '[]');
      return Array.isArray(value)
        ? value.filter(
            (entry) => typeof entry?.name === 'string' && typeof entry?.query === 'string',
          )
        : [];
    } catch {
      return [];
    }
  });
  const [calm] = useState(() => localStorage.getItem('brew:calm') === 'true');
  const count = (value?: number) =>
    !calm && value !== undefined && value > 0 ? (
      <span className="runs-nav-count">{value}</span>
    ) : null;
  return (
    <aside className="runs-library">
      <header className="runs-library-header">
        <a className="runs-wordmark" href="/?view=brew" aria-label="Brew home">
          Brew
          <img src={runAssets.point} alt="" />
        </a>
        <ModeChip />
      </header>
      <form className="runs-search" action="/" role="search">
        <img src={runAssets.search} alt="" />
        <input type="hidden" name="view" value="reader" />
        <input aria-label="Search library" name="q" placeholder="Search" />
        <kbd>/</kbd>
      </form>
      <nav aria-label="Library" className="runs-library-nav">
        <div className="runs-nav-group">
          {configs.data?.length ? (
            configs.data.map((config) => (
              <a key={config.id} href={`/?view=brew&brew=${config.id}`}>
                <img src={runAssets.brew} alt="" />
                {config.name}
              </a>
            ))
          ) : (
            <a href="/?view=brew">
              <img src={runAssets.brew} alt="" />
              Brews
            </a>
          )}
        </div>
        <div className="runs-nav-group">
          {capabilities.data?.inboundMail ? (
            <a href="/letters">
              <img src={runAssets.inbox} alt="" />
              Newsletters
            </a>
          ) : (
            <div className="runs-newsletter-locked">
              <button disabled>
                <img src={runAssets.inbox} alt="" />
                Newsletters<Badge tone={newsletterState.tone}>{newsletterState.label}</Badge>
              </button>
              <a href="#setup-newsletters" aria-label="Set up Newsletters">
                Set up
              </a>
            </div>
          )}
          <a href="/?view=reader&scope=today">
            <img src={runAssets.calendar} alt="" />
            Today{count(navigation.data?.counts.today)}
          </a>
          <a href="/?view=reader&scope=all">
            <img src={runAssets.layers} alt="" />
            All articles{count(navigation.data?.counts.all)}
          </a>
          <a href="/?view=reader&scope=starred">
            <img src={runAssets.star} alt="" />
            Starred{count(navigation.data?.counts.starred)}
          </a>
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
        {saved.length > 0 && (
          <div className="runs-nav-group">
            <p className="runs-overline">Saved searches</p>
            {saved.map((item, index) => (
              <a key={item.id ?? index} href={`/?view=reader&q=${encodeURIComponent(item.query)}`}>
                <img src={runAssets.savedSearch} alt="" />
                {item.name}
              </a>
            ))}
          </div>
        )}
        <div className="runs-nav-bottom">
          <a href="/?view=rules">
            <img src={runAssets.rules} alt="" />
            Rules
          </a>
          <a href="/settings/runs" aria-current="page">
            <img src={runAssets.settings} alt="" />
            Settings
          </a>
          <p className="runs-library-status">
            <span aria-hidden="true">●</span>
            {navigation.isError ? 'Library unavailable' : 'Your own library'}
          </p>
        </div>
      </nav>
    </aside>
  );
}
