import { useLayoutEffect, useRef } from 'react';
import type { SetupTopic } from './capabilityRows';
import type { Capabilities } from '@brew/core/types/capabilities';
import { Badge } from '../components/Badge';
import { AgentPreferences } from './AgentPreferences';
import { agentPageHref } from '../agentLocation';

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
      'On a Node instance, set BREW_SMTP_HOST, BREW_SMTP_FROM and BREW_PUBLIC_URL, plus your SMTP TLS/authentication settings, then restart Brew. See the outbound delivery guide in the README.',
      'For Resend on Node or Cloudflare, set BREW_RESEND_API_KEY and BREW_RESEND_FROM, plus BREW_PUBLIC_URL. Store the key as a secret and restart Node or redeploy the Worker.',
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
      'For in-page tools, set BREW_WEBMCP=1 and restart your Node instance, then enable In-page tools in Agent access. Use HTTPS or localhost.',
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
  const steps =
    topic === 'outputs'
      ? [
          capabilities?.outputs?.twins
            ? 'Open a saved issue and use its Markdown or JSON link in the Read rail.'
            : 'Issue text formats need a supported instance. Read saved issues in Brew or preview them in Compose.',
          capabilities?.outputs?.feed
            ? 'Enable Atom and JSON feed in Schedule & delivery, then subscribe using the Read rail’s Atom feed link. Turning the channel off disables the subscription.'
            : 'Issue feeds need a supported instance. You can preview an Atom issue in Compose.',
          capabilities?.outputs?.webhook
            ? 'Enable Webhook in Schedule & delivery and choose its destination.'
            : 'Webhook delivery needs setup on this instance.',
        ]
      : guide.steps;
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected && previous !== document.body && previous.getClientRects().length)
        previous.focus();
      else document.querySelector<HTMLElement>('main h1[tabindex]')?.focus({ preventScroll: true });
    };
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
      {topic === 'agents' && <AgentPreferences />}
      {topic === 'apps' && (
        <a className="runs-button" href={agentPageHref('/settings/apps')}>
          Open Apps &amp; sync settings
        </a>
      )}
      {topic === 'agents' && (
        <a className="runs-button" href={agentPageHref('/settings/agents')}>
          Open Agent access settings
        </a>
      )}
      <ol>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {topic === 'data' && capabilities?.readState === 'server' && (
        <a className="runs-button" href="/api/opml/export" download data-brew-action="export-opml">
          Export OPML
        </a>
      )}
      {topic === 'newsletters' && (
        <a className="runs-button" href="/letters">
          Open Newsletters
        </a>
      )}
      <p className="runs-guide-note">
        <Badge tone="neutral">Setup guide</Badge>Available connections appear in “What works here”.
      </p>
      <button type="button" className="runs-button runs-button--primary" onClick={close}>
        Done
      </button>
    </dialog>
  );
}
