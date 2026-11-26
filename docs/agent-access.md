# Agent access

Open Settings → Agent access (`/settings/agents`). Node advertises `agentAccess: true`;
other adapters keep controls visible with a setup link until they implement the port.
The old `/settings/runs#setup-agents` guide and browser agent-mode preference still work.

Create a token with a name for its client. Access defaults to **Read-only**, with a
30-day expiry. The UI also offers 7 and 90 days; the owner API accepts 1–365 days.
Copy the secret while the creation dialog is open. Closing it discards the secret
from the UI. Lists, text twins and activity never return it again. If creation
finished but its response was lost, revoke the listed token and create another.
Revoke disconnects the token immediately; past activity retains its label.

Each token contains 32 random bytes. SQLite stores a SHA-256 hash, scope, expiry,
last-use time and label. Plaintext stays only in the creation response and the
mounted secret view; it is absent from browser storage and the query cache.
Expired metadata remains visible until revoked. At most 100 tokens are retained.

## Scopes and recovery

| Access | Allowed |
| --- | --- |
| Read-only | Search, unread lists, sanitized article Markdown, Brew reads/previews, read-batch review and rule dry runs. |
| Read & write | All reads plus confirmed mark, star, tag and add-feed actions, and Undo of this token’s own changes. |

Write scope cannot delete existing library content, save rules, change owner
settings or create more credentials. Rule creation stays a dry run for tokens,
including enabled rules that could otherwise run later. Every write requires
`confirm:true`; mutations also need a stable `request_id`. Reusing an identity
with different arguments conflicts. Identities are isolated by token.

The recent log shows four validated tool calls/changes; Full log pages the entire
history, 20 at a time. Reads, previews and refused calls have generic summaries;
their search text, URLs, drafts, article bodies and raw arguments are omitted.
Successful writes use the same durable receipt as the owner action system.
Undo restores actual local changes for 30 seconds and refuses later conflicts.
Rolling back a token’s own new feed/tag can remove that insertion while unused;
there is no arbitrary resource-deletion tool. The owner can Undo any token’s change.
Expired private row deltas are pruned while redacted activity remains.

HTTP checks expiry and revocation on every request. Scoped stdio checks each tool
call. A subscription fetch rechecks permission after its network await, before
committing its insertion. A revoked or expired token cannot finish that write.

## Connect clients

Copy setup uses the current instance’s `/mcp` URL and a placeholder, never a saved
token. Claude’s tab supplies a Claude Code HTTP JSON configuration; replace
`<YOUR_BREW_TOKEN>` in a private client configuration. Its supported header setup
is described in the [Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

Codex’s tab supplies:

```toml
[mcp_servers.brew]
url = "http://127.0.0.1:4400/mcp"
bearer_token_env_var = "BREW_TOKEN"
```

Use your instance URL. Set `BREW_TOKEN` in the environment that starts Codex and
restart it. The [Codex MCP configuration guide](https://learn.chatgpt.com/docs/extend/mcp)
documents this environment-variable option.

The ChatGPT tab stays visible and explains **Needs OAuth**: ChatGPT custom
connections cannot send a custom API key, and this instance does not provide an
OAuth authorization server. Use a compatible bearer-header client. See the
[ChatGPT authentication requirements](https://developers.openai.com/plugins/build/auth).
The experimental [WebMCP switch](webmcp.md) requires `BREW_WEBMCP=1` on Node,
a restart, and a separate saved browser opt-in on HTTPS or localhost. It stays
visible with a setup link where unavailable. In-page tools act through owner
browser access and share the activity log and durable Undo.

For local stdio, use the same absolute `BREW_DB_PATH` and set `BREW_MCP_TOKEN` to
the token. This shares its replay namespace with HTTP, including across restarts.
Without that variable, stdio is the trusted local owner, with database-file access.
See [MCP transport and tool details](mcp.md).

## Owner boundary

This is a single-owner application, with no new accounts or cookie session.
Protect owner HTML, REST, private text exports and static app access at the existing
network/reverse-proxy boundary. If exposing `/mcp` to remote agents, keep the owner
gate on all other paths. A token grants access only to `/mcp`; `/api/*` explicitly
rejects bearer credentials rather than treating them as owner authorization.

Token management validates exact loopback/configured hosts, rejects cross-site
requests and requires a same-origin Origin header on writes. Sensitive responses
and parser errors are private/no-store/noindex. No permissive CORS policy or
query-string credential transport is added. Management endpoints are documented
in `/api/openapi.json`; `/settings/agents.md` and `.json` expose metadata only.
