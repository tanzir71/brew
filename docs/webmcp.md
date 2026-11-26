# In-page tools (WebMCP)

WebMCP is experimental and off by default. It exposes the same twelve tools as
the [MCP server](mcp.md), with the same schemas, validation, services, confirmation
flags, durable request identities and 30-second Undo.

## Enable

1. Start Node with `BREW_WEBMCP=1`. Restart after changing the environment.
2. Open Brew on HTTPS or localhost. For a reverse proxy, configure its canonical
   `BREW_PUBLIC_URL` and retain the existing owner access gate.
3. In Settings → Agent access, enable **In-page tools (WebMCP)**. This preference
   is saved as `brew:webmcp` in this browser and synchronizes across its tabs.

The server capability and browser preference are independent; both must be on.
An unavailable control remains visible with **Needs setup**. Agent-friendly mode
and `?agent=1` do not enable WebMCP. Other targets report it unavailable until
they supply a working adapter. Registration failures show **Retry in-page tools**.

Feature detection prefers `document.modelContext ?? navigator.modelContext`.
Where neither exists, Brew dynamically loads the pinned official
[`@w3c/webmcp-polyfill`](https://github.com/w3c-oss/webmcp-polyfill).
It provides the standard JavaScript tool registration/consumer interface for
compatible scripts or extensions; it does not add a built-in browser AI agent.
A browser's native agent integration remains browser-dependent. No polyfill or
tool catalog is fetched while either opt-in is off. Partial or refused native
implementations surface an error instead of being overwritten.

## Mounted controls

| Visible surface | Tools |
| --- | --- |
| Search field | `search_items` |
| Sidebar Brew choices | `list_brews` |
| Reader list and bulk-read control | `list_unread`, `get_item`, `mark_read` |
| Article or letter pane | `get_item`, `star`, `tag`, `mark_read` |
| Selected Brew | `list_brews`, `preview_brew`; `get_brew` for its displayed saved issue |
| New rule editor | `create_rule` with the current draft; dry run by default |
| Discovered feed choices | `add_feed` for discovered candidate URLs |
| Current result with available Undo | `undo` for that receipt |

Schemas narrow item/issue IDs and URLs to those controls. Reader targets, the
displayed Brew issue and rule drafts are bound to current UI state. Unmounting,
modal occlusion, responsive hiding, disabling the preference and leaving the page
remove registrations. Retained obsolete callbacks refuse execution. Native abort
signals cancel pending calls; page suspension stops tools and restoration
registers the current controls again. Cleanup preserves tools owned by other code.

Confirmed writes open a native review dialog with Cancel focused. Bulk read shows
the current unread count and scope; the server rechecks the reviewed revision
when committing. Cancel or unmount before approval sends no mutation request.
Reads and previews never mark articles read. Feed preparation checks cancellation
again after network work and before its transaction inserts anything. Cancellation
after a completed write does not reverse it; use its receipt/Undo. Successful
changes refresh the relevant UI and appear as **WebMCP** in the private activity
log. Enabled rules can also affect future ingestion, as explained in their review.

## Owner boundary and verification

In-page tools use the existing single-owner deployment boundary, not an MCP token
or a new login. The private/no-store/noindex catalog and invocation endpoints are
`/api/webmcp/tools` and `/api/webmcp/call`. Invocation requires a matching Origin;
both validate trusted loopback/configured hosts and reject cross-site requests.
Owner REST rejects bearer credentials. Browser mounting is a UI exposure policy,
not an additional authorization boundary for code already running in this origin.
Never expose owner routes without the existing network/reverse-proxy protection.

Node tests verify flag defaults/overrides, identical MCP schemas, origin/credential
rejection, actual writes/replay/Undo and cancellation including a real disconnected
HTTP request during feed preparation. Browser tests use the actual polyfill and
SQLite backend, native document/navigator fixtures, responsive/modal cleanup,
review cancellation, rule/feed/Brew actions, light/dark visual checks and phone
accessibility. The compiled smoke verifies catalog parity and a write/Undo outside
the repository working directory, retaining the scoped MCP recovery checks.
