import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppSidebar } from '../components/AppSidebar';
import { Badge } from '../components/Badge';
import { CapabilityRow } from '../components/patterns';
import { runAssets } from '../components/figmaAssets';
import { runtimeNames } from '../components/runtimeNames';
import { useCapabilities } from '../hooks/useCapabilities';
import {
  capabilityRows,
  fetchingDescription,
  inboundDescription,
  type SetupTopic,
} from './capabilityRows';
import { SetupDialog } from './SetupDialog';

const topics: SetupTopic[] = [
  'newsletters',
  'delivery',
  'apps',
  'agents',
  'briefs',
  'data',
  'fetch',
];
const subscribeHash = (notify: () => void) => {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
};

export function WhereBrewRuns() {
  const query = useCapabilities();
  const capabilities = query.data;
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  const topic = hash.startsWith('#setup-')
    ? topics.find((item) => item === hash.slice(7))
    : undefined;
  const name = capabilities ? runtimeNames[capabilities.mode] : undefined;
  const rows = capabilityRows(capabilities, query.isError);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const minutesSinceCheck = Math.max(0, Math.floor((now - query.dataUpdatedAt) / 60_000));
  const checked =
    minutesSinceCheck < 1 ? 'Checked just now' : `Checked ${minutesSinceCheck} min ago`;
  return (
    <div className="runs-app">
      <AppSidebar />
      <div className="runs-panel">
        <nav aria-label="Settings" className="runs-settings-nav">
          <h2>Settings</h2>
          <a href="/#theme-picker">
            <img src={runAssets.general} alt="" />
            General
          </a>
          <a href="/?view=reader&scope=all">
            <img src={runAssets.reading} alt="" />
            Reading
          </a>
          <a href="/settings/runs" aria-current="page">
            <img src={runAssets.runs} alt="" />
            Where Brew runs
          </a>
          <a href="#setup-newsletters">
            <img src={runAssets.inbox} alt="" />
            Newsletters
          </a>
          <a href="#setup-agents">
            <img src={runAssets.agent} alt="" />
            Agent access
          </a>
          <a href="#setup-apps">
            <img src={runAssets.apps} alt="" />
            Apps &amp; sync
          </a>
          <a href="#setup-data">
            <img src={runAssets.backup} alt="" />
            Data &amp; backup
          </a>
        </nav>
        <main className="runs-content" id="main-content">
          <header className="runs-intro">
            <h1>Where Brew runs</h1>
            <p>
              {name
                ? `This copy of Brew runs on ${name.short}. What you can do depends on what this place supports, and every limit below has a way around it.`
                : 'Check where this copy runs and what it supports.'}
            </p>
          </header>
          {query.isError && (
            <div role="alert" className="runs-error">
              <p>
                Could not check where Brew runs. Feature controls stay unavailable until the
                connection is restored.
              </p>
              <button type="button" className="runs-button" onClick={() => void query.refetch()}>
                Try again
              </button>
            </div>
          )}
          <section className="runs-current" aria-label="Current mode" aria-busy={query.isPending}>
            <div className="runs-current-heading">
              <span className="runs-mode-icon">
                <img src={runAssets.currentMode} alt="" />
              </span>
              <div className="runs-instance-name">
                <h2>{name?.full ?? (query.isError ? 'Unavailable' : 'Checking…')}</h2>
                <p>{location.host}</p>
              </div>
              <Badge tone={capabilities ? 'positive' : 'neutral'}>
                {capabilities ? 'Healthy' : query.isError ? 'Unavailable' : 'Checking'}
              </Badge>
            </div>
            <dl className="runs-details">
              <div>
                <dt>Read state</dt>
                <dd>
                  {capabilities
                    ? capabilities.readState === 'server'
                      ? 'Stored on this server'
                      : 'Stored in this browser'
                    : 'Checking…'}
                </dd>
              </div>
              <div>
                <dt>Fetching</dt>
                <dd>{capabilities ? fetchingDescription(capabilities) : 'Checking…'}</dd>
              </div>
              <div>
                <dt>Inbound mail</dt>
                <dd>{capabilities ? inboundDescription(capabilities) : 'Checking…'}</dd>
              </div>
              <div>
                <dt>Limits</dt>
                <dd>
                  {capabilities
                    ? capabilities.limits?.maxFetchesPerRun
                      ? `Up to ${capabilities.limits.maxFetchesPerRun} fetches per run`
                      : 'Managed by your host'
                    : 'Checking…'}
                </dd>
              </div>
            </dl>
          </section>
          <div className="runs-table-heading">
            <h2>What works here</h2>
            <button
              type="button"
              className="runs-check"
              disabled={query.isFetching}
              aria-label="Refresh capabilities"
              onClick={() => void query.refetch()}
            >
              {query.isFetching ? 'Checking…' : query.isError ? 'Check again' : checked}
            </button>
          </div>
          <section
            className="runs-capabilities"
            aria-label="Capabilities"
            aria-busy={query.isPending}
          >
            {rows.map((row) => (
              <CapabilityRow
                key={row.id}
                id={row.id}
                appearance="table"
                title={row.title}
                description={row.description}
                badge={{ tone: row.tone, label: row.label }}
                setup={row.setup ? { label: row.setup, href: `#setup-${row.id}` } : undefined}
              />
            ))}
          </section>
          <section className="runs-move" aria-labelledby="move-title">
            <h2 id="move-title">Move Brew somewhere else</h2>
            <p>
              Export one .brew file with your database, rules, Brews and settings, then import it
              anywhere. Nothing is lost moving between modes; features simply switch on or off.
            </p>
          </section>
          <div className="runs-transfer">
            <button type="button" className="runs-button runs-button--primary" disabled>
              <img src={runAssets.download} alt="" />
              Export .brew file
            </button>
            <button type="button" className="runs-button" disabled>
              <img src={runAssets.upload} alt="" />
              Import
            </button>
            <a href="#setup-data" className="runs-transfer-help">
              <Badge tone="warning">Needs setup</Badge>Set up
            </a>
            <span>No exports yet</span>
          </div>
        </main>
      </div>
      {topic && <SetupDialog topic={topic} capabilities={capabilities} />}
    </div>
  );
}
