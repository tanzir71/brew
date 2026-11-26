# Agent DOM implementation

M12 is in progress. The nine-item DOM checklist and agent-friendly-mode criteria
are implemented and audited across current screens. Browser coverage includes
26 role/label-only journeys and ten DOM audit cases. OpenAPI 3.1 is implemented
and covered separately in [API discovery](agent-api.md).
The [MCP server](mcp.md) provides Node stdio and HTTP. [Agent access](agent-access.md)
provides scoped tokens, the activity log with Undo, setup snippets and private
settings twins. WebMCP and llms.txt remain unfinished criteria. Later screens must preserve these DOM contracts.

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

Two further journeys manage health/hidden row More controls, fetch and Unhide
retries, confirmed feed deletion and restored focus. Two sender journeys bring the
role/label-only total to sixteen: they cancel and confirm blocking, recover a lost
acknowledgement and reload Undo, submit a native settings form, preserve a cancelled
draft and an unrelated later preference, and restore actual pruned originals and
Brew routing. Separate sender checks cover stale reviews, capability gating,
cancelled/obsolete previews, missing Brews, light/dark axe and phone layouts.

A seventeenth role/label-only journey opens General and Reading through native
settings links, saves browser preferences, reloads and follows history, downloads
OPML from Data & backup, refreshes capabilities and verifies zero server writes
before opening Reader. It then verifies the actual saved article controls. Separate
checks cover shared values across tabs, failed writes/read retry, light/dark axe,
desktop/phone captures and fresh deep-link focus recovery.

Two more role/label-only journeys bring the total to nineteen. One reviews all
121 unread items while viewing page two, cancels without changes, recovers a lost
bulk acknowledgement and restores exact read states through reload Undo while
preserving its URL. The other reviews a frozen Brew section and whole edition,
reports an unavailable archived story, preserves already-read timestamps and
restores the actual rows without changing the saved payload. Six additional
browser cases cover light/dark review layout/axe/focus, stale scopes, atomic Undo
conflicts, cancelled/obsolete previews, unavailable capabilities and successful
writes followed by read outages.

A twentieth role/label-only journey opens articles by keyboard, checks initial
article focus and nested More/Escape restoration, then closes to the next unread
row and the empty search heading. Real automatic read writes remove the rows;
the test verifies both SQLite state and retained search filters. Additional
browser checks cover native modal/background inertness, Tab containment, docked
desktop geometry, phone/resize behavior, nested scroll locks, navigation without
focus theft, light/dark axe/captures, retry and rejected clipboard feedback.

The article surface is a native `dialog`. Overlays and phone panes use
`showModal()`; desktop panes use `show()` in a separate column beside the list.
Each surface has a named article landmark and visible native actions with stable
hooks. Closing returns to the visible Open button, a neighbouring visible row if
the item disappeared, or a focusable view heading. Late list refreshes repair
focus when a returned row is removed, without moving focus from another control.
Navigation and a newly opened article suppress obsolete focus restoration.
More actions use a separate native dialog; Escape closes only the active dialog.
Switching between pane and modal closes More and restores its button, while
retaining an open tag draft and the saved pane preference. Shared scroll locks
release only after the last native dialog closes, including during navigation.
Reader shortcuts run inside the article and respect input/select editing and
native Enter/Space activation. Tag opening waits for content instead of a timer.

A twenty-first role/label-only journey creates a tag in Reader, checks its actual
state in Newsletters, cancels a draft without writes, and submits the native
letter tag form by Enter. It verifies assignments and an unchanged frozen Brew.
Five additional browser cases cover failed tag reads, whitespace validation,
lost creation and assignment acknowledgements, retained drafts, idempotent
retries inside More, light/dark axe/captures, independent tag/star edits, native
form cancellation, and closing during creation without a later assignment.

