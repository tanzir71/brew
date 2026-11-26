# Instance agent discovery

Fetch `GET /llms.txt` from a running Brew instance. It returns UTF-8 Markdown as
`text/plain`, supports HEAD, and uses `Cache-Control: private, no-store` and
`X-Robots-Tag: noindex, nofollow`. The app’s HTML head identifies it with
`<link rel="describedby" href="/llms.txt">`.

The guide follows the [llms.txt proposal](https://llmstxt.org/): a short overview
and grouped links to details. Links are root-relative and describe this instance;
request Host, forwarded headers, query strings and configured public origins do
not enter the document. This avoids publishing private configuration or changing
destinations through untrusted request headers. It is generated for each request,
so effective feature flags are current.

The document includes:

- Mode/read-state and actual MCP/WebMCP availability. Unwired transports are not
  advertised as available. Disabled tool names are explicitly reference-only.
- Owner access, scoped HTTP tokens, optional scoped local stdio, confirmation,
  bulk revisions, stable request identities, dry-run defaults and Undo limits.
- Capabilities/OpenAPI, capability-gated saved-view links, article/issue/Compose
  route patterns, ID discovery and paginated list guidance.
- Names/descriptions directly from the shared MCP/WebMCP catalog. No independent
  list of tool names needs maintenance.

This is metadata, not a library export. Generation calls only the capability
adapter, checks the presence of the token adapter, and constructs tool definitions.
It never enumerates feeds, article titles/bodies, Brews, rule drafts, settings,
tokens, activity or delivery destinations; it does not record reads, mutate state,
fetch feeds or mint credentials. Capability failures return a generic 503 without
adapter internals. Unsupported methods do not become SPA HTML.

Keep `/llms.txt` behind the existing owner network/reverse-proxy gate along with
HTML, REST and private exports. It grants no authorization. Scoped bearer tokens
are accepted only at `/mcp`; presenting one to the guide returns 403 and never
falls back to owner access. Use the owner interface to create/revoke tokens and a
compatible MCP client to call `/mcp`. Read the [MCP](mcp.md), [WebMCP](webmcp.md) and
[Agent access](agent-access.md) guides for full contracts.

This running-instance endpoint is separate from the marketing site’s static
`docs/llms.txt`, which describes the public project and is maintained with M19.

Node tests cover metadata isolation, SQL side effects, HEAD, private headers,
current flags, transport combinations, credential rejection, error redaction,
request-header poisoning, OpenAPI and parser/SPA boundaries. The real development
proxy test follows guide links and authenticates an MCP client to compare live
tools. Compiled smoke checks the same endpoint and HTML discovery outside cwd.
