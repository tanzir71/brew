import { useEffect, useRef } from 'react';
import type { SetupTopic } from './capabilityRows';
import type { Capabilities } from '@brew/core/types/capabilities';
import { Badge } from '../components/Badge';

const guides: Record<SetupTopic, { title: string; description: string; steps: string[] }> = {
  outputs: {
    title: 'Publishing outputs',
    description: 'Choose how to read and share a finished Brew.',
    steps: [
      'Read saved issues in Brew and use Compose to preview the Web, Email and Atom versions.',
      'Published feeds and webhook delivery are unavailable on this copy. Their controls keep your saved preferences.',
      'When a publishing connection is available, enable its channel in Schedule & delivery.',
    ],
  },
  newsletters: {
    title: 'Newsletters by email',
    description: 'Keep newsletters in your own library, beside your feeds.',
    steps: [
      'Use a dedicated mailbox, an inbound mail webhook, or Cloudflare Email Routing.',
      'For a browser or published copy, subscribe to a private email-to-feed URL.',
      'When mail is connected, your private address appears in Newsletters.',
    ],
  },
  delivery: {
    title: 'Emailing your Brew',
    description: 'Send a finished issue through a mail service you control.',
    steps: [
      'Connect SMTP, Cloudflare Email Service, Resend, or your host’s mail service.',
      'Choose an email recipient in Compose → Schedule & delivery.',
      'Use “Send a test now” before turning on scheduled delivery.',
    ],
  },
  apps: {
    title: 'Apps & sync',
    description: 'Read your library in Reeder, NetNewsWire or Unread.',
    steps: [
      'Use an instance with Google Reader API or Fever support.',
      'Create an app password and enter this instance’s URL in your reader.',
      'In NetNewsWire, choose a FreshRSS account. Read and starred states stay in sync.',
    ],
  },
  agents: {
    title: 'Agent access',
    description: 'Give an agent scoped access to the same library you read.',
    steps: [
      'Use an instance with an MCP server.',
      'Create a read-only token first; add write access only when you need it.',
      'Connect your agent to /mcp. Review changes in the action log and use Undo when needed.',
    ],
  },
  briefs: {
    title: 'Briefs (AI summaries)',
    description:
      'Briefs are off by default. No articles are sent to a model until you turn them on.',
    steps: [
      'Choose an available model: your own provider, Ollama, Workers AI, or a browser model.',
      'Keep your provider key on your own instance.',
      'Choose Brief in a Compose section. Every summary links back to its sources.',
    ],
  },
  data: {
    title: 'Data & backup',
    description: 'Keep a copy of your data before moving Brew.',
    steps: [
      'Export OPML to move subscriptions and folders between readers.',
      'On a Node instance, run npm run backup to back up the SQLite database.',
      'A complete .brew export is unavailable on this copy. Keep your database backup and OPML file.',
    ],
  },
  fetch: {
    title: 'Fetching feeds',
    description: 'A browser needs help fetching sites that do not allow direct requests.',
    steps: [
      'Configure a relay URL or a compatible extension for browser fetching.',
      'Keep Brew open for background checks in a browser.',
      'For checks while your browser is closed, use a server instance or a scheduled published copy.',
    ],
  },
};

export function SetupDialog({
  topic,
  capabilities,
}: {
  topic: SetupTopic;
  capabilities?: Capabilities;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const guide = guides[topic];
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const close = () => {
    history.replaceState(null, '', location.pathname + location.search);
    window.dispatchEvent(new Event('hashchange'));
  };
  return (
    <dialog
      ref={ref}
      className="runs-setup-dialog"
      aria-labelledby="setup-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="runs-dialog-heading">
        <h2 id="setup-title">{guide.title}</h2>
        <button type="button" onClick={close} aria-label="Close setup guide">
          ×
        </button>
      </div>
      <p>{guide.description}</p>
      <ol>
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {topic === 'data' && capabilities?.readState === 'server' && (
        <a className="runs-button" href="/api/opml/export" download>
          Export OPML
        </a>
      )}
      {topic === 'newsletters' && <a className="runs-button" href="/letters">Open Newsletters</a>}
      <p className="runs-guide-note">
        <Badge tone="neutral">Setup guide</Badge>Available connections appear in “What works here”.
      </p>
      <button type="button" className="runs-button runs-button--primary" onClick={close}>
        Done
      </button>
    </dialog>
  );
}