Reader and newsletter tag editors share one acknowledged save flow. Library
reads have loading, error and retry states. Names remain until assignment is
acknowledged; a successful creation followed by an uncertain assignment says so
and reuses that definition on retry. Newsletter checkboxes remain a draft until
Save tags; native form submission supports Enter. Closing the article while
creation is pending prevents a subsequent assignment request. A request already
sent may complete; its result updates only that item's cached tags.

`PATCH /api/articles/:id/tags` accepts `{add:[id],remove:[id]}`. At least one of
the fields is required; empty arrays explicitly request a no-op. IDs are positive
safe integers, deduplicated and bounded to 500 per field; overlapping add/remove
sets are rejected. Node validates additions and applies only those membership
changes in one immediate SQLite transaction. Unrelated assignments, article
fields and frozen issues remain intact. Replaying the same membership change
does not write again. Responses and errors are private/no-store, no-index and
nosniff. Legacy replace-all `PUT` and name-unique creation `POST /api/tags` keep
their original contracts. New definitions remain in the library if assignment
cannot be confirmed; repeating creation reuses the same trimmed name.

A twenty-second role/label-only journey opens native shortcut help from a failed
Reader read, checks Tab/Escape restoration, retries the actual read and recovers
empty later Reader/search pages through First page links. Filters survive and
SQLite records no writes. Ten additional browser cases exercise initial loading,
failed retry focus, cached refresh failures, interrupted reads, explicit paging
retry, library metadata recovery, legacy toolbar help, light/dark axe and
desktop/phone captures. They retain the existing visual and performance budgets.

Reader and search pass AbortSignals to their requests. Initial failures do not
claim empty results or zero counts. Cached rows remain visible after refresh
failure and ranges identify the last loaded result. Infinite loading stops on
error, removes its loading sentinel and offers Retry more for the same cursor.
A retry preserves its native button through failed pending transitions; success
returns focus to the heading only when focus still belongs to that attempt.
An empty requested page after page one offers a canonical First page link with
the current scope, filters, density and search context. Library metadata reads
use the shared query cache, abort obsolete requests and fail independently of
article content. These read/recovery controls perform no mutations.

Shortcut help now uses the shared native modal sheet in Reader, Feeds and Rules.
Native focus containment, Escape/Done, backdrop clicks and trigger restoration
replace the old custom overlay. Reader shortcuts do not run behind it; opening
help clears a pending Go chord. Its controls meet the 24px target minimum. Shared
sheets distinguish selection dragging from a backdrop click and suppress their
own stale return-focus action after path/query navigation.

## Agent-friendly mode

The twenty-third role/label-only journey saves Agent-friendly mode through
Settings → Agent access, pages 121 real SQLite articles with native numbered
links, reloads and follows history, searches, and explicitly opens item 100.
Settings and list navigation cause no database writes; only the opened article
becomes read. Six additional browser cases verify URL mode, all 50 offscreen DOM
rows, exact 50/50/21 pages and totals, empty-page recovery, no loading ahead, no
scroll marking despite a saved enabled preference, disabled animation/transition,
Today groups, densities, folder/starred search and selected text twins.

Agent-friendly mode saves as a validated browser preference, defaults off and
updates mounted views and other tabs through the existing preference store.
`?agent=1` temporarily enables it without writing storage. A saved enabled setting
also applies to URLs without the flag. The visible switch edits the saved setting;
an explicit URL override explains why the mode remains on and offers a native
Use saved preference link. Failed saves retain the actual saved value and report
the failure. The Figma 15:2576 card is shared by the setup guide and the full
15:2295 Agent access page. The latter now includes scoped tokens, the activity
log with Undo, setup snippets, native focus recovery and private text twins.

Reader/search disable the virtualizer and automatic cursor loading, use separate
query identities and render ordinary document-flow rows for one 50-item page.
Current-page numbers, bounded neighbour links, first/last numbers, Previous/Next,
ranges and First page recovery use canonical URLs and restore the heading after
activation. Native j/k scrolling reaches actual DOM rows. Mode changes preserve
an open article and tag draft, with indices bounded to the current page. Existing
normal-mode virtual/infinite lists and visual baselines stay intact.

