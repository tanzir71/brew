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

A fifth journey selects saved rules and execution logs through native links,
reloads those URLs, returns through browser history, and opens reloadable feed
health/hidden-article views. Separate discovery tests follow actual saved Compose,
rule and settings JSON links, verify that GET does not save a dirty rule form,
and check newsletter list/article precedence and unsupported formats.

Two more role/label-only journeys follow actual Brew rule attribution links and
legacy rule-query bookmarks, then use native sender/letter links, keyboard opening,
reload and history. The latter verifies that a mismatched sender/letter URL never
opens or marks the unrelated letter read, including after that letter is cached.

An eighth role/label-only journey saves a scoped browser search by keyboard,
cancels saving and deletion, follows its native link with retained filters, and
deletes then restores it through actual browser storage after reload. It verifies
focus, polite feedback and zero server writes. Separate browser tests exercise
live updates in another tab, storage failures/retry, malformed data, minimum More
target size and light/dark save/confirmation dialogs with axe checks.

Two more role/label-only journeys exercise feed/folder name and retention editors,
Cancel and explicit Save, persisted reloads, native row links/More actions and an
independent folder assignment during a name edit. They also page through 501 hidden
articles, reload a selected page, verify its actual text twin, and recover the
empty last page after Unhide without losing other items. Separate browser cases
verify read/create/update/unhide failures and actual retries, draft preservation,
responsive native dialogs and light/dark axe checks.

ESLint restricts that file's UI selectors to `getByRole` and `getByLabel`, rejecting
CSS/test-ID/text/placeholder/title selectors and injected DOM evaluation. Browser
setup, navigation, response inspection and SQL assertions remain available to
provide real fixtures and independently verify results. Other suites can inspect
metadata and geometry directly; they do not substitute for this agent journey.

## Checklist coverage

| Requirement | Implemented evidence | Remaining work before the criterion is complete |
| --- | --- | --- |
| Landmarks | Existing Brew Library/main/In this Brew; named Reader Library navigation; real article landmarks inside Reader dialogs and newsletter panes; Compose now has a named main landmark. | Finish the view/dialog audit, including settings and older shell variants. |
| Native controls | Reader scope/folder/feed and saved-search bookmarks, saved-rule selection/logs and attribution, feed audit views, newsletter sender/letter/page navigation and legacy shell toolbar navigation use real hrefs. Feed-library names and hidden-page navigation also use native links. Feed/folder renames and retention now use native labelled dialogs. Article actions and bulk confirmation use real controls. | Audit all remaining navigation, icon-only labels and toggles. |
| Stable hooks | Article rows/panes share `data-brew-id`, kind and read/unread/starred/highlighted state. Reader/search rows also declare their actual density. Newsletter rows/panes and frozen Brew letters identify as letters; rules expose identity/enablement/actions; Compose already identifies sections. | Audit the rest of each screen's actions, settings and result rows. |
| Accessible alternatives | Article actions are available directly and in a native More sheet. Saved-search deletion, feed-library/folder, feed health and hidden rows have visible, labelled More controls and native sheets. Existing Compose drag controls retain button/keyboard alternatives. | Add/audit More equivalents and focus/selection behavior on remaining sender/settings rows and screens. |
| Polite results | Existing Compose/Brew status plus explicit Reader bulk, saved-search and owner-action result live regions with real Undo. Rule partial failures, mutation errors, browser storage failures, refresh failures and action-history recovery failures have visible feedback. | Audit success/error announcements for remaining mutations and error/retry paths. |
| Totals and pagination | Newsletter, Reader, search and feed-library/audit views announce showing ranges/totals. Counts remain available to assistive technology in Calm mode. Newsletter/Reader/search/hidden articles offer native Previous/Next links with URL page state; hidden counts exceed the legacy 500-item cap. Normal Reader/search retain virtual/infinite lists. | Remaining list announcements and agent-mode pagination without virtualization/motion/scroll marking. |
| Confirmation and undo | Reader bulk click/Shift+A, rule apply/delete, feed/folder deletion, library/Compose OPML import and browser saved-search deletion confirm through native sheets. Cancel causes no writes; actual server Undo restores changes, including cascaded feed articles/tags/logs and folder assignments. OPML Undo protects later uses of imported records. Browser bookmarks have separate local Undo with reload recovery. Existing Brew/Compose behavior remains tested. | Audit every other bulk/destructive path. Scoped agent tokens and the complete action-log settings UI remain later M12 criteria. |
| Text twins | All currently implemented data views have private twins: frozen Brews/articles; Reader/search; saved Compose/rules/logs; feed library/health/hidden articles; Newsletters lists; instance settings; Reader welcome and empty Brew/library states. Selection/filter parameters survive in alternate links. Explicitly opened content overrides its underlying page; subscription links remain separate. | Continue coverage when later milestones add views. Draft forms export explicitly labelled saved state; unsaved previews stay separate. The full DOM checkbox remains open for the other rows. |
| Visible state and targets | Read/star/tag changes update real controls and stable state; new article Open target is at least 24px; More/confirmation reuse existing controls. Newsletter navigation declares current selection, has visible keyboard focus and focuses an explicitly opened reading pane. | Full target-size/focus/overlay and post-action visibility audit across every implemented screen. |

