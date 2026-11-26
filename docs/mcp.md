# MCP server

Brew exposes one catalog through Node CLI stdio and streamable HTTP at `/mcp`.
Node advertises `mcp: "stdio+http"` in `/api/capabilities`. Other adapters return
501 until they provide MCP. Scoped tokens, the full Agent access setup and
WebMCP remain separate M12 work.

## Connect

After `npm run build`, start stdio with:

```sh
node dist/targets/node/src/index.js mcp
```

`--mcp` is also accepted. `npm run --silent mcp` omits npm's stdout banner. An MCP
host should launch Node directly with an absolute script path and the same
absolute `BREW_DB_PATH` as the Node server. Otherwise the existing default is
`./data/brew.db`, relative to the launching working directory. Substitute your
own paths in the host configuration:

```json
{
  "mcpServers": {
    "brew": {
      "command": "node",
      "args": ["/absolute/path/to/brew/dist/targets/node/src/index.js", "mcp"],
      "env": { "BREW_DB_PATH": "/absolute/path/to/brew/data/brew.db" }
    }
  }
}
```

Stdout contains JSON-RPC only; startup errors use stderr. The process opens no
HTTP listener and starts no poller, Brew scheduler, mailbox or SMTP transport.
Pipe closure and SIGINT/SIGTERM close the SDK, drain writes and close SQLite.
An explicitly confirmed `add_feed` can fetch its requested feed metadata.

For HTTP, connect to `http://127.0.0.1:4400/mcp`, the configured public origin, or
the development proxy on port 4401. The SDK supports modern and 2025 protocol
clients. HTTP is stateless; legacy GET/DELETE session operations return 405.
Host validation accepts exact loopback hostnames and the configured public
hostname. Browser Origin must match the request or configured public origin.
Responses, including parser errors, are private/no-store. No permissive
cross-origin policy is added.

This criterion provides trusted-owner access, as with the existing Node REST API.
Protect deployed instance access at its deployment boundary. Scoped tokens are
not implemented yet. The shared factory defaults to read-only; Node's owner
transports explicitly enable confirmed writes.

## Tools

| Tool | Arguments and behavior |
| --- | --- |
| `search_items` | `query`; optional `scope`, `folder_id`, `unread`, `sort`, `limit`, `offset`. Exact totals and `next_offset`. |
| `list_unread` | Optional `view`, `feed_id`, `folder_id`, `limit`, `cursor`. Exact totals and `next_cursor`. |
| `get_item` | Article `id`. Sanitized Markdown and current read/star/tag state; no implicit read, full-text fetch or raw newsletter original. |
| `mark_read` | `target` of `{kind:"items",ids:[...]}` or `{kind:"reader",view,...}`. First reviews the complete scope, then confirms its revision. |
| `star` | Article `id`, `starred` (default true). Sets state rather than toggling. |
| `tag` | Article `id`, `add`/`remove` arrays of names. Creates missing added tags with journaled ownership. |
| `add_feed` | HTTP(S) `url`, optional `folder_id`. Fetches metadata before atomic insertion. |
| `create_rule` | Full `draft`; `dry_run` defaults true. Counts all visible matches with a 50-item sample, without saving or running actions. |
| `list_brews` | No arguments. Lists saved Brew IDs, names and enabled state. |
| `get_brew` | Saved Brew `id`, optional `issue_id` belonging to that Brew. Configuration context and latest/chosen frozen issue, excluding delivery destinations. |
| `preview_brew` | Saved Brew `id`, optional ISO `at` with explicit offset. Unsaved content and warnings; no saved issue, delivery or read writes. |
| `undo` | Previous `undo_id` and `confirm:true`. Restores the actual journaled change. |

Read tools never mark items read. Lists default to 50 rows and accept at most 100.
Item read batches accept up to 50,000 IDs; Reader targets review all unread items
in scope beyond the loaded page. SDK schemas validate fields and identities.

## Confirmation and recovery

Writes require `confirm:true`. All writes except `undo` also require a
16–80 character `request_id` of letters, digits, underscores or hyphens. Preserve
it after a lost acknowledgement. Success returns a numeric `undo_id` and receipt.
Replays recover the same receipt across transports and process restarts, including
after Undo or expiry. Changing arguments with the same identity conflicts.

For `mark_read`, first omit confirmation to obtain the current revision/count.
Confirm that same target/revision; stale state requires a fresh review. For
`create_rule`, saving additionally requires `dry_run:false`. A dry run works on
a read-only connection and does not journal anything. A saved enabled rule may
run its configured actions on future ingestion.

Undo lasts 30 seconds and preserves unrelated later fields. It refuses overlapping
edits, new feeds already used by articles/references, new rules with edits/history,
and new tags used elsewhere. Legacy rule-application Undo still retains reusable
tag definitions. Failed inserts roll back the change and receipt together. Private
journal bodies are pruned on expiry; audit arguments hash sensitive input.

Tool errors use `isError:true` and structured status/message. Unknown database or
network internals are not echoed. Inspect `canUndo`, `expiresAt` and `status` after
replay. `undo_id` still identifies an expired receipt; Undo itself is safe to retry.

## Verification

Node tests use the official client over real HTTP sockets and the actual CLI.
They cover all tools, read-only SQL state, Markdown, dry-run defaults, confirmation,
concurrent retries, reopening SQLite, conflicts, expiry, rollback and private
Host/Origin rejection. Existing action and live-event tests remain compatibility
gates. Portable bundle checks include the MCP catalog.

Browser checks use the real Node proxy. Compiled smoke writes over HTTP outside
the repository cwd, reopens the same database over CLI stdio, recovers the receipt
and undoes the actual read change. Both transports use the same factory and the
[official TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/).