A root flag disables CSS animation, transitions and smooth scrolling before the
initial React render and tracks live preferences and history. Both Reader and
Reading settings disable effective scroll marking while retaining its saved
preference. Opening an article or choosing a read action remains an explicit
write. The URL flag survives canonical Brew/Compose/rule changes, newsletter
selection/paging, shared navigation and bookmarks. APIs, external links, assets
and text outputs are not rewritten. Selected page twins/discovery carry the
effective mode, including when it came from the saved setting; ordinary page
links do not turn that saved preference into a permanent URL override.

Three unit cases verify URL/preference precedence, preservation of reading state,
and safe flag propagation. Browser checks cover actual storage failures,
cross-tab mode changes with a retained tag draft, temporary-override removal,
native control sizing, light/dark axe and desktop/phone captures. The conditional
controls and legacy Rules feedback audit is completed by M12.18–M12.19 below. Shared
switches now expose a 24px native button around the unchanged 18px visual pill;
native checkboxes expose a 24px input around the existing 16px box.

## Native activation targets

`web/e2e/control-targets.spec.ts` measures application controls in 14 real view and
dialog states: primitive components, the shared sheet, Reader, article reading,
Rules, feeds, Newsletters, instance and reading settings, a generated Read edition,
Compose, source selection, Schedule & delivery, and the Briefs setup guide. It
checks native controls and their associated activation labels after fonts load,
scopes modal checks to the active dialog, and writes the measured defects to
browser-test artifacts. Inline publisher links in reading content are separate
from application controls. The test runs against Node/SQLite fixtures and keeps
the existing light/dark visual baselines.

Two more cases click the top and bottom of the native switch target and opposite
corners of the checkbox target in both themes. These points lie outside the
unchanged visual artwork. They verify actual activation, unchanged neighbouring
values and keyboard Space behavior. The shared controls retain native button /
checkbox semantics, labels, disabled states and focus. Hit boxes extend beyond
their original layout shells; a baseline marker preserves the switch's original
inline alignment. Compact text actions add clickable padding while cancelling
that padding's layout footprint. Drag handles retain their existing grip and
native drag / keyboard alternatives.

A twenty-fourth role/label-only journey clicks the padded edge of Copy on a real
saved rule, verifies the actual disabled copy in SQLite, edits native draft
controls, then clicks the padded Delete edge and cancels the native confirmation.
Draft changes and Cancel cause no further writes, and focus returns to Delete.
Geometry checks also cover labelled search/sort/title/numeric fields and compact
setup/navigation links. Existing Briefs setup links using `#setup-ai` now reach the
actual Briefs guide; the current Compose control uses `#setup-briefs` and retains
the agent flag.

This completes the shared-target defect identified in M12.16, rather than the
entire DOM criterion. M12.18 adds native Rules More actions and acknowledged feedback for Copy,
duplicate-filter saves and browser notification permission outcomes, described
below. The final M12.19 checklist audit below supersedes the open status at that checkpoint.

The client serializes tag writes per item, cancels obsolete detail reads and
patches only tags in article/newsletter caches. It refreshes dependent previews
after acknowledgement without replacing newer read/star/body/sender metadata.
Native tag actions identify the item with `data-brew-id` and the chosen tag with
`data-tag-id`. Action feedback appears in the active article or More surface.
Read/star results wait for acknowledgement, retain independent field failures
and retry their explicit desired state through the existing queued state writer.

ESLint restricts that file's UI selectors to `getByRole` and `getByLabel`, rejecting
CSS/test-ID/text/placeholder/title selectors and injected DOM evaluation. Browser
setup, navigation, response inspection and SQL assertions remain available to
provide real fixtures and independently verify results. Other suites can inspect
metadata and geometry directly; they do not substitute for this agent journey.

## Checklist coverage

