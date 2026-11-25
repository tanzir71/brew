import type { Capabilities } from '@brew/core/types/capabilities';
import type { BadgeTone } from '../components/Badge';

export type SetupTopic =
  'newsletters' | 'delivery' | 'apps' | 'agents' | 'briefs' | 'data' | 'fetch';
export interface CapabilityRow {
  id: SetupTopic;
  title: string;
  description: string;
  tone: BadgeTone;
  label: string;
  setup?: 'Set up' | 'Choose';
}

const inboundLabels: Record<NonNullable<Capabilities['inboundMail']>, string> = {
  'cloudflare-email': 'Email Routing hands mail to the Worker',
  imap: 'A dedicated mailbox receives your newsletters',
  webhook: 'Your mail provider forwards letters to this instance',
  'email-to-feed': 'Subscribe to a private email-to-feed URL',
};
const deliveryLabels: Record<NonNullable<Capabilities['emailDelivery']>, string> = {
  smtp: 'Send through your SMTP connection',
  'cloudflare-email': 'Send through Cloudflare Email Service',
  resend: 'Send through your Resend connection',
  'php-mail': 'Send through your host’s mail service',
};
export const inboundDescription = (capabilities: Capabilities): string =>
  capabilities.inboundMail
    ? inboundLabels[capabilities.inboundMail]
    : 'No mail connection is active';
export function fetchingDescription(capabilities: Capabilities): string {
  const { kind, everyMinutes } = capabilities.backgroundFetch;
  const cadence = everyMinutes
    ? `every ${everyMinutes === 1 ? 'minute' : `${everyMinutes} min`}`
    : 'on schedule';
  return {
    always: `Always on · checks due feeds ${cadence}`,
    'while-open': 'Catch up on open · fetch while Brew is open',
    cron: `Cron ${cadence}`,
    'build-time': 'Fetched when the published copy is built',
  }[kind];
}

export function capabilityRows(capabilities?: Capabilities, failed = false): CapabilityRow[] {
  const ready = { tone: 'positive' as const, label: 'Works here' };
  const setup = (label = 'Needs setup') => ({
    tone: 'warning' as const,
    label,
    setup: 'Set up' as const,
  });
  const server = { tone: 'locked' as const, label: 'Server modes', setup: 'Set up' as const };
  const readOnly = { tone: 'neutral' as const, label: 'Read-only', setup: 'Set up' as const };
  const local = capabilities?.readState === 'local';
  const published = capabilities?.backgroundFetch.kind === 'build-time';
  const missingServerFeature = published ? readOnly : local ? server : setup();
  const rows: CapabilityRow[] = [
    {
      id: 'fetch',
      title: 'Feeds and full text',
      description: capabilities
        ? {
            direct: 'Fetched directly, no CORS limits',
            relay: 'A relay fetches feeds for this browser',
            extension: 'Fetched through your browser extension',
            'build-time': 'Read the feeds included in the published copy',
          }[capabilities.fetch]
        : 'Feeds, articles and full-text reading',
      ...(published ? readOnly : ready),
    },
    {
      id: 'newsletters',
      title: 'Newsletters by email',
      description: capabilities
        ? inboundDescription(capabilities)
        : 'Receive newsletters at a private address',
      ...(capabilities?.inboundMail
        ? capabilities.inboundMail === 'email-to-feed'
          ? setup('Needs an email-to-feed URL')
          : ready
        : missingServerFeature),
    },
    {
      id: 'delivery',
      title: 'Emailing your Brew',
      description: capabilities?.emailDelivery
        ? deliveryLabels[capabilities.emailDelivery]
        : 'Connect a mail service to send your Brew',
      ...(capabilities?.emailDelivery
        ? ready
        : local || published
          ? missingServerFeature
          : setup('Needs mail add-on')),
    },
    {
      id: 'apps',
      title: 'Reeder, NetNewsWire, Unread',
      description: capabilities?.readerApi
        ? 'Google Reader API at /api/greader'
        : 'Connect a reader app through Google Reader or Fever',
      ...(capabilities?.readerApi ? ready : missingServerFeature),
    },
    {
      id: 'agents',
      title: 'MCP server for agents',
      description: capabilities?.mcp
        ? capabilities.mcp === 'stdio+http'
          ? 'Standard input/output and streamable HTTP at /mcp'
          : 'Streamable HTTP at /mcp'
        : 'Give an agent scoped access to your library',
      ...(capabilities?.mcp ? ready : missingServerFeature),
    },
    {
      id: 'briefs',
      title: 'Briefs (AI summaries)',
      description: capabilities?.ai.configured
        ? 'Summaries cite the articles in your Brew'
        : 'Off by default · choose a model to use Briefs',
      ...(capabilities?.ai.configured
        ? ready
        : { ...setup('Needs a model'), setup: 'Choose' as const }),
    },
    {
      id: 'data',
      title: 'Public read-only copy',
      description: capabilities?.publicCopy
        ? 'Publish to GitHub Pages from Data & backup'
        : 'Publish a copy with private sections excluded',
      ...(capabilities?.publicCopy ? ready : published ? readOnly : setup()),
    },
  ];
  return capabilities
    ? rows
    : rows.map((row) => ({
        ...row,
        tone: 'neutral',
        label: failed ? 'Unavailable' : 'Checking',
        setup: undefined,
      }));
}
