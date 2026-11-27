# Brew

[Website](https://brew-reader.vercel.app/) · [Interactive demo](https://brew-reader.vercel.app/demo)

> A local-first, single-user RSS reader. Your feeds, articles, and rules live in one SQLite file on your machine — **no account, no cloud, no telemetry.**

## What is this?

Brew fetches your RSS/Atom feeds, stores everything locally, lets you build rules to triage articles, and produces daily "Brew" snapshots — a curated daily digest built from your own subscriptions. It is intentionally single-user: one person, one machine, one database file you can back up by copying it.

Node also offers [Google Reader and Fever compatibility APIs](docs/reader-api.md)
with a separate generated app password, shared read/star state and subscription
management. App access defaults off. Open Settings → Apps & sync to copy protocol
URLs, generate or rotate the app password, and follow per-client instructions.
The owner waived M13's native-client capture replay check; compatibility evidence
comes from protocol integration tests.

## Architecture

Cloudflare's Worker target and a resumable deployment CLI are in development.
See [installation and release status](docs/cloudflare-install.md) and
[runtime limits](docs/cloudflare.md). The local CLI tarball includes the actual
Worker/WASM, web assets and canonical migrations; public npm publication is pending.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Ftanzir71%2Fbrew%2Ftree%2Fmain)

```
                       your machine
┌──────────────────────────────────────────────────────────┐
│                                                            │
│   packages/web/ — React SPA                                │
│   reading UI · feed management · rules · Brew snapshots    │
│        │                                                   │
│        │  HTTP (dev: Vite :4401 proxies → API :4400;       │
│        │        prod: one Fastify process serves both)     │
│        ▼                                                   │
│   targets/node/ — Fastify transport and platform adapters  │
│   packages/api/ — portable Hono REST router                │
│   packages/core/ — rules, ingest, search, Brew composition │
│   packages/db/ — shared Drizzle schema and SQL migrations  │
│        │                                                   │
│        ▼                                                   │
│   data/brew.db — SQLite (auto-created & migrated on boot)  │
│   feeds · articles · rules · snapshots                     │
│                                                            │
│   packages/core/src/types/ — shared TypeScript contracts   │
└──────────────────────────────────────────────────────────┘
              │ feeds + configured mail
              ▼
      the feeds you subscribe to
```

Why it's shaped this way: npm workspaces keep one domain core usable in Node, Workers, the browser and CI. The core uses storage, search, fetch, clock, hash and regex ports; the Node target supplies SQLite and platform operations. Hono owns REST routing through injected service interfaces. Production still runs one process (Fastify hosts Hono and the compiled SPA) with one file of state (SQLite + WAL). Network connections serve your subscribed feeds and services you explicitly configure, including optional inbound mail.

`GET /api/capabilities` describes the active target and its supported features.
Web components read it through `useCapabilities()`. Features remain unavailable
until their implementations are wired in; malformed responses and failed refreshes
do not expose capability data to feature controls.