This is the acceptance audit for the currently implemented screens. New screens
must keep these contracts; later M12 API, token and setup criteria remain separate.
The full gate result is recorded in PROGRESS.md.

| Requirement | Current implementation | Authoritative verification |
| --- | --- | --- |
| Landmarks | Library navigation and one main in Brew, Compose, Reader/search, Newsletters, Rules, Feeds and settings. Article/letter reading panes use article landmarks. Read editions have In this Brew. Saved rules and Rule preview have distinct sidebar names. | `dom-audit.spec.ts` checks eleven real screen/filter states, including landmarks and axe. `article-focus.spec.ts`, `runs.spec.ts` and the role/label journeys cover reading panes, settings and native dialogs. |
| Native controls | Navigation uses real hrefs; actions use native buttons/inputs. Icon controls have names, switches have checked state, and draft controls retain explicit labels. Section and article headings follow their actual page/group hierarchy. | The cross-screen DOM audit checks button tags/names, icon labels, hrefs and switch state. `components.spec.ts`, `keyboard.spec.ts`, `compose-keyboard.spec.ts` and all agent journeys exercise their native behavior. |
| Stable hooks | Article/letter/section/rule identities, action hooks and visible read/star/highlight state remain available. Feed/folder and execution rows extend the vocabulary with their actual identities. Rule draft and settings actions expose stable hooks too. | `agent.spec.ts` asserts content identity/state alongside real SQLite results. `dom-audit.spec.ts` checks identities across screens and exact execution rows; `control-targets.spec.ts` verifies named controls and actual edge activation. |
| Accessible alternatives | Row actions are visible directly or on focus/selection and are available in native More surfaces. Section drag handles retain Move up/down buttons and Alt+Arrow alternatives. Dialog focus stays contained and returns to a usable trigger/result. | `article-focus.spec.ts`, `audit-actions.spec.ts`, `sender-actions.spec.ts`, `rules-actions.spec.ts`, `compose.spec.ts` and `compose-keyboard.spec.ts` cover the alternatives, nested dialogs, Escape and focus. |
| Polite results | Mutation feedback waits for acknowledgement and uses polite result regions. Failed reads/writes have explicit retry. Undo restores a still-visible button after failure and a visible opener/result after its button is removed; later user focus/navigation takes precedence. | `dom-audit.spec.ts` covers lost Undo acknowledgement/retry and delayed Rules/Feed focus. Existing bulk, sender, OPML, storage, tag and recovery suites cover their active surfaces. |
| Totals and pagination | Reader/search, newsletters and feed-library/audit views announce exact ranges. Agent mode renders complete numbered DOM pages instead of virtual lists. Rules announce saved totals and Last loaded on refresh failure. All retained execution history has exact totals and 50-row pages; dry-run previews announce their full match total with a 50-item sample. | `agent-mode.spec.ts`, `reader-recovery.spec.ts`, `agent.spec.ts` and `dom-audit.spec.ts`; backend execution/twin tests cover 126 rows, ties, final/empty pages and read-only requests. |
| Confirmation and undo | Destructive/bulk paths confirm: rule apply/delete, feed/folder delete, read batches, OPML import, risky sender settings, saved-search deletion and Compose section removal. Cancel writes nothing. Server or browser-local Undo restores actual state with conflict/expiry protection; external effects are disclosed. | Node `actions.test.ts`, `read-actions.test.ts` and `sender-actions.test.ts`; role/label journeys plus `bulk-read.spec.ts`, `opml-actions.spec.ts`, `saved-searches.spec.ts`, `sender-actions.spec.ts` and `compose.spec.ts`. |
| Text twins | Current data views expose private Markdown/JSON twins and alternate links. Selected items, filters and execution pages agree with the UI; explicit reading panes take precedence. Draft editors clearly export saved state and projections omit credentials/private action errors. | Node `page-outputs.test.ts` and `reader-pages.test.ts`; `page-discovery.spec.ts`, `agent.spec.ts` and compiled smoke cover real links, responses, headers and page totals. |
| Visible state and targets | Every current action has pending/success/error or visibly changed native state. Native modals remain visible and contain focus. Application controls have targets of at least 24px, retaining existing Figma artwork and fonts. | `control-targets.spec.ts` measures fourteen core view/dialog states and tests actual pointer edges. Existing light/dark component, Compose, Schedule, Read and newsletter goldens plus browser axe/focus/failure suites remain required. |

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

