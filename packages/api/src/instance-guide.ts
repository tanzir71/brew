import type { ApiServices } from './ports.js';
import { brewToolCatalog } from './agent-tools.js';

/** Curated instance metadata only: never enumerate library records or credentials. */
export async function instanceGuide(services: ApiServices, hasMcpTransport: boolean) {
  const caps = await services.capabilities();
  const mcp = hasMcpTransport ? caps.mcp : null;
  const toolPath = mcp ? '/mcp' : caps.webmcp ? '/api/webmcp/tools' : '/api/capabilities';
  const lines = [
    '# Brew instance guide',
    '',
    '> A single-owner feed reader with frozen Brews, private Markdown/JSON views and reviewed agent actions. Check this instance’s capabilities before using optional features.',
    '',
    `Mode: ${caps.mode}. Read state: ${caps.readState}. MCP: ${mcp ?? 'unavailable'}. WebMCP: ${caps.webmcp ? 'experimental; browser opt-in required' : 'disabled'}.`,
    '',
    'Access: owner HTML, REST, text exports and this guide use the existing network/reverse-proxy access gate. This guide grants no access and contains no account or token. MCP bearer tokens authorize only /mcp; Reader app sessions authorize only their protocol routes. Do not send client credentials to owner REST or this guide.',
    ...(mcp
      ? [
          '',
          services.agentAccess
            ? 'MCP HTTP requires Authorization: Bearer <Brew token> on every request. Create a token in Settings → Agent access; tokens are expiring, revocable and read-only by default. Write scope permits mark/star/tag/feed changes, never arbitrary deletion or saving rules. Tokens can preview rules.'
            : 'MCP uses the owner deployment boundary on this target; no scoped-token adapter is configured.',
          ...(mcp === 'stdio+http'
            ? [
                'Local stdio: node dist/targets/node/src/index.js mcp. Use the same absolute BREW_DB_PATH as the server. Without BREW_MCP_TOKEN this is trusted local owner access; set that variable to share the HTTP token’s scope and replay identity.',
              ]
            : []),
        ]
      : ['', 'No MCP HTTP transport is available on this instance.']),
    ...(caps.webmcp
      ? [
          '',
          'WebMCP uses owner browser access on HTTPS or localhost, after enabling In-page tools in Agent access. It registers only tools for mounted visible controls. Native document.modelContext takes precedence over navigator.modelContext; the polyfill supplies JavaScript tools, not a built-in browser agent. Confirmed writes require the native review dialog.',
        ]
      : ['', 'WebMCP is not enabled on this instance; the setup control remains visible.']),
    '',
    'Read tools and previews do not mark items read. Tool writes require confirm:true and a stable 16–80 character request_id (letters, digits, underscores or hyphens), except undo which needs undo_id and confirm:true. Preserve request_id when retrying a lost acknowledgement. mark_read first previews its target/count; confirm the same target and revision. create_rule defaults to dry_run:true; owner saves require dry_run:false plus confirmation. Enabled rules can affect future ingestion.',
    caps.actions?.undo
      ? 'Successful writes return a receipt and undo_id. Undo lasts 30 seconds, restores actual local state and can refuse later conflicting changes. Inspect canUndo, expiresAt and status; retrying a request does not extend Undo. Read/preview activity can add redacted audit metadata.'
      : 'Durable action Undo is unavailable on this instance; check capabilities before attempting writes.',
    '',
    'Use real IDs from lists. Article views: /a/{articleId}. Frozen issues: /b/{brewId}/{issueId}. When outputs.twins is enabled, append .md or .json for saved content. Compose: /b/{brewId}/compose. Issue feeds: /b/{brewId}.atom or .json, when outputs.feed and that Brew’s saved feed toggle are enabled. Never guess IDs or treat a preview as a saved issue.',
    'Agent-friendly browser mode is a separate saved preference or temporary ?agent=1: numbered pages with totals, no virtualization/motion or read-on-scroll. Native Open still marks an item read. Preserve page/filter state and follow returned next_cursor/next_offset rather than assuming lists are complete.',
    '',
    '## Start here',
    '',
    '- [Capabilities](/api/capabilities): Effective feature gates for this instance; unavailable operations can return 501.',
    '- [OpenAPI 3.1](/api/openapi.json): Registered routes, parameters, request/response schemas, auth and error contracts. HEAD is supported.',
  ];
  if (caps.outputs?.twins)
    lines.push(
      '',
      '## Saved views',
      '',
      '- [Brew index](/index.md): Saved Brew IDs and issue links; JSON at /index.json.',
      '- [Reader](/reader.md): Reader landing view; JSON at /reader.json.',
      '- [All articles](/all.md): Numbered article pages with totals; JSON at /all.json.',
      '- [Today](/today.md): Current-day selection; JSON at /today.json.',
      '- [Starred](/starred.md): Saved starred articles; JSON at /starred.json.',
      '- [Feed library](/feeds.md): Feeds, folders and health; JSON at /feeds.json.',
      '- [Newsletters](/letters.md): Saved sender/letter views; JSON at /letters.json.',
      '- [Rules](/rules.md): Saved definitions, selected preview/log and execution pages; JSON at /rules.json.',
      '- [Instance setup](/settings/runs.md): Mode capabilities and setup; JSON at /settings/runs.json.',
    );
  lines.push('', '## Agent access', '');
  if (caps.agentAccess)
    lines.push(
      '- [Agent access](/settings/agents.md): Setup and private metadata-only token/activity views; JSON at /settings/agents.json. Create/revoke secrets in the owner interface /settings/agents.',
    );
  if (mcp)
    lines.push(
      '- [MCP HTTP](/mcp): Streamable HTTP JSON-RPC endpoint, not an HTML page. Use an MCP client and the authentication described above.',
    );
  if (caps.webmcp)
    lines.push(
      '- [WebMCP catalog](/api/webmcp/tools): Shared definitions. Owner same-origin invocations use POST /api/webmcp/call; browser code binds arguments to mounted UI and stages confirmed writes.',
    );
  if (caps.readerApi)
    lines.push(
      '- [Google Reader API](/api/greader/reader/api/0/user-info): Reader app base URL /api/greader. POST accounts/ClientLogin below that base with Email and Passwd to obtain a Reader session; use GoogleLogin auth=<session> or its Reader bearer header. Fetch reader/api/0/token for write token T. These are separate app credentials, not MCP tokens.',
      '- [Fever API](/api/fever): Use a dedicated generated app password; send api_key=MD5(username:password) in a URL-encoded POST. This credential permits reading/synchronizing state and subscriptions through the reader protocols, never owner REST or MCP. Setup and rotation use the owner-only /api/reader-access endpoint.',
    );
  if (!caps.agentAccess && !mcp && !caps.webmcp)
    lines.push(
      '- [Agent feature availability](/api/capabilities): No tool transport or token-management adapter is enabled.',
    );
  lines.push(
    '',
    '## Shared tool catalog',
    '',
    ...brewToolCatalog(services).map(
      (tool) =>
        `- [${tool.name}](${toolPath}): ${tool.description}${!mcp && !caps.webmcp ? ' Reference only; no tool transport is enabled.' : ''}`,
    ),
    '',
  );
  return lines.join('\n');
}
