import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { brewIssuePath } from '@brew/core/brew-output-paths';
import type { BrewConfig, BrewIssue } from '@brew/core/types/brew';
import { useCapabilities } from '../hooks/useCapabilities';
import { Icon } from '../components/Icon';
import { Badge } from '../components/Badge';
import { composeJson } from './useComposeDraft';

export function BrewFormats({ snapshot }: { snapshot: BrewIssue }) {
  const caps = useCapabilities();
  const twins = Boolean(caps.data?.outputs?.twins);
  const feeds = Boolean(caps.data?.outputs?.feed);
  const config = useQuery({
    queryKey: ['composition', snapshot.brewConfigId],
    enabled: feeds,
    queryFn: ({ signal }) =>
      composeJson<BrewConfig>(`/api/brew-configs/${snapshot.brewConfigId}/composition`, { signal }),
  });
  const feed = feeds && !config.isError && Boolean(config.data?.delivery.feed);
  const unavailable = !caps.data
    ? caps.isError
      ? 'Formats unavailable'
      : 'Checking formats'
    : !twins
      ? 'Not available here'
      : !feeds
        ? 'Feed needs setup'
        : config.isError
          ? 'Feed unavailable'
          : config.isPending
            ? 'Checking feed'
            : 'Feed is off';
  const path = brewIssuePath(snapshot);
  useEffect(() => {
    const links = [
      ...(twins
        ? [
            [`${path}.md`, 'text/markdown'],
            [`${path}.json`, 'application/json'],
          ]
        : []),
      ...(feed
        ? [
            [`/b/${snapshot.brewConfigId}.atom`, 'application/atom+xml'],
            [`/b/${snapshot.brewConfigId}.json`, 'application/feed+json'],
          ]
        : []),
    ].map(([href, type]) => {
      const link = document.createElement('link');
      link.rel = 'alternate';
      link.href = href!;
      link.type = type!;
      document.head.append(link);
      return link;
    });
    return () => links.forEach((link) => link.remove());
  }, [path, snapshot.brewConfigId, twins, feed]);
  return (
    <div className="brew-format-links">
      <h2>Open this Brew as</h2>
      {(
        [
          ['file', 'Markdown', `${path}.md`, twins],
          ['code', 'JSON', `${path}.json`, twins],
          ['rss', 'Atom feed', `/b/${snapshot.brewConfigId}.atom`, feed],
        ] as const
      ).map(([icon, label, href, available]) => {
        const content = (
          <>
            <Icon name={icon} size={14} />
            <span>{label}</span>
            <code>{href}</code>
          </>
        );
        return (
          <div key={label}>
            {available ? (
              <a href={href} aria-label={label} className="brew-format-link">
                {content}
              </a>
            ) : (
              <button disabled aria-label={label} className="brew-format-link">
                {content}
              </button>
            )}
          </div>
        );
      })}
      {(!twins || !feed) && (
        <p>
          <Badge tone="locked">{unavailable}</Badge>{' '}
          <a
            href={
              feeds
                ? `/b/${snapshot.brewConfigId}/compose?sheet=schedule`
                : '/settings/runs#setup-outputs'
            }
          >
            {feeds ? 'Schedule & delivery' : 'About formats'}
          </a>
        </p>
      )}
      {feeds && config.isError && (
        <button className="brew-format-link" onClick={() => void config.refetch()}>
          Retry feed availability
        </button>
      )}
      {caps.isError && (
        <button className="brew-format-link" onClick={() => void caps.refetch()}>
          Retry format availability
        </button>
      )}
    </div>
  );
}