## Browser saved-search bookmarks

Reader saves named queries through the existing native sheet and labelled input,
with keyboard submission, blank-name validation, Cancel and focus restoration.
New bookmarks retain canonical local search URLs with scope, folder/feed context,
density, unread and sort; reopening starts on page one. Legacy `{id,name,query}`
entries keep working. Stored URLs can only select the matching local search;
external, malformed or mismatched URLs fall back to the query. Reader/sidebar
subscriptions update after writes, browser storage events and retries. Compose
imports explicitly project the bookmark's name/query/client ID and keep their
existing stored source behavior.

Reader rows expose native navigation and an always-visible 28px More button,
with current-selection semantics and keyboard focus. More offers Open and Delete.
Deletion opens a second native confirmation with initial focus on Cancel. Confirm
persists a tab-local Undo receipt before removing the actual bookmark. Failed
storage or malformed data never produces optimistic removal or overwrites unreadable
data; errors keep the form/confirmation available for retry. Undo restores the
original position while reading current storage, keeps unrelated additions and
rejects a conflicting newer definition. It is safe to retry an already-restored
bookmark. The latest deletion can be undone for up to 30 seconds, including after
reload in that tab; expired recovery is discarded. Recovery belongs to that tab's session.

Results announce through a named polite live region. Delete moves focus to Undo;
Undo restores focus to the native bookmark link. Save/restore feedback can be
dismissed; the deletion receipt expires. Reader/search shortcuts respect
native dialogs and controls, so Enter activates the focused action or link.
These bookmarks and their recovery remain in browser storage; deleting one does
not remove a server-saved Compose search source. The Node action journal below
continues to govern server mutations. The broader DOM audit remains open.

## Feed library and audits

Feed/folder name editors and the retention editor reuse labelled native sheets,
focus containment, validation, Cancel/Escape and opener restoration. Save changes
waits for an acknowledged server response before replacing cached values; failures
retain the draft with an alert and allow retry. Retention accepts 1–3650 days and
has no blur write. Rename sends only the name, retaining independent changes to
folder assignments or retention. Library rows have native `/feed/:id` and `/f/:id`
links, stable feed/folder identity hooks and 28px More controls. Existing confirmed
server delete/Undo behavior stays available directly and through More.

Health and hidden views render the same shared action surfaces. Health feed names
link to `/feed/:id`; More exposes Open articles, Rename, Retention, Fetch now and
the existing confirmed Delete/Undo. Native modal transitions retain the original
row trigger, including editor/confirmation Cancel. A completed deletion focuses
Undo and actual restoration focuses the restored row's More control when that row
is present in the current view. Fetch failures
remain retryable; a completed fetch followed by a failed library read explicitly
states that distinction and retries only the read. Mobile status values include
accessible Last attempt, Fetch status and Consecutive failures labels.