The remaining settings/data/bulk/control/focus audit is still pending. These changes do not
complete the global DOM criterion or enable agent mode.

## Sender and letter actions

Sender-row More and the reading pane's sender-name button open native action
sheets. Letter read/star/tag, original, private Markdown/JSON and sender controls
remain available by keyboard. Read/star writes announce their actual outcome;
automatic read starts after mount subscriptions settle. More and read-state targets
are at least 24px. Cancel restores the opener, or the visible heading if resizing
hid it. Unsupported writes/formats show disabled controls with setup links inside
the active sheet.

The labelled sender form submits with Enter and sends only edited fields. Invalid
retention disables Save; invalid selectors retain the draft and show the server's
validation error. Only in Brew requires a real assigned Brew; a missing assignment
can still be disabled. Changing Inbox, blocking, routing or retention first calls
private `POST /api/newsletters/senders/:id/preview`. It reports readable changes and
exact prune counts without writes. Cancelling or navigating away aborts that read
and prevents a late preview from saving. The form stays intact underneath review.

Confirmed `update_sender` actions bind a canonical patch to the reviewed sender,
affected retention rows and relevant Brew state. Changed data rejects the review
before writing. Favorite and cleaning-only edits use the same action path directly.
Node journals actual settings, Brew configuration, original clearing and article
deletions in one transaction. The receipt provides 30-second local Undo and request
replay; lost acknowledgements use Check result and reload recovers recent Undo.
Undo restores actual rows after reopening SQLite, preserves unrelated later Brew
names and refuses overlapping changes atomically. No-op edits have no Undo.
Audit arguments retain patch hashes rather than selectors or message contents.
Undo cannot recover deliveries rejected while blocked. Legacy sender PATCH remains
compatible; no new database migration or dependency is needed.

## Browser preferences and data guides

Settings links open General and Reading at `#preferences-general` and
`#preferences-reading` on `/settings/runs`. Reload and history restore the dialog;
Done/Escape restores a visible opener, or the heading on a fresh deep link. Shared
Select labels reference a dedicated text span, so exact label lookup excludes
option text without changing the Figma layout. Setup guides use the same focus
contract; capability refresh has a named polite result.

One validated browser-preference adapter reads the existing keys without writing
defaults. General, Brew options, the legacy toolbar, Reader and article controls
share theme/privacy/landing/opening/read-on-scroll/typography values. Same-window
and storage events refresh mounted controls across tabs. A successful storage
write precedes visible value changes and polite feedback; failure keeps the saved
value and shows an error. A failed read preserves the last known values with an
explicit retry. Typography updates merge the latest JSON fields, preserving
unrelated preferences. Invalid stored values fall back safely without writes.
Preference actions have stable data-brew-action hooks. Browser preferences are
local; the instance-capability twins continue to describe server state.

Data & backup keeps full `.brew` transfer disabled for its later milestone and
offers the actual OPML export. GET/HEAD downloads are private/no-store/no-index,
read-only and contain RSS subscriptions/folders, excluding newsletter mailto
identities that the OPML importer cannot accept. The native download is checked
separately from seeded API round-trip/no-write checks: Chromium downloads can
bypass the fixture's browser request interception and reach the real dev server.
The captured v1 export body/status/other headers remain unchanged; the contract
test explicitly requires the new private-cache and no-index headers.

## Confirmed bulk reads

