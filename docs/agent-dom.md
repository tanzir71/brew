# Agent DOM implementation

M12 is in progress. Passing the core journey does not complete the nine-item DOM
checklist or the later agent-mode, OpenAPI, MCP, token/log, WebMCP and llms.txt work.
The M12 DOM acceptance checkbox stays open until the remaining work below is done.

## Current evidence

`web/e2e/agent.spec.ts` drives the actual Node API and SQLite through the UI. Its
fixture seeds a library and one Brew; subsequent triage, exports and writes use
real controls. The journey opens an article, reads/stars/tags it, creates a tag,
uses the More sheet, opens Markdown and JSON in new tabs, cancels then confirms
bulk read, undoes the actual scoped server update, saves a rule, changes a Compose
section and channel preference, and generates an issue. It asserts both visible
state/hooks and persisted results.

Two additional role/label-only journeys cancel, confirm and undo rule application,
rule deletion, feed deletion and folder deletion; recover Undo after a page reload;
and recover a lost deletion acknowledgement without repeating the mutation. A
failed recent-action read offers an explicit retry. The shell's Reader, Brew,
Rules and Manage feeds navigation also uses native links with reloadable URLs.

A fourth role/label-only journey uses numbered Reader pages, unread/sort/density
filters, reload and browser history, and folder/starred search scopes. It opens
real list/search JSON twins and verifies that their filters and totals match the
current view. Reader list metadata takes precedence only until an article opens;
the article's existing higher-priority twins remain authoritative while open.

ESLint restricts that file's UI selectors to `getByRole` and `getByLabel`, rejecting
CSS/test-ID/text/placeholder/title selectors and injected DOM evaluation. Browser
setup, navigation, response inspection and SQL assertions remain available to
provide real fixtures and independently verify results. Other suites can inspect
metadata and geometry directly; they do not substitute for this agent journey.

## Checklist coverage

| Requirement | Implemented evidence | Remaining work before the criterion is complete |
| --- | --- | --- |
| Landmarks | Existing Brew Library/main/In this Brew; named Reader Library navigation; real article landmarks inside Reader dialogs and newsletter panes. | Audit every other implemented view and dialog, including settings and older shell variants. |
| Native controls | Reader scope/folder/feed and legacy shell toolbar navigation use real hrefs. Rows offer real Open buttons; pointer convenience preserves normal card clicks. Article actions and bulk confirmation use real controls. | Audit all remaining navigation, icon-only labels and toggles. |
| Stable hooks | Article rows/panes share `data-brew-id`, kind and read/unread/starred/highlighted state. Reader/search rows also declare their actual density. Newsletter rows/panes and frozen Brew letters identify as letters; rules expose identity/enablement/actions; Compose already identifies sections. | Audit the rest of each screen's actions, settings and result rows. |
| Accessible alternatives | Article actions are available directly and in a native More sheet. Existing Compose drag controls retain button/keyboard alternatives. | Add/audit More equivalents and focus/selection behavior on remaining rows and screens. |
| Polite results | Existing Compose/Brew status plus explicit Reader bulk result and owner-action result live regions with real Undo. Rule partial failures, mutation errors, refresh failures and action-history recovery failures have visible feedback. | Audit success/error announcements for remaining mutations and error/retry paths. |
| Totals and pagination | Newsletter, Reader and search announce exact showing ranges/totals. Reader/search offer native Previous/Next links with URL page state while retaining normal virtual/infinite lists. | Remaining list announcements and agent-mode pagination without virtualization/motion/scroll marking. |
| Confirmation and undo | Reader bulk click/Shift+A, rule apply/delete and feed/folder deletion confirm through native sheets. Cancel causes no writes; actual server Undo restores changes, including cascaded feed articles/tags/logs and folder assignments. Existing Brew/Compose behavior remains tested. | Audit every other bulk/destructive path. Scoped agent tokens and the complete action-log settings UI remain later M12 criteria. |
| Text twins | Frozen Brew twins/feeds plus private article, Reader list and search twins. Current list filters/page/density are retained in alternate links and exported documents. Selected article discovery overrides the underlying page twins and restores them on close; subscription links remain separate. | Compose/rules/settings/newsletter lists and other page twins and alternate links, matching current URL state. |
| Visible state and targets | Read/star/tag changes update real controls and stable state; new article Open target is at least 24px; More/confirmation reuse existing controls. | Full target-size/focus/overlay and post-action visibility audit across every implemented screen. |

## Article twins

`GET`/`HEAD /a/:id.md` and `/a/:id.json` use portable core renderers and Hono routes,
with narrow forwarding through Node and Vite. They prefer cleaned extracted full
text, then stored content/summary. Rich HTML is sanitized again and Markdown uses
the existing safe converter. They resolve local links/proxied images with the
request origin or configured canonical origin, and omit raw newsletter originals,
cleaning details, source configuration and mutable reading state.