Hidden names link to `/a/:id`; their 28px More opens native content links, private
Markdown/JSON and Unhide. Unsupported formats/deletion remain disabled with setup
badges/links inside the active dialog. Paged rows identify RSS articles and letters,
share actual read/star/highlight hooks and declare `data-brew-hidden="true"`.
Legacy hidden DTOs retain their four fields; only the opt-in paged DTO adds kind,
ISO reading-state dates and highlight color. Hidden page twins project that metadata
without bodies/originals or source addresses. Opening a content link follows the
existing explicit Reader behavior; GET metadata/twin reads remain read-only.

Unhide still waits for acknowledgement and preserves the numbered page. A failed
write restores the actionable row's focus. Successful removal focuses the next
content link (or the last remaining row); an empty/error page focuses its heading
and retains the explicit First page/read-retry path. Cancel stale list reads before
updating cached totals, then refill the exact page. Clear ephemeral row menus/editors
on browser history navigation. No extra confirmation is added for the single-item,
non-destructive Unhide operation; destructive deletion keeps confirmation and Undo.

Shared source query keys keep Compose's library consistent; reads receive abort
signals, while acknowledged changes invalidate Reader/newsletter metadata. Native
library, health and hidden-article views show loading and retryable read errors
before claiming an empty result. Creation and Unhide failures retain their inputs
or rows. A named polite result region announces actual outcomes, and showing ranges
remain available to assistive technology when Calm hides visible counts.

The default `GET /api/articles-hidden` keeps its legacy 500-item array contract.
`includeTotal=true&page=N` opts into `{items,total,page,pageSize}` with 50-item pages,
an exact joined count and deterministic date/ID ordering from one read transaction.
Paged responses are private/no-store; invalid page values return JSON 400. Hidden
HTML and `.md`/`.json` twins share `?section=hidden&page=N`, exact ranges and native
Previous/Next links. Missing page content offers an explicit First page link.
Unhide waits for acknowledgement and refills the page so shifted rows are not
skipped; a failed refresh states that Unhide finished and offers read retry.
Reads never unhide, extract, execute rules or write to the database. Exports omit
article bodies, originals and source addresses/configuration.

The remaining sender/settings/data/bulk/control/focus audit is still pending. These changes do not
complete the global DOM criterion or enable agent mode.

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

Saved-page twins are described below. The full URL/control audit remains open;
this does not complete M12 or enable agent-mode behavior.

## Saved-page twins

| Page | Text path before `.md`/`.json` | State |
| --- | --- | --- |
| Empty library | `/index` | Saved Brew names/identities, without generating an issue. |
| Reader welcome | `/reader` | Welcome content and Reader navigation. |
| Brew without an edition | `/b/:id/read` | Saved configuration; frozen editions keep their existing immutable twins. |
| Compose | `/b/:id/compose` | `section` and `sheet`; saved schedule, delivery enablement and section definitions. |
| Rules | `/rules`, `/rules/:id` | Selected saved definition; `tab=preview|log`. Preview evaluates matches without running actions. |
| Feed library/audit | `/feeds` | `section=feeds|health|hidden`; hidden views also retain `page`. |
| Newsletters list | `/letters`, `/letters/:senderId` | `view`, `page`, sender `sort`; exact filtered ranges and view unread count. Legacy `?sender=` filters remain readable. |
| Instance settings | `/settings/runs` | Current capabilities; `setup=...` mirrors the setup hash dialog. |

These formats deliberately read persisted server state. They never save an
unsaved form, generate an issue, execute a rule, mark a letter read or fetch a
publisher. Head links label saved configuration/rules explicitly; documents also
state their representation. Compose previews and dirty rule previews keep their
existing behavior. An unsaved section is not advertised as a stored identity.

The projections allowlist nested fields. Feed URLs, sender/inbound addresses,
delivery recipients, webhook URLs, provider configuration and raw log errors are
omitted; enablement/configured flags remain. Raw originals, cleaning metadata and
article HTML stay out of these page documents. Authored notes/conditions remain
content. Markdown escapes headings and renders structured properties as fenced
JSON so note markup cannot become executable HTML. All formats are private,
no-store and no-index, with matching media/alternate headers and HEAD support.