Reader click/Shift+A and Brew section/edition Mark read share the journalled
`mark_read` owner action. `POST /api/actions/mark-read/preview` accepts a canonical
Reader scope (`all|today|starred`, optionally one feed/folder) or explicit item IDs.
It returns only an exact unread count, unavailable-item count and revision under
private/no-store/no-index headers, without writes or content/source details.
Reader previews cover the full scope before pagination and retain hidden/muted
and Only in Brew visibility rules. Explicit Brew IDs preserve access to letters
included in that edition. Duplicate IDs are canonicalized; large ID lists are
queried in bounded chunks.

Native confirmation is bound to the previewed state. Cancel focuses its opener
and writes nothing; failed previews retry the same scope. Navigation, unmount
and explicit cancellation abort reads and prevent late previews from submitting.
No-op review keeps confirmation disabled. Unsupported writes remain visible with
Badge/setup links. Read results use a named polite Bulk read result region, and
post-Undo focus returns to the trigger or a visible toolbar fallback. Native
Enter/Space activation takes precedence on buttons/links; letter shortcuts remain
available after restoring toolbar focus.

The server rechecks the revision inside one SQLite transaction and updates only
reviewed unread rows. Journalled read timestamps, a stable request identity and
30-second Undo support lost-response Check result, reload and a new connection.
Already-read timestamps and frozen issues remain untouched. Later Star changes
survive restoration; conflicting read changes reject the entire Undo. Audit args
retain target hashes and revisions instead of article IDs or content. A write
followed by a view outage reports completion plus a refresh failure; Reload only
reads again. Existing legacy mark-all endpoints retain their captured contracts,
while the current UI uses the confirmed action path.

Static visual/keyboard fixtures use an isolated transport stand-in for the new
routes. It is not the evidence for server behavior: backend transaction/replay/
scope/expiry tests and the role-only Node/SQLite journeys verify actual changes.

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
`delete_rule`, `apply_rule`, `import_opml`, `update_sender` or `mark_read` request.
Sender and read actions require their current preview revision. Rule application also accepts 1–3650 days
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


## Saved rule actions and settings feedback

Each saved row retains its direct Edit, Copy, Delete, Logs and Apply controls and
adds a labelled native More button. The shared modal provides real Edit/log hrefs
with selection and temporary agent-mode parameters, contains keyboard focus,
closes on Escape and restores its opener through nested confirmation. Copy,
Apply and Delete remain visible and disabled with setup guidance when durable
owner actions are unavailable. Preview and log rows expose stable identities.
The editor waits for the initial saved-definition read before accepting input;
subsequent refreshes retain unsaved edits. A Save acknowledged while typing binds
the new saved ID without replacing the newer draft, so its next save updates the
same rule. Save still uses the existing REST contract; an unconfirmed Save asks
the user to refresh and inspect saved rules before creating another.

Copy sends `{kind:"copy_rule",id,definition,confirm:true,requestId}` to private
`POST /api/actions`. The definition is the canonical saved snapshot, excluding
volatile execution counters. Node hashes it for the private audit, so copying
works on plain-HTTP installations without browser Web Crypto digest support.
Changed definitions fail before writes.
The SQLite transaction appends a disabled copy and journals only that insertion;
it does not run actions, fetch webhooks, send notifications or modify the source,
articles, execution logs or frozen issues. Audit arguments contain only source ID
and SHA-256 revision, while private journal bodies follow the existing 30-second pruning.
Request identity replay precedes source lookup, including after Undo or source
deletion. Browser **Check result** reuses that identity after a lost response.
Reload recovers the receipt and real Undo. Undo removes the inserted rule only
while unchanged and without later execution history; conflicts are atomic.
A late Copy result does not replace a newer draft or navigate a changed editor.