Open `/settings/runs` (or the Reader's Mode chip) for the current instance,
capability table, and setup guides. Unavailable connections stay visible. Complete
`.brew` transfer is disabled until the cross-target archive support arrives;
the data guide offers the existing OPML export and Node backup command.

Settings → **General** and **Reading** open native dialogs at
`/settings/runs#preferences-general` and `#preferences-reading`. Changes save in
this browser immediately: theme, image privacy, default landing page, article
opening mode, read on scroll and typography. Brew options and Reader controls
share those values, including across open tabs. Failed storage writes keep the
saved choice and show an error; unavailable reads have a retry. Changing the
default landing page takes effect the next time you open the root URL.

## Getting started (from zero)

### Prerequisites

| Tool        | Why        | Get it                     |
| ----------- | ---------- | -------------------------- |
| Node.js 22+ | Development and builds (including Cloudflare tooling) | <https://nodejs.org> (LTS) |

The compiled Node server still supports Node.js 20+. Cloudflare's development
toolchain requires Node.js 22 or newer.

### Development

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:4401>. Vite serves the React app on `4401` and proxies API requests to Fastify on `4400`. First boot creates and migrates `./data/brew.db` automatically — there is no database to set up.

### Production

```bash
npm run build
npm start
```

Open <http://127.0.0.1:4400> — one process now serves the app and the API.

Environment knobs: `BREW_DB_PATH` points at a different SQLite file; set `NODE_ENV=production` when invoking the compiled server directly.

### Quality gates

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `npm run typecheck` | TypeScript strict check                           |
| `npm run lint`      | Generated tokens, semantic colors and code style  |
| `npm test`          | Unit tests                                        |
| `npm run test:e2e`  | Playwright end-to-end (starts dev servers itself) |
| `npm run build`     | Production build                                  |

## Project structure

The [Cloudflare target](docs/cloudflare.md) is under implementation. Its D1 Reader
and Brew APIs, rules, sources, newsletter management, OPML, Reader-sync state,
durable actions, scoped MCP credentials/tools, interruptible WASM regex, lease-fenced
polling with redirect accounting and native MIME ingestion run in bundled
workerd tests alongside verified D1/R2 storage ports. The product Worker now
connects fetch, scheduled and Email Routing handlers with Cloudflare Access and
private assets. Optional Resend delivery shares the same mail port as Node and
the invocation's fetch allowance. The installer and deploy-button template are
implemented locally; M14 stays open for public release availability. Read the
[installation guide](docs/cloudflare-install.md) and resource bounds before deploying.

```
packages/core/   portable domain services, ports and shared types
packages/db/     canonical Drizzle SQLite schema and SQL migrations
packages/api/    Hono REST router with target-independent service interfaces
packages/cli/    resumable Cloudflare deployment package and generated payload
packages/web/    React SPA and Vite configuration
targets/node/   Fastify transport, SQLite, feed fetching and platform adapters
server/         unchanged v1 unit tests, fixtures and compatibility exports
web/e2e/        Playwright flows and visual baselines
shared/         compatibility exports for v1 type imports
data/           local runtime data (git-ignored)
PROGRESS.md     milestone checklist and decisions
```

Run the quality gates from the repository root. The root scripts orchestrate the
workspaces; `npm run dev --workspace @brew/web` also starts the SPA independently.
The production build copies the SPA and migrations into `dist/`, so runtime
asset paths resolve relative to the built target rather than the working directory.

The Figma color, dimension, elevation and typography values are recorded with their source
frames in `design/tokens.json`. After updating the manifest, run
`npm run tokens:generate` to rebuild `packages/web/src/styles/tokens.css`.
Tailwind's semantic colors, spacing, radii, shadows and font families read these CSS variables;
the existing `data-resolved-theme` attribute switches the palette.
`npm run tokens:check` rejects stale output and stone/amber utilities in the app, and runs
with lint and production builds. Preview both palettes at `/test/colors.html`
during development, or `/test/type.html` for all 17 type styles. The `type-*`
utilities apply each style's family, size, line height, weight and tracking.
Fonts are served locally with swap loading; browser tests check actual custom
font use, both WOFF2 subsets and no third-party font or stylesheet requests.

The shared [component library](packages/web/src/components/README.md) includes
the Figma primitives, repeated patterns and controlled modal/side sheets.
Preview `/test/components.html` in development, with `?view=icons`,
`?view=composites` or `?view=sidebar` and `&theme=dark` for other fixtures.
`npm run icons:generate` rebuilds the inline sprite from the 53 original exports;
lint and builds check the source checksums and generated output.

`npm run typography:check` enforces normal font styles in app and marketing
CSS, JSX, scripts and SVGs, and runs with lint and builds. Global resets keep
semantic emphasis tags in articles and feed summaries upright. Tailwind scans
only the web source and browser fixtures so adversarial test strings do not
generate italic utilities in shipped CSS.

Read an edition at `/b/<brew id>/<issue id>`, or use the date controls to move
through its archive. The Read view has lead, magazine, grid and headlines
layouts, selectable article actions, scoped mark-read with confirmation and
Undo, a contents rail and reading progress. Issue content stays frozen;
`/api/brews/:id/state` supplies current library read/star states and applied rules.
Opening an article from Brew, Reader or search marks it read in the shared
library. Mark unread and star changes update live article, list, search and Brew
state, including archived issues, while their saved content stays frozen. Article
content opens before the read write completes. Failed writes restore confirmed
state and allow retry; queued actions on one article keep their order. Reader's
optional read-on-scroll has an explicit retry for failed saves, and bulk read/Undo
refreshes both views. Selecting a Brew card alone does not mark it read.

Reader **Mark all read** reviews every unread item in its current feed, folder or
view, including items beyond the loaded page. Brew section/edition actions review
their frozen item IDs and report stories no longer in the library. Cancel writes
nothing. Confirmation marks the reviewed unread set in one transaction, preserving
already-read timestamps and frozen issue content. A changed scope requires another
review. The result offers actual 30-second Undo, including after reload; a lost
response offers **Check result**. Undo preserves unrelated Star changes and refuses
overlapping read edits. Unsupported bulk writes stay disabled with setup guidance.
Bulk reads, OPML import, rule application/deletion and feed/folder deletion use confirmation sheets with
30-second server Undo. Recent Undo survives reload; retries recover the same
result. Later conflicting edits prevent restoration, and notifications/webhooks
cannot be recalled. See [owner actions and Undo](docs/agent-dom.md#confirmed-owner-actions-and-undo)
for retention, API and capability behavior. The nine-item M12 DOM checklist is
implemented and audited across current screens.
Reader uses `/all`, `/today`, `/starred`, `/f/:id`, `/feed/:id` and `/search?q=...`,
with reloadable filters and numbered pages. Lists announce exact totals and
offer private Markdown/JSON twins, for example `/all.md?unread=true&page=2`.
Opening an article selects its content twins; closing restores the list's links.
See [Reader pages](docs/agent-dom.md#reader-and-search-pages) for query and output
behavior. Normal lists keep their virtual scrolling; agent mode uses complete
numbered pages.
Other implemented views expose private [saved-page twins](docs/agent-dom.md#saved-page-twins),
including Compose, Rules/logs, feed health/hidden articles, Newsletters lists,
instance capabilities and empty states. Alternate links retain selection/filter
state. These reads export saved state, omit credentials and never commit a draft
or execute its actions. Saved rule and feed audit URLs also survive reload.
Legacy `hero` and `list` layout names remain readable during the v2 migration.
Compose at `/b/<brew id>/compose` edits v2 sections with serial autosave,
multiple library sources, layouts, depth, image/unread options, Rules-grade
filters, per-section days and Markdown Notes. Web, sandboxed Email and Atom
previews use the current unsaved draft without creating an issue. Make one now
flushes the draft before generating a frozen issue. Email, AI Briefs and
newsletter sources show their setup requirements; their delivery/ingestion work
remains in subsequent milestones.

Migration 0006 preserves original legacy sections and frozen issue payloads,
while adding the canonical Compose model. Node applies its portable data step
(`packages/db/src/composition-migration.ts`) in the same transaction as the SQL;
future targets must do the same. Old REST config routes retain their v1 shape;
Compose uses `/api/brew-configs/:id/composition` and `POST .../:id/preview`.
For a dry run, post `{ "at": "2026-11-27T07:00:00+06:00" }` to
`/api/brew-configs/:id/preview`. The saved Brew is used unless an optional `draft`
is supplied. Timestamps must include `Z` or a UTC offset; impossible dates and
ambiguous local times are rejected. Omitting `at` previews the next proposed
scheduled time, including for a paused Brew. The core `previewBrew(id, at?, draft?)`
method exposes the same behavior for future tool adapters.

Dry runs use the current library, restricted to articles published by `at`, with
rolling 24-hour Today and seven-day Weekly review windows. Per-section days use
the Brew's IANA zone. They do not reconstruct past read/star state or fetch future
articles. Previewing does not save a config or issue, consume an issue number,
send mail, run a webhook or prune the archive. Stored issue content stays frozen
when library articles or Compose settings change.

Core issue renderers in `packages/core/src/brew-outputs.ts` produce responsive web
HTML, 600px table-based email with inline styles and a plain-text alternative,
Markdown, content-only JSON, Atom and JSON Feed 1.1. Compose uses these same
renderers. Email deliberately stacks every layout in a single column for client
compatibility; the web output preserves all four layouts. Both HTML documents
use Brew's light/dark palette and normal typography.

Renderers consume frozen v2 snapshots, preserve section order/depth/image choices,
re-sanitize bodies and never query the library or change reading state. JSON
omits mutable state, source/filter configuration and delivery details. Feed
renderers accept the issue archive (newest first, one entry per whole issue),
with stable issue IDs and deterministic empty-feed metadata. Their formats follow
[Atom RFC 4287](https://www.rfc-editor.org/rfc/rfc4287) and
[JSON Feed 1.1](https://www.jsonfeed.org/version/1.1/).

Pass the instance origin as `baseUrl` when rendering externally consumed output.
Email previews retain local links and proxy images before an origin is supplied;
feeds omit unresolved local URLs. These are private owner outputs: this renderer
layer does not publish files. Output HTTP routes are now available in Node; SMTP and JSON webhook delivery are also available in Node.

Use the Read rail’s Markdown or JSON links for the selected frozen issue:
`/b/<brew id>/<snapshot id>.md` and `.json`. The immutable snapshot ID is the same
identifier used by the existing Read URL and `/api/brews/:id`; v2 issue numbers
are display metadata. Links from feeds use that exact Read URL as well. This
keeps interleaved Brews and mixed legacy/v2 archives unambiguous.

Enable **Atom and JSON feed** in Schedule & delivery to subscribe at
`/b/<brew id>.atom` or `/b/<brew id>.json`. Turning it off returns 404 for both
feed URLs; issue twins remain available. Enabled empty archives produce valid
empty feeds. Missing output issues and cross-Brew issue IDs return JSON 404 responses,
never the latest issue or the SPA. Node supports GET and HEAD; responses have
explicit media types, `private, no-store` caching, no-index and nosniff headers.
Read emits alternate Markdown/JSON links in its document head, plus Atom/JSON
Feed discovery when enabled. Twins include HTTP alternate links too.

Articles and cleaned newsletter letters have private content twins at
`/a/<article id>.md` and `.json`, available from the reading pane's More sheet.
GET/HEAD does not mark an item read or extract content. The open article owns
Markdown/JSON discovery until it closes, then the selected Brew's links return.
Article overlays use native modal dialogs: focus starts in the article, stays
inside the active dialog and returns to its opener on close. If an unread row
disappears, focus moves to a visible neighbouring row or the list heading.
Desktop panes sit beside the list; on small screens they use the same modal
behavior while retaining the saved pane preference. More actions form a separate
native dialog, and article-load failures offer Retry article.
Tag changes wait for acknowledgement. Failed creation or assignment keeps the
name available for retry, including from More; a tag already created is reused.
Newsletter tag edits stay in a native form until Save tags, and Cancel leaves
assignments unchanged. Saving preserves tags added independently and keeps read,
starred and article content state intact. Read/star failures also offer their own
retry inside the active article surface.
Reader and search distinguish loading, failed reads and successful empty results.
Refresh failures retain loaded rows and label their ranges **Last loaded**.
Failed infinite paging stops until **Retry more**; empty later pages offer a
native **First page** link that preserves filters. Library metadata has its own
retry and does not block loaded articles. **Keyboard shortcuts** and `?` open
native help with contained focus and Escape/Done restoration; the legacy Feeds
and Rules toolbar opens the same Reader guide.

Turn on **Agent-friendly mode** in **Settings → Agent access**, or add `?agent=1`
to an app URL. Reader and search then render all 50 items on each numbered page
in the DOM, announce exact totals and stop loading ahead. Animations, transitions
and smooth scrolling stop across the app, and scrolling cannot mark articles read.
Your saved Read on scroll preference stays unchanged. Explicitly opening an
article still marks that article read.

The setting saves in this browser and updates other open tabs. The URL flag does
not save a preference; native app navigation retains it. In Agent access, **Use
saved preference** removes the temporary override. Page links retain filters and
history, and Markdown/JSON links describe the selected page and active mode.
MCP and scoped tokens are available in Node. Experimental [WebMCP](docs/webmcp.md)
requires `BREW_WEBMCP=1` and a separate browser opt-in in Agent access.

Shared switches and checkboxes provide 24px activation areas while keeping their
existing visual sizes. Compact rule actions, Compose fields, setup links and
newsletter controls also meet that minimum. Browser checks cover the controls
and verify that clicks along the enlarged edges activate the intended control.
See [agent DOM implementation](docs/agent-dom.md) for the current role/label-only
journeys and the DOM acceptance audit.

Saved rules keep direct actions and a labelled **More** button. **Copy** creates
one disabled copy of the saved definition through the owner action journal.
**Check result** recovers a lost response without creating another copy; reload
recovers its 30-second Undo. Undo refuses to remove a copy with later saved edits
or execution history. Unsaved editor changes survive action and list refreshes.
Rule, preview, scope-choice and execution-log read errors have separate retries.
Duplicate-filter changes wait for the saved response and can retry the same value.
Notification permission requests report blocked, dismissed and failed outcomes.

Execution history has exact totals and native 50-row pages, including records
beyond the former 100-row UI limit. Page links, reload/history and Markdown/JSON
exports keep the selected rule and page. Paging preserves unsaved rule edits.
The saved-rule count identifies stale data after a failed refresh. Undo restores
usable keyboard focus after its button disappears, and delayed results preserve
newer focus or navigation. The DOM acceptance audit is in
[agent DOM implementation](docs/agent-dom.md).

`GET /api/openapi.json` describes this instance's registered Hono operations as
OpenAPI 3.1, including request/response schemas, query filters, private exports,
webhooks and confirmed owner actions. It also supports HEAD and returns private,
no-store headers. It contains no library records or credentials. See
[API discovery](docs/agent-api.md) for examples and contract maintenance.

`GET /llms.txt` is the private [instance guide](docs/agent-discovery.md): current
capabilities, routes, authentication and names from the shared tool catalog.
It supports HEAD, contains no library records or credentials, and uses relative
links for this instance. The app head exposes it with `rel="describedby"`.

The [MCP server](docs/mcp.md) exposes the same tools over `/mcp` and
`node dist/targets/node/src/index.js mcp`. Search, unread lists, Markdown reading,
Brew reads/previews and confirmed read/star/tag/feed/rule writes use real services
and durable Undo. Rule creation defaults to a dry run. Use the same absolute
`BREW_DB_PATH` for a host-launched stdio process and the Node server. HTTP requires
an expiring token from Settings → Agent access; tokens are read-only by default.
Write tokens can mark, star, tag and add feeds, never delete or save rules. The
[Agent access guide](docs/agent-access.md) covers one-time secrets, revocation, the
action log with Undo, client setup and the owner deployment boundary. Set
`BREW_MCP_TOKEN` to apply the same scope to local stdio.

Experimental [in-page tools (WebMCP)](docs/webmcp.md) use the same catalog and owner
browser access. Set `BREW_WEBMCP=1`, restart Node, then enable the switch in Agent
access on HTTPS or localhost. Both defaults are off. Tools follow mounted visible
controls, confirmed writes require a native review, and changes appear in the
private activity log with Undo. Native document/navigator APIs take precedence;
the official polyfill supplies a JavaScript interface where native support is absent.

Reader saved searches are browser-local bookmarks. **Save search** opens a labelled
dialog and remembers the query, scope and current filters, starting on page one.
Saved entries use native links in Reader and the app sidebar; older query-only
bookmarks remain supported. Reader's visible **More** control offers deletion with
confirmation and Undo for the latest deletion for up to 30 seconds in the same tab,
including after reload. Storage failures keep the form or bookmark and offer a
retry. Changes refresh other open tabs. Removing a bookmark keeps any Compose
source definition previously saved from that query.

Manage feeds uses native name and retention dialogs with explicit saves, validation
and retryable errors. Renaming a feed preserves its folder assignment. Feed and
folder rows offer native article links and labelled More controls. Library, health
and hidden-article views announce counts and distinguish read failures from empty
lists. Health More includes fetch, rename, retention and confirmed deletion/Undo;
hidden rows link to their content and offer More with private formats and Unhide.
Cancel restores the opener, and Unhide keeps keyboard position on the same page.
Hidden articles use 50-item pages with reloadable `?section=hidden&page=N`
URLs and matching private Markdown/JSON twins, including totals beyond 500 items.
The legacy `/api/articles-hidden` response remains a capped array; opt in to the
complete paged projection with `?includeTotal=true&page=N` (`items`, `total`,
`page`, `pageSize`). Paged rows identify letters/articles and actual read, starred
and highlight state. Reading either format never changes article visibility.

`BREW_PUBLIC_URL=https://brew.your-domain.example` pins the canonical origin for
absolute twin/feed links behind a TLS-terminating reverse proxy. Without it,
Node uses the request’s actual protocol and Host. Only HTTP(S) origins without
credentials are accepted; paths are rooted at the origin. The Vite development
proxy forwards output URLs while keeping Read and Compose as SPA routes.
Legacy snapshots are adapted from their stored content in memory, using UTC
because they did not freeze a timezone; their stored payloads and v1 API DTOs
stay unchanged.

Add source discovers feeds from websites and native YouTube, Mastodon, Bluesky,
subreddit and podcast URLs. It validates feed responses before offering them,
with multi-select, library filters and capability-gated newsletter address copy.
Apple Podcasts links resolve through the public lookup API. Provider failures
remain visible; Brew does not create a replacement feed when a native endpoint
is unavailable. OPML import previews the file and confirms before adding subscriptions
to the library. Choose which ones to include in the section. Undo remains available
for 30 seconds while the imported feeds and folders are unchanged and unused;
existing subscriptions are kept. Saved browser searches selected here are persisted
by migration 0007 and use the same FTS compiler as Reader search.

The source API lives at `/api/sources/discover`, `/api/sources/searches` and
`/api/sources/mailbox`. Discovery does not write to the database. Adding selected
feeds updates the library. The section changes only after all selected sources
resolve. Partial failures retain completed subscriptions for retry.
Schedule & delivery supports daily, weekdays, weekly day selections and monthly
schedules, all minute values and IANA time zones. The next issue is calculated by
the server with DST handling. Pause scheduling or skip issues below a threshold
of unique unread selected items. Changes stay local until Save; closing the
sheet cancels them. Delivery controls follow capabilities and keep unavailable
channels visible with setup links. Test email sends the unsaved preview through
a configured `OutboundMailPort` and saves no issue or settings; Node supports SMTP
or Resend through environment variables; webhook and feed delivery
work in Node. A default Node install keeps email gated until a mail provider is configured,
and public-copy publishing remains pending.

V2 issues are retained for 30 days, with monotonic issue numbers even after the
archive expires. The scheduler prunes expired issues even for paused Brews.
Legacy v1 issues retain their existing 30-edition policy.

More actions contains generation,
edition selection and display preferences. Output controls remain visible and
disabled until the output renderers are implemented.

## Newsletter ingestion

The portable `NewsletterPipeline` accepts MIME bytes or a decoded `NewsletterMessage`.
`NewsletterService` connects it to Node's SQLite database and rules engine. A sender
becomes a `newsletter` feed at `mailto:<address>`; ordinary Reader, search, tags and
feed-sourced Brew sections can consume its letters. Letters without a public archive
use a local `/a/:id` link that opens the existing Reader panel. Newsletter feeds are excluded
from RSS polling. Node supports a dedicated IMAP mailbox and authenticated Postmark/
Mailgun inbound webhooks. Follow the [mail setup guide](docs/inbound-mail.md) and
[environment example](.env.example). Open **Newsletters** in the sidebar or `/letters`;
the default install reports `inboundMail: null` until a connection is configured. Migration 0009
stores active receiving addresses and replay receipts, never provider credentials.

Cleaning removes pixels, known click redirects, tracking query parameters, small
sponsor disclosures, configured per-sender CSS matches and email footer controls,
then applies the shared article sanitizer and image proxy. Embedded HTTP redirect
targets can be recovered; opaque redirects keep their label without a link. Cleaning
never follows links. Heuristics cannot identify every publisher's ad or tracker;
sender selectors provide overrides. Attachments and inline CID images are omitted.

Migration 0008 stores decoded original HTML separately in `articles.raw_html`, with
cleaning counts in `cleaning_json`. Reader/search/Brew consume cleaned HTML. Original
HTML is untrusted and is not included in article or newsletter JSON responses.
**Show original** displays the original text in a sandbox with images, links and active
content disabled. **Open original** opens a public archive when the sender supplied one;
otherwise it opens the same inert original in a new tab. Text-only messages retain escaped text.
Sender retention defaults to the existing 90 days; expired originals are cleared
even when starred/tagged cleaned stories are kept, at ingestion and during Node's
minute maintenance cycle (also on startup). RSS retention keeps its existing policy.

Delivery replay deduplication uses sender plus Message-ID, with a deterministic
subject/date/body fallback when it is absent. Identical undated messages without an
ID therefore count as one delivery. Missing/invalid dates and dates more than a day
in the future use receipt time. Raw messages are limited to 10 MiB, decoded HTML/text
to 2 MiB each, headers to 256 KiB, MIME parts to 200 and nesting to 30. Sender addresses
are normalized for grouping, not authenticated by the MIME parser; ingress adapters
must authenticate the mailbox/webhook before calling the pipeline.

The Newsletters screen has Inbox, Favorites, Skipped and Blocked views, sender sorting,
50-letter pages and shareable `/letters/:senderId` and `/letters/:senderId/:articleId`
URLs. Native sender, letter and page links preserve view/page/sort filters; `scope=all`
keeps the All senders list behind an explicitly opened letter. The earlier `?sender=`
list filter remains readable. The former single-ID letter shorthand now denotes a
sender; use both IDs for a letter. A mismatched sender/letter pair shows an error and
never opens or marks the unrelated letter read, including when it is already cached.
Sender lists and sender-bound letters also accept `.md` and `.json` with private,
read-only responses. Selecting a letter marks it read and focuses its reading pane;
the initial Inbox preview keeps its unread state. Use the metadata
button or **M** while the reading pane is focused to toggle read state. Read and Starred
state are shared with Reader and Brew; saved issues keep their frozen content.

**Favorite** applies to a sender; **Save to Starred** and **Tag** apply to one letter.
**Skip sender** removes its letters from Inbox while retaining them in Skipped.
**Block** also rejects future deliveries; unblock from the Blocked view. Sender settings
choose a Brew, retention and selectors for cleaning future letters. Assigning a Brew adds
the sender to a managed Grid section without changing saved issues or custom sources.
**Only in Brew** requires an assignment and omits that sender from Reader’s general
lists and bulk-read actions. Newsletters, search, direct sender access and Starred remain
available. Deleting the assigned Brew clears that restriction.

Sender rows expose **More actions** on hover or keyboard focus; the sender name in
the reading pane opens the same actions plus letter read/star/tag and format links.
Settings use a labelled form and save only edited preferences. Changes to Inbox,
blocking, Brew routing or retention show a read-only review before saving, including
the exact letters and saved originals that retention will remove. Cancel keeps the
draft. Favorite and cleaning-only edits save directly. Both paths provide actual
local **Undo** for 30 seconds, including pruned records and routing, while the affected
data remains unchanged. A lost response offers **Check result** without repeating
the action; recent Undo is recovered after reload. Undo cannot recover mail rejected
while a sender was blocked. Unsupported writes remain visible with setup links.

In Compose, open **+ Source → Newsletters** to follow all senders (including future
senders), or choose individual senders and tags. A filtered newsletter source includes
letters from any chosen sender **or** carrying any chosen tag; an RSS story with the
same tag is excluded. Retained letters remain eligible after Skip or Block; Block stops
future deliveries. Section unread/filter/date/order/item-limit settings still apply.
Choosing newsletter-only sources for the first time initializes the default Magazine
layout to Grid; later layout choices and mixed-source sections keep their layout.

Composition JSON stores one newsletter source per section, for example
`{"kind":"newsletters","senderIds":[12],"tagIds":[3]}`. Omitted selectors mean all senders. Each supplied selector is a
nonempty list of up to 500 unique positive IDs; missing/deleted IDs match nothing and
remain visible for removal in the picker. No database migration is needed.

Generated issues freeze a letter’s cleaning note and a plain-text excerpt for the
newsletter Grid cards. Their timestamps use the archived issue’s date and time zone.
Read letter opens the existing reader; Open inbox returns to Newsletters. See the
[M10 corpus and visual review](docs/newsletter-exit-review.md) for the 20-template
browser checks and Figma comparison. Opt-in Brief generation follows in M17.

The address card reflects the configured mail capability and copies the receiving address.
**Forward from Gmail** explains address verification and a narrow forwarding filter for
new mail; it does not use OAuth or connect your Google account. Unconfigured instances
keep setup visible. Browser and static email-to-feed ingestion remain for M15/M16.

## Data ownership

Your server data is in `data/brew.db`. Run `npm run backup` for a consistent SQLite
snapshot in `backups/` (override paths with `BREW_DB_PATH` and `BREW_BACKUP_DIR`).
To copy the database manually, stop Brew first so its database and WAL stay
consistent. Settings → Data & backup offers a private OPML download of RSS
subscriptions and folders. Newsletter addresses and letters are not OPML feeds;
keep the database backup for those. Browser preferences stay in browser storage.
Complete `.brew` transfer remains a later milestone.

## Troubleshooting

- **Port already in use** → something else owns 4400/4401; stop it or change ports.
- **Feeds not refreshing** → check the server terminal for fetch errors; some feeds rate-limit aggressively.
- **Started fresh unexpectedly** → the app looks for `./data/brew.db` relative to where it runs; check `BREW_DB_PATH` and your working directory.


Node outbound delivery is documented in [docs/outbound-delivery.md](docs/outbound-delivery.md).
Set SMTP connection settings or `BREW_RESEND_API_KEY`/`BREW_RESEND_FROM`, plus `BREW_PUBLIC_URL`, then restart the Node
process. Choose a single recipient or an HTTP(S) webhook in Schedule & delivery.
Generated issues freeze first, then deliver their frozen HTML/plain text and
content-only JSON. Failures preserve the issue and appear separately at
`GET /api/brews/:id/delivery`; credentials and raw provider replies are omitted.
A test send uses the current unsaved draft and does not create an issue or send
a webhook. Webhooks use a five-second timeout per attempt and one retry, with a
stable `Idempotency-Key`. Existing issues are never silently resent on restart.