Saved rule selection/log state and feed subviews reload from canonical URLs.
New/default rule drafts use `/rules` and retain their unsaved state only in the
editor. A missing saved rule has an explicit visible error, and an empty log has
an explicit message. Late log responses cannot replace another rule's view.
The newsletter landing/list URL advertises the list even while its first letter
is implicitly previewed; explicitly opening a letter selects its content twins.

Newsletter HTML URLs use `/letters/:senderId/:articleId` for explicit content.
`scope=all` retains the All senders list; without it, the list belongs to the named
sender. View, page and sort survive navigation, reload and history. Native links
support normal modified clicks. The former one-ID letter shorthand is replaced
by the specified sender path; `/a/:id` article URLs are unchanged. Rule attribution
now links to `/rules/:id`; `/?view=rules&rule=:id&tab=log` still selects that rule.

Appending `.md` or `.json` to an explicit newsletter path returns its cleaned
content only after validating the sender/letter pair. Those formats share the
article renderer, private headers and no-write guarantees. Their HTML alternate
retains the bound newsletter URL; `/a/:id.md` and `.json` remain the canonical
content twins. Invalid or cross-sender identities return 404. The UI checks the
same identity before mounting the reading pane, including cached responses, so
an unrelated letter cannot be displayed or marked read by a mismatched URL.

Backend checks cover every path in both formats/HEAD, zero SQLite writes/network
effects, safe rendering, nested-field/credential redaction, precise selection,
filter counts and invalid/unsupported/error responses. Browser checks use the
actual Node fixture, inspect metadata, follow JSON outputs, retain dirty-form
boundaries and reload/history state. Compiled Node smoke covers these formats
and independent HTML routes outside the repository working directory. No static
publication is enabled, and no new dependency is required.

## Confirmed owner actions and Undo

Node advertises `actions.undo`. Other targets keep the destructive controls
disabled with a setup badge/link until their adapter provides it. This capability
does not enable agent tokens, MCP or other write access.

`POST /api/actions` accepts a confirmed `delete_feed`, `delete_folder`,
`delete_rule`, `apply_rule` or `import_opml` request. Rule application also accepts 1–3650 days
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

Both library and Compose OPML entry points first read `POST /api/opml/preview`.
This private/no-store endpoint accepts raw XML (or a JSON string), validates a
maximum of 1,000,000 UTF-8 bytes and returns exact new/skipped/folder counts plus
outline statuses without writing or fetching any feeds. Preview URLs omit
credentials and queries. Failed reads retain the in-memory file for explicit
retry. The native confirmation initially focuses Cancel and pages 50 outlines at
a time. Cancel causes no writes. Unsupported durable Undo keeps Import disabled
with a setup badge/link.

Confirming sends `{kind:"import_opml",opml,confirm:true,requestId}` through the
same owner action endpoint. The document is never stored in browser storage or
the audit arguments; the latter hold only its SHA-256 identity. The actual
transaction reports imported/skipped/created counts, keeps existing records and
journals only its writes. Duplicate-only imports have no Undo. The scoped Node
action body allowance accommodates JSON escaping without raising other limits.
Legacy `POST /api/opml/import` remains compatible; the owner UI uses confirmed
actions. Token authorization remains separate, unfinished M12 ingress work.

Undo atomically removes newly imported feeds/folders only while unchanged and
unused. Later articles, child feeds, saved Brew sources (v1/v2) and rule scopes
cause 409 with no partial removal. Unrelated later records survive. Reload and
lost-response retries recover the original receipt without reimporting. Compose
keeps imported feeds unselected; its accessible inline result stays inside the
source sheet. Undo prunes removed draft selections, while saved source references
protect the records. Additional role/label-only journeys verify both flows;
light/dark browser checks cover preview retry, paging, phone layout and axe.