Rules, feed/folder choices, execution logs and debounced previews use independent
abortable query identities, explicit pending/error states and native read retries.
Failures do not claim an empty library, zero matches or no execution history.
Previously loaded rules survive refresh failures. Refresh rules does not reset a
draft. These changes retain the existing legacy page; they do not claim the full
Figma Rules frame has been rebuilt. Fresh frame 13:1737 informs the saved-rule
vocabulary, while the unspecified More surface reuses the native Sheet/Button/
Icon primitives. Phone grid containment keeps the editor within its column.

The duplicate-filter checkbox retains its last acknowledged value during PUT,
serializes writes, and disables competing choices until completion. A failed or
lost acknowledgement offers an explicit retry of the same boolean setting; it
cannot create a duplicate record. Initial reads have a separate retry. The
setting applies to future ingestion through the existing backend contract.
Notification requests run only from the native button, catch browser failures and
report granted, denied, dismissed or unsupported outcomes in a named polite
region. Denied permission includes browser-settings guidance.

Four backend regressions verify exact copied definitions/no execution, canonical
revisions, stale input/no writes, replay on a new SQLite connection, actual Undo,
conflicting later edits/logs, rollback, expiry, private HTTP validation and request
identity collisions. Fourteen browser cases cover native light/dark and phone
surfaces, axe, focus, stale sources, capability gating, lost acknowledgement/reload
Undo, late Copy/Save drafts, a missing saved rule, filter recovery, independent reads and five permission
outcomes. A twenty-fifth role/label-only journey exercises More, Copy recovery,
reload Undo and the saved filter against actual Node/SQLite state. Compiled smoke
checks Copy/replay/Undo outside the repository working directory.

The M12.19 acceptance audit below adds complete execution totals/paging, old-shell
landmarks, native-control checks and removed-Undo focus coverage to this evidence. OpenAPI, MCP, WebMCP, scoped tokens,
the full action-log/settings view and llms.txt remain separate M12 criteria.


## M12.19 acceptance audit

Execution history now uses private `GET /api/rules/:id/executions?page=N` with
`{items,total,page,pageSize}`. Pages contain 50 rows in descending execution time
and ID order, including ties. Count and rows share one read transaction. Missing
rules return 404, malformed pages fail validation, and empty/outdated pages offer
a native First page link. The legacy `/logs` array remains limited to 100 rows
for existing callers. Current Rules UI and its twins use the complete page API.
Canonical log URLs retain page, selected rule and temporary agent mode through
reload/history; navigation preserves an unsaved editor draft. Cached counts are
explicitly Last loaded when refresh fails, and missing initial data does not
claim zero executions. Opt-in `POST /api/rules/preview?includeTotal=true` counts all visible matches without running actions and returns a 50-row sample. Its count and sample are also in saved preview twins; the legacy response stays unchanged.

The native page controls are shared with Reader and retain its existing graphics.
Fresh Figma 13:1415 context confirms the numbered-pagination vocabulary; no new
static asset is needed. The pre-existing Rules layout is retained. Compose card
headings and Reader row headings use their actual parent/group level. Card
tracking stays explicit so app-level h2 styles cannot change the Figma text.

The shared result tracks whether Undo still owns focus, including disabled-button
focus loss during a request. Failure returns to the visible Undo button; success
or expiry can return to a visible opener/result. Existing bulk, sender and feed
restoration also check ownership. Focus or pointer movement, browser history,
window blur and unmount cancel obsolete restoration. Pagination likewise restores
its heading only while the initiating page/control still owns the interaction.

A twenty-sixth role/label-only journey reads all three execution pages, follows
the matching real JSON twin, verifies no read writes, retains a draft, copies a
rule and restores actual state with keyboard Undo after reload. Ten DOM audit
cases cover exact/stale totals, two themes and phone captures, read retries,
obsolete focus, lost Undo acknowledgement and delayed Feed/Rule Undo, then check
eleven real screens/filters for landmarks, native controls, identities and axe.
Three backend regressions and compiled smoke verify full history beyond 100 rows,
private GET/HEAD, canonical paging, unchanged legacy arrays and redacted twins.