The responses are private/no-store/no-index with explicit media types and Link
headers. Missing or malformed IDs return JSON errors rather than a SPA/latest
fallback. Reads never mark items read, extract content or write the database.
Capabilities govern availability and discovery. Unsupported formats remain
visible with a setup path. No static publication is enabled.

Backend tests verify real SQLite read-only behavior, cleaned content, canonical
URLs, media types/HEAD and invalid identities. Browser tests verify alternate-link
precedence/restoration, direct HTML article URLs and unavailable-format discovery.
Compiled Node smoke verifies article twins and the separate HTML SPA route outside
the repository working directory. The captured v1 DTOs remain unchanged.

## Reader and search pages

Reader navigation supports `/all`, `/today`, `/starred`, `/f/:id`, `/feed/:id`
and `/search?q=...`. Existing root-query bookmarks still open. Page number,
density, unread and sort filters live in the URL. Search scope and folder/feed
context survive reload; Close search returns to its source, and browser history
restores the selected view. Changing filters starts again on page one. Normal
Reader/search retain their virtual/infinite lists; their native Previous/Next
links also let a caller jump directly to a numbered page.

`GET`/`HEAD` twins append `.md` or `.json` before query parameters, for example
`/f/7.json?page=2&unread=true&sort=oldest`. Documents contain the current 50-item
page, exact filtered total/range, source titles and reading state, canonical
Previous/Next links, and article/content-twin links. They omit raw originals,
cleaning/configuration fields and article HTML. Markdown escapes authored titles;
JSON uses explicit fields. All responses are private/no-store/no-index, with
media types and alternate Link headers. Reads never extract, mark read or write.
Invalid filters/identities or absent sources return errors rather than HTML or
a latest-page fallback. Configured canonical origins govern content links.

The existing article/search endpoints add `total` only with
`includeTotal=true`; old callers retain their captured DTO keys. Reader totals
use the same visibility, date, scope and unread predicates as the rows but are
independent of cursor/offset. FTS totals share search predicates and retain
explicit search access to letters available only in a Brew. Explicit sort
requests use chronological order; legacy search callers without a sort keep
relevance ordering. The UI announces
actual showing ranges and uses the existing Figma Reader footer pattern and
controls. Unavailable text formats stay visible, disabled, with a setup path.

Browser checks cover actual filter/page exports, reload/history, text metadata
and article precedence/restoration. Backend tests cover filtered totals beyond
the first page, cursors, source visibility, invalid inputs, content links,
private fields, HEAD/read-only behavior and legacy response keys. The compiled
Node smoke also exercises list/search twins and the independent HTML SPA routes.

Compose, Rules, settings and newsletter list twins and the full URL/control
audit remain open; this does not complete M12 or enable agent-mode behavior.

## Confirmed owner actions and Undo

Node advertises `actions.undo`. Other targets keep the destructive controls
disabled with a setup badge/link until their adapter provides it. This capability
does not enable agent tokens, MCP or other write access.

`POST /api/actions` accepts a confirmed `delete_feed`, `delete_folder`,
`delete_rule` or `apply_rule` request. Rule application also accepts 1–3650 days
(30 by default). Confirmation is mandatory; missing confirmation returns 428.
The browser creates one request identity for each confirmation sheet and retains
it across retries. A repeated identity returns the same result; using it for
different arguments returns 409. A lost acknowledgement offers **Check result**
and **Close**, since the original mutation may already have completed.

`GET /api/actions` returns the last 20 public receipts, allowing reload recovery.
`POST /api/actions/:id/undo` restores the actual local changes for 30 seconds
after completion. These private/no-store endpoints return summaries and Undo
availability, never stored undo bodies. Legacy REST DTOs/routes stay compatible.

Migration 0010 creates the audit and per-write change journal. SQLite triggers
record each synchronous write and its foreign-key cascades in the same
transaction. The active flag is off across asynchronous rule work, so unrelated
requests do not enter its journal. Updates record only changed columns. Undo
checks expected values, reverses records in order and runs atomically; later
conflicting changes or uniqueness constraints cause 409 without partial restore.
Unrelated later edits are retained. New reusable tag definitions remain, while
their assignments are undone. Full deleted articles, including private original
mail, are restored only locally; no content is published.

Undo data survives a new connection or restart. Expired change rows and undo
metadata are removed on startup, reads and a five-second sweep; audit summaries
remain. Active rule runs are exempt from pruning, and shutdown drains them before
closing SQLite. An interrupted rule is reported as interrupted; its local
changes remain undoable within the window and external requests are not replayed.
Rule-action failures produce a visible partial-failure summary. Notifications
and webhooks cannot be recalled, as disclosed before confirming such a rule.

Focused backend coverage includes exact cascaded restoration/FTS, new-connection
recovery, request identity replay, concurrent async work, expiry, atomic conflict
rejection, partial failure and private HTTP metadata. Browser coverage verifies
the actual confirmation, Cancel, retry, reload, visible result and Undo controls.
