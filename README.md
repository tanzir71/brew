# Brew

[Website](https://brew-reader.vercel.app/) · [Interactive demo](https://brew-reader.vercel.app/demo)

> A local-first, single-user RSS reader. Your feeds, articles, and rules live in one SQLite file on your machine — **no account, no cloud, no telemetry.**

## What is this?

Brew fetches your RSS/Atom feeds, stores everything locally, lets you build rules to triage articles, and produces daily "Brew" snapshots — a curated daily digest built from your own subscriptions. It is intentionally single-user: one person, one machine, one database file you can back up by copying it.

## Architecture

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

## Getting started (from zero)

### Prerequisites

| Tool        | Why        | Get it                     |
| ----------- | ---------- | -------------------------- |
| Node.js 20+ | Everything | <https://nodejs.org> (LTS) |

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

```
packages/core/   portable domain services, ports and shared types
packages/db/     canonical Drizzle SQLite schema and SQL migrations
packages/api/    Hono REST router with target-independent service interfaces
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

Add source discovers feeds from websites and native YouTube, Mastodon, Bluesky,
subreddit and podcast URLs. It validates feed responses before offering them,
with multi-select, library filters and capability-gated newsletter address copy.
Apple Podcasts links resolve through the public lookup API. Provider failures
remain visible; Brew does not create a replacement feed when a native endpoint
is unavailable. OPML import adds subscriptions to the library; choose which ones
to include in the section. Saved browser searches selected here are persisted
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
a configured `OutboundMailPort` and saves no issue or settings; Node's SMTP
adapter and published feed/webhook/public-copy outputs arrive in M11. A default
Node install keeps those controls gated.

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
50-letter pages and shareable `/letters/:id` URLs with sender/view/page filters. Selecting
a letter marks it read; the initial Inbox preview keeps its unread state. Use the metadata
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

The address card reflects the configured mail capability and copies the receiving address.
**Forward from Gmail** explains address verification and a narrow forwarding filter for
new mail; it does not use OAuth or connect your Google account. Unconfigured instances
keep setup visible. Browser and static email-to-feed ingestion remain for M15/M16.

## Data ownership

Your entire state is `data/brew.db`. To back up manually, **stop Brew first** so the SQLite database and WAL stay consistent, then copy the file. Automated backup and OPML export commands arrive in later milestones (see `CODEX_HANDOFF.md`).

## Troubleshooting

- **Port already in use** → something else owns 4400/4401; stop it or change ports.
- **Feeds not refreshing** → check the server terminal for fetch errors; some feeds rate-limit aggressively.
- **Started fresh unexpectedly** → the app looks for `./data/brew.db` relative to where it runs; check `BREW_DB_PATH` and your working directory.
