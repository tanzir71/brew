import { useState } from 'react';
import { Button, Wordmark } from '../components/controls';
import { Badge } from '../components/Badge';
import { firstRunAssets as assets } from '../components/firstRunAssets';
import { useOwnerActions } from '../hooks/useOwnerActions';
import { useOpmlImport } from '../hooks/useOpmlImport';
import { OpmlImportPicker, OpmlImportFeedback, OpmlImportReview } from '../components/OpmlImport';
import { OwnerActionUi } from '../components/OwnerActionUi';

type Asset = { src: string; width: number; height: number };
function Vector({ asset }: { asset: Asset }) {
  return (
    <span
      aria-hidden="true"
      className="first-run-vector"
      data-figma-asset={asset.src}
      style={{ width: asset.width, height: asset.height, maskImage: `url("${asset.src}")` }}
    />
  );
}
const features = {
  browser: [
    'Feeds, through a small relay',
    'Fetches while a tab is open',
    'Newsletters as a feed address',
    'Emailing your Brew',
    'Agents in this page only',
  ],
  node: [
    'Feeds and full text',
    'Fetches in the background',
    'Newsletters over IMAP or webhook',
    'Email through your SMTP',
    'MCP, Reeder, NetNewsWire',
  ],
  cloudflare: [
    'Feeds and full text',
    'Fetches every minute',
    'Newsletters, natively',
    'Email with a mail binding or Resend',
    'MCP, Reeder, NetNewsWire',
  ],
  lite: [
    'Feeds and full text',
    'Fetches on your host’s cron',
    'Newsletters over IMAP',
    'Email through PHP mail',
    'Reeder and NetNewsWire',
  ],
  static: [
    'Feeds, at build time',
    'Rebuilds on a schedule',
    'Newsletters as a feed address',
    'Emailing your Brew',
    'Agents read llms.txt + JSON',
  ],
};
const cards = [
  {
    id: 'browser',
    title: 'This browser',
    icon: assets.IconBrowser,
    description: 'Nothing to install. Your data stays in this browser.',
    states: ['plus', 'plus', 'plus', 'x', 'plus'],
    note: 'Ready in 10 seconds',
  },
  {
    id: 'node',
    title: 'Your computer or server',
    icon: assets.IconServer,
    description: 'One Node process or a Docker container, one SQLite file.',
    states: ['check', 'check', 'plus', 'plus', 'check'],
    note: 'git clone …/brew',
    badge: 'Most complete',
  },
  {
    id: 'cloudflare',
    title: 'Cloudflare',
    icon: assets.IconCloud,
    description: 'Your own Worker and D1 database. Inbound mail built in.',
    states: ['check', 'check', 'check', 'plus', 'check'],
    note: 'Free tier fits ~40 feeds a run',
  },
  {
    id: 'lite',
    title: 'Shared hosting',
    icon: assets.IconGlobe,
    description: 'Upload a folder to any PHP host with cron.',
    states: ['check', 'check', 'plus', 'check', 'plus'],
    note: 'In development',
    badge: 'Lite',
  },
  {
    id: 'static',
    title: 'GitHub Pages',
    icon: assets.IconFile,
    description: 'A public, read-only Brew rebuilt by GitHub Actions.',
    states: ['check', 'plus', 'plus', 'x', 'plus'],
    note: 'Publishing setup is in development',
    badge: 'Read-only',
  },
] as const;
const featureIcons = { plus: assets.IconPlus, check: assets.IconCheck, x: assets.IconX };
const setupCommands =
  'git clone https://github.com/tanzir71/brew.git\ncd brew\nnpm install\nnpm run build\nnpm start';

export function FirstRun({
  onStart,
  starting = false,
  error,
  onRetry,
}: {
  onStart(): void;
  starting?: boolean;
  error?: string;
  onRetry?(): void;
}) {
  const [copied, setCopied] = useState('');
  const owner = useOwnerActions(async (receipt) => {
    setCopied(receipt.summary);
  });
  const opml = useOpmlImport(owner);
  return (
    <main className="first-run" aria-labelledby="first-run-heading" data-brew-view="first-run">
      <Wordmark />
      <header className="first-run-intro">
        <h1 id="first-run-heading">Where should Brew run?</h1>
        <p>Pick a place to start. In this browser, your library stays on your device.</p>
      </header>
      <section className="first-run-modes" aria-label="Where to run Brew">
        {cards.map((card) => (
          <article
            key={card.id}
            className="first-run-card"
            aria-label={card.title}
            data-mode-card={card.id}
          >
            <div className="first-run-card-heading">
              <span className="first-run-mode-icon">
                <Vector asset={card.icon} />
              </span>
              {'badge' in card && (
                <Badge
                  tone={card.id === 'node' ? 'accent' : 'neutral'}
                  lead={<Vector asset={card.id === 'node' ? assets.Lead1 : assets.Lead} />}
                >
                  {card.badge}
                </Badge>
              )}
            </div>
            <div className="first-run-card-description">
              <h2>{card.title}</h2>
              <p>{card.description}</p>
            </div>
            <hr />
            <ul className="first-run-features">
              {features[card.id].map((feature, index) => (
                <li key={feature} data-support={card.states[index]}>
                  <Vector asset={featureIcons[card.states[index]!]} />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <footer className="first-run-card-footer">
              <p className={card.id === 'node' ? 'first-run-command' : undefined}>{card.note}</p>
              {card.id === 'browser' ? (
                <Button
                  className="first-run-cta"
                  disabled={starting || owner.busy || !!owner.intent}
                  aria-busy={starting}
                  data-brew-action="start-browser"
                  onClick={onStart}
                >
                  {starting ? 'Opening your Brew…' : 'Start here'}
                </Button>
              ) : card.id === 'node' ? (
                <Button
                  variant="secondary"
                  className="first-run-cta"
                  icon={<Vector asset={assets.Icon} />}
                  onClick={() => {
                    void navigator.clipboard.writeText(setupCommands).then(
                      () => setCopied('Setup commands copied.'),
                      () => setCopied('Copy these commands: ' + setupCommands),
                    );
                  }}
                >
                  Copy command
                </Button>
              ) : card.id === 'cloudflare' ? (
                <a
                  className="brew-button brew-button--secondary brew-button--md first-run-cta"
                  href="https://deploy.workers.cloudflare.com/?url=https://github.com/tanzir71/brew"
                >
                  <Vector asset={assets.Icon1} />
                  Deploy to Cloudflare
                </a>
              ) : (
                <Button
                  variant="secondary"
                  className="first-run-cta"
                  disabled
                  icon={<Vector asset={card.id === 'lite' ? assets.Icon2 : assets.Icon3} />}
                >
                  {card.id === 'lite' ? 'Download Lite' : 'Use template'}
                </Button>
              )}
            </footer>
          </article>
        ))}
      </section>
      <div className="first-run-legend" aria-label="Capability legend">
        <span data-support="check">
          <Vector asset={assets.IconCheck1} />
          Works
        </span>
        <span data-support="plus">
          <Vector asset={assets.IconPlus1} />
          Works with an add-on
        </span>
        <span data-support="x">
          <Vector asset={assets.IconX1} />
          Not available here
        </span>
      </div>
      <div className="first-run-import">
        <span>Moving in?</span>
        <span className="first-run-unavailable">
          <button type="button" disabled>
            Import a .brew file
          </button>
          <Badge tone="locked">Coming next</Badge>
        </span>
        <span>or</span>
        <OpmlImportPicker
          flow={opml}
          label="OPML from Feedly or Inoreader"
          ghost
          showIcon={false}
          className="first-run-link"
          disabled={starting}
        />
      </div>
      {error && (
        <div role="alert" className="first-run-feedback">
          <p>{error}</p>
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
      <p role="status" className="first-run-feedback">
        {copied}
      </p>
      <OpmlImportFeedback flow={opml} />
      <OwnerActionUi action={owner}>
        {opml.preview && <OpmlImportReview name={opml.preview.name} data={opml.preview.data} />}
      </OwnerActionUi>
    </main>
  );
}
