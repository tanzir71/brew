# PROGRESS

## Current milestone: All milestones and refinement backlog — DONE

## Checklist state


### M0 — Skeleton — DONE

- [x] Repo scaffolded per §4 (folders, TS strict, ESLint/Prettier, Vitest, Playwright, Tailwind, Drizzle configured, all §10 scripts runnable and green on empty project).
- [x] Fastify serves the SPA; `/api/health` returns `{ok:true}`; SSE endpoint streams heartbeat.
- [x] SQLite opens/migrates on boot; schema of §6 created via migration 0001.
- [x] `README.md` with run instructions.

Exit review passed 2026-07-10: a clean local clone completed `npm ci`, started with `npm run dev`, served the SPA, and returned `{ok:true}` through the Vite-proxied health endpoint.


### M1 — Feeds & ingest — DONE

- [x] Add feed by URL (including discovery from HTML pages); delete; rename; folders CRUD.
- [x] Poller with conditional GET, adaptive intervals, backoff, concurrency limit, and fixture coverage.
- [x] Ingest pipeline: dedupe, sanitize, tracker stripping (tested).
- [x] OPML import/export round-trips folder structure (test with a 100-feed fixture).
- [x] Feed health surface in settings.

Exit review passed 2026-07-10: `npm run review:m1` subscribed to 20 live public feeds in an isolated database; both poll cycles succeeded for all 20, ingested 1,593 articles, and produced zero duplicate GUID or normalized-hash groups.


### M2 — Reader core — DONE

- [x] Sidebar with folders/feeds/unread counts; All/Today/Starred views.
- [x] Virtualized article list, three densities, unread filter, sort.
- [x] Article overlay/pane per §7.3 including lazy full-text extraction.
- [x] Read/star/tag actions with optimistic UI and SSE-driven live inserts.
- [x] Mark-all-read with undo; mark-read-on-scroll setting.
- [x] Light/dark themes.

Exit review passed 2026-07-10: committed Playwright baselines cover title, magazine, and card densities in light and dark themes; `web/src/styles/tokens.css` documents the type scale; a traced browser test asserts Reader navigation paints in under 100 ms.


### M3 — Keyboard & search — DONE

- [x] All shortcuts of §7.6 plus `?` cheat sheet.
- [x] FTS5 search with scoping chips (e2e: index 1k fixture articles, search returns under 50 ms).

Exit review passed 2026-07-10: Playwright starts a real Fastify/SQLite instance, indexes 1,000 fixture articles through FTS5 triggers, and verifies scoped HTTP search under 50 ms; the complete shortcut and virtualized search flows pass in-browser.


### M4 — Rules engine — DONE

- [x] Data model, evaluation in ingest path, ordering, `stop_processing` (table-driven unit tests: every operator × every action, regex timeout, condition combinators).
- [x] Sentence-style builder UI with live dry-run preview.
- [x] All actions of §7.4 including highlight rendering in lists, notify, webhook.
- [x] Rule logs + hit counts + "apply to existing articles".
- [x] Duplicate filter with trigram similarity (tested with near-duplicate fixtures).

Exit review passed 2026-07-10: action/operator matrices cover exact persisted states, webhook retry/failure logging, rule ordering, hit counts, targeted reapplication, and near-duplicate fixtures; Playwright creates five realistic rules through the UI and asserts their exact persisted fixture states.


### M5 — The Brew — DONE

- [x] Brew config CRUD: section composer with drag-reorder, all section options of §7.5.
- [x] Scheduled snapshot generation + "generate now" + 30-snapshot history with date navigation.
- [x] Brew rendering: hero/list/magazine layouts, calm empty states, read-from-Brew, resume position.
- [x] Brew as default landing page; multiple named Brews via tabs.

Exit review passed 2026-07-10: immutable snapshot and 30-edition retention tests pass; golden Playwright screenshots cover the seeded newspaper view in light and dark themes.


### M6 — Hardening & polish — DONE

- [x] Performance budgets of §8 verified with a 10k-article seed script (`npm run seed:big`).
- [x] Image proxy + CSP + sanitization audit (tests attempt XSS via feed fixtures — renders inert).
- [x] Accessibility pass: axe-core in Playwright, zero serious/critical violations on Reader, Rules, Brew.
- [x] Backup script; error boundary; empty/loading/error states across primary views.
- [x] Final spacing/type polish, favicon/app icon, contextual page titles.

Exit review passed 2026-07-10: 10k virtual scrolling, cold load, and article-open budgets pass; a real 10k seed and SQLite backup completed; the complete 21-test Playwright suite passed three consecutive runs with no failures.

### Refinement backlog acceptance criteria

1. [x] Feed icons: navigation shows a proxied site favicon when available and a deterministic letter fallback otherwise.
2. [x] Retention: each feed exposes a retention-days setting (90 default); cleanup preserves starred or tagged articles and is fixture-tested.
3. [x] Weekly review: Brew composer offers a last-seven-days starred source and generator coverage proves its bounds.
4. [x] Rule templates: gallery can seed mute-keyword, highlight-author, and feature-folder drafts in one click.
5. [x] OPML quirks: Feedly category and Inoreader nested/export attributes import with folders intact and round-trip tests.
6. [x] Reader preferences: font family, content width, and line height persist locally and visibly affect article reading.
7. [x] Saved searches: a current search can be named, appears as a sidebar pseudo-feed, reopens, and can be deleted.
8. [x] Podcasts: RSS enclosure audio metadata persists and renders an accessible inline player.
9. [x] PWA: valid manifest, install icons, and service worker provide an installable offline shell.
10. [x] Micro-interactions: live inserts animate subtly, starring has feedback, and undo toast has polished enter/exit behavior with reduced-motion support.

Refinement review passed 2026-07-10: focused unit and Playwright coverage exercises retention exceptions, weekly bounds, OPML quirks, templates, saved-search lifecycle, persisted reader controls, podcast rendering, and PWA artifacts.

## Decisions

- 2026-07-10: Use Tailwind CSS v4 through its Vite plugin — it keeps the scaffold minimal and avoids obsolete configuration.
- 2026-07-10: Keep server and web compilation separate — browser and Node module resolution have different requirements while remaining one package.
- 2026-07-10: Adapt active feeds by 25% per successful poll toward 15 minutes and quiet feeds by 50% toward 6 hours — gradual changes avoid cadence oscillation while honoring the specified targets.
- 2026-07-10: Follow DOMPurify with a strict linkedom tag/attribute/protocol allowlist — DOMPurify currently reports linkedom's partial window as unsupported, so the explicit pass preserves the mandated stack without trusting unsanitized fallback output.
- 2026-07-10: Flatten nested OPML folder paths as `Parent / Child` — Brew's canonical schema has one folder level, and retaining the full path avoids silently losing organization.
- 2026-07-10: Persist `failing_since` separately from the latest fetch attempt — a seven-day health warning cannot be derived accurately from `last_fetched_at`, which advances on every retry.
- 2026-07-10: Execute regex conditions in short-lived worker threads with a 100 ms hard timeout — JavaScript regex evaluation cannot otherwise be safely interrupted on catastrophic patterns.

## Discoveries / gotchas for future iterations

- The repository began with only `CODEX_HANDOFF.md` and was not initialized as Git.
- Vite must bind explicitly to `127.0.0.1` on this Windows host; its default IPv6 binding is not reachable by Playwright's IPv4 base URL.
- Production compilation does not copy SQL assets, so the migration loader falls back to the repository migration directory when running from `dist`.
- Feed discovery validates declared alternate links and common-path candidates by parsing their response; unreachable and non-feed candidates are quietly omitted.
- DOMPurify with linkedom can return input unchanged because linkedom lacks parts of `WindowLike`; hostile-fixture tests must continue covering the explicit allowlist fallback.

## Dependency justifications

- `@axe-core/playwright`: automated WCAG serious/critical regression checks required by M6.

- Fastify + `@fastify/static`: REST/SSE server and production SPA hosting required by §4.
- Drizzle ORM + `better-sqlite3` + drizzle-kit: canonical local SQLite persistence and migrations.
- React + Vite + Tailwind: specified SPA and styling stack.
- TanStack Query + Virtual: specified live data cache and large-list virtualization.
- rss-parser, Readability, linkedom, DOMPurify, node-cron: specified ingest, extraction, sanitization, and scheduling stack.
- TypeScript, ESLint, Prettier, Vitest, Playwright: required strict quality gates.
- tsx + concurrently: one-command local development for the server and SPA.


## v2

### Current milestone: M9

### Checklist state


### M7 — Core extraction, capabilities, mode chip — DONE
- [x] Workspaces created; domain logic moved to `packages/core` with ports. All v1 unit and e2e tests pass unchanged.
- [x] Hono API replaces the Fastify routes in the Node target, with identical REST contracts (contract tests against v1 responses).
- [x] `/api/capabilities` implemented for the Node target. A `useCapabilities()` hook exists in the web app.
- [x] Sidebar Mode chip and Settings → Where Brew runs (`15:2010`) render from capabilities.

### M8 — Design system v2 — DONE
- [x] `tokens.css` generated from §4.2 (light and dark); Tailwind theme reads the CSS variables; stone/amber utilities removed.
- [x] Newsreader, Instrument Sans and Geist Mono self-hosted (woff2, `font-display: swap`); no third-party font requests (asserted in e2e).
- [x] Components of §4.3 built with stories or fixtures. Icon set ported from Figma `5:2` as an inline SVG sprite.
- [x] Zero italics: a lint rule or test fails on `font-style: italic`, `<em>` without a reset, or `italic` utilities.

### M9 — Read and Compose
- [x] Read view matches `8:2`/`9:270`: masthead (date · No. · title · lede · meta), section headers with "Mark section read", the four layouts, selected item with visible actions, rule highlight with chip, rail (In this Brew, progress, formats, next Brew), end-of-Brew state.
- [x] Compose matches `10:458`: schedule summary card, section cards (collapsed/expanded), **visible drag handle + Move up/down buttons + Alt+↑/↓**, From/Layout/Items/Show/Options/Order/Filter fields, Note block, live preview with Web/Email/Feed tabs, Desktop/Phone toggle, "Editing" outline linked to the expanded card. Autosave shows "All changes saved".
- [x] Add source sheet matches `11:694`: URL discovery, multi-select, "is also a newsletter" hint with Copy address, library tabs, detection hint for YouTube/subreddit/Mastodon/Bluesky/podcast URLs (convert to their native feed URLs), OPML import.
- [x] Schedule & delivery sheet matches `11:1314`: Daily/Weekdays/Weekly/Monthly, day chips, time, IANA time zone, skip-if-fewer-than, channels gated by capabilities, "Send a test now".
- [x] `preview_brew(at)` builds an uncommitted issue for any time ("dry run"). Snapshots stay immutable.
- [ ] Two-way read state: reading in a Brew marks the article read in the Reader, and the reverse.

### M10 — Newsletters
- [ ] Inbound pipeline in core: parse MIME → sender feed (auto-create) → clean (strip tracking pixels, known tracker links, sponsor blocks by heuristics + per-sender selectors, footers/unsubscribe chrome) → sanitize → article. Keep `raw_html` for "Show original".
- [ ] Node: IMAP poller (dedicated mailbox) + `POST /api/inbound/email` webhook (Postmark/Mailgun JSON shapes). Cloudflare: `email()` handler (M14). Browser/static: an email-to-feed URL subscribed like a feed.
- [ ] Newsletters screen matches `12:1252`: senders pane (All, per-sender counts, skipped/blocked), letters list, reading pane with toolbar (Favorite, Tag, Save to Starred, Skip sender, Block, Open original), sender settings row (goes to Brew, retention, Only in Brew), cleaning summary with Show original, and an address card whose text and badge follow `capabilities.inboundMail`. "Forward from Gmail" walkthrough (forwarding filter instructions; no OAuth).
- [ ] Brew source `newsletters` (all senders or chosen senders/tags), Grid layout default for letters.

### M11 — Outputs and delivery
- [ ] Renderers in core: web HTML, email HTML (table-safe, inline CSS, 600px, dark-mode-safe), Markdown, JSON, Atom/JSON Feed of issues.
- [ ] Routes of §7 for `.md`/`.json`/`.atom`. Rail "Open this Brew as" links work.
- [ ] Email delivery via OutboundMailPort (Node SMTP first), with test send and per-issue `sent_json`. Webhook delivery POSTs JSON with 5 s timeout and one retry.
- [ ] Channel toggles in the Schedule & delivery sheet persist to `delivery_json`.

### M12 — Agent layer
- [ ] DOM checklist (§9) implemented and enforced by a Playwright test that completes core tasks using only `getByRole`/`getByLabel`.
- [ ] Agent-friendly mode (setting + `?agent=1`): no virtualization, no motion, no mark-on-scroll, paginated lists with totals (`13:1415` pagination).
- [ ] OpenAPI 3.1 at `/api/openapi.json`, generated from the Hono routes.
- [ ] MCP server (stdio in the Node CLI, streamable HTTP at `/mcp`) with tools: `search_items`, `list_unread`, `get_item` (markdown), `mark_read`, `star`, `tag`, `add_feed`, `create_rule` (dry run by default), `get_brew`, `preview_brew`. Write tools return `undo_id`.
- [ ] Tokens (read-only default, write scope never deletes), action log with Undo, setup snippets. Matches `15:2295`.
- [ ] WebMCP behind a flag: register the same tools with `document.modelContext ?? navigator.modelContext` (polyfill), only while the matching UI is mounted.
- [ ] Per-instance `/llms.txt` listing routes, auth and tool names.

### M13 — Google Reader API + Fever
- [ ] Google Reader endpoints for login/token, subscriptions, tags, stream contents/ids, edit-tag (read/starred), mark-all-as-read. Fever: groups, feeds, items, read/saved.
- [ ] Settings → Apps & sync: server URL, app password, per-client notes (Reeder Classic, NetNewsWire via "FreshRSS" account type, Unread).

### M14 — Cloudflare target
- [ ] Worker with `fetch`, `scheduled` and `email` handlers; D1 migrations from `packages/db`; R2 for image cache.
- [ ] Polling in batches sized to `limits.maxFetchesPerRun` (≤ 40 on Free), round-robin by due time; adaptive intervals preserved.
- [ ] Inbound newsletters via Email Routing. Optional Email Service or Resend binding for delivery.
- [ ] Auth: Cloudflare Access or passkey; read-only static share unaffected.
- [ ] "Deploy to Cloudflare" button and a one-command installer (`npx brew-reader deploy cloudflare`).

### M15 — Browser target
- [ ] sqlite-wasm on OPFS (IndexedDB fallback), the same Drizzle schema, FTS5.
- [ ] Fetch via a configurable relay (ship a 30-line relay Worker template) or an optional extension. Catch-up fetch on open; fetch while open.
- [ ] Capabilities reflect `while-open`, `email-to-feed` and no email delivery. First run (`15:1773`) "Start here" lands in a working Brew in under 10 s with sample feeds.
- [ ] `.brew` export/import (zip: SQLite file + manifest) works across all targets.

### M16 — Static (GitHub Pages)
- [ ] `brew publish` CLI renders issues to HTML/MD/JSON/Atom + `llms.txt` + a Pagefind index into `site/`. A GitHub Action template runs on a schedule and on demand.
- [ ] Published page matches `17:2`: read-only notice with last built time, archive strip, private sections excluded (**newsletters are never published**), footer endpoint list. Read state is stored per browser.

### M17 — Briefs (opt-in AI)
- [ ] AIPort with providers BYO (OpenAI-compatible), Ollama, Workers AI and Chrome built-in; off by default; provider status in Where Brew runs.
- [ ] Section depth `brief`: a cluster-aware summary of the section's items with numbered citations to source items (Brief card in `8:2`). Deterministic prompt; cache in `briefs`.

### M18 — PHP Lite (deferred, optional)
- [ ] PHP pump: cron fetch into SQLite, IMAP pull, fetch proxy, sync endpoint. Rules and Brews run in the browser core against that data.

### M19 — Landing page
- [ ] Replace `docs/` landing with `18:2`: nav, hero (two-line headline; real product shot of the Read view, not a dashboard), proof strip, three ways to read, Compose, Newsletters, Run it anywhere (mode cards from `15:1773`), Rules, For agents block, Compare table (**re-verify prices first**, keep the "checked <month year>" footnote), Built open, FAQ, final CTA, footer. Keep and update `docs/llms.txt`.
- [ ] Fix the repo URL mismatch: `README.md` and `docs/llms.txt` point to `github.com/tanzir71/rss`, but the git remote is `github.com/tanzir71/brew`.

### M20 — Phone and PWA polish
- [ ] Phone layout per `17:2314`: compact top bar, masthead, progress, tab bar (Brews, Letters, Today, Library, Search), safe areas.

### Decisions

- 2026-11-26: Expose `previewBrew(id, at?, draft?)` in core and use it for the existing no-store preview route. An omitted draft uses the saved Brew; an explicit draft stays uncommitted. Reject missing/invalid Brew IDs with 404. Keep the existing proposed-next-issue default when `at` is omitted, including paused Brews, without applying delivery or skip suppression to a dry run. M12 will expose this through the named agent tool.
- 2026-11-26: Require an explicit UTC instant or offset in `at`, validated with the existing Temporal dependency. Reject date-only/zone-less values, JSON coercions and impossible calendar dates instead of interpreting them in the server's timezone. Preserve current-library read/star state, filter publication timestamps and rolling Today/Weekly review windows relative to `at`, and apply per-section weekdays in the Brew's IANA zone; a dry run is not historical library reconstruction.
- 2026-11-26: Give the preview builder only its three storage read methods and detach the draft and Date before asynchronous filters. Previewing cannot save, prune, deliver or advance an issue number. Verify both zero SQLite changes and byte-identical stored issue payloads through later config/library changes, dry runs and subsequent generation. Keep the existing Figma UI and visual baselines unchanged; no new dependency or artwork is needed.

- 2026-11-26: Implement Schedule & delivery from `11:1314` / sheet `11:1550` with the shared side sheet, segments, selects, stepper, toggles, badges and icon sprite. Keep its 460px width, 8px inset, day-chip geometry, scrollable body and pinned footer; add pause and live next-issue status using real settings rather than fixed sample data. No new artwork is needed.
- 2026-11-26: Keep schedule/delivery edits local until Save and await the serial autosave before closing. Calculate next runs through a no-store, write-free schedule-preview route using the existing Temporal DST policy and server clock; cancel obsolete responses. Treat the skip threshold as the number of unique unread selected stories, even when a section also includes read stories.
- 2026-11-26: Add optional `capabilities.outputs` feed/webhook flags, failing closed when absent. Node keeps published feed, webhook and public-copy controls disabled with setup links until their adapters exist. Preserve existing delivery preferences, with an explicit removal action when a saved channel is unavailable. Email follows `capabilities.emailDelivery` as annotated in Figma.
- 2026-11-26: Add `OutboundMailPort` and an injected Node/API transport for test sends. Send the actual unsaved email preview, confirm only after the provider acknowledges it, and create no issue, config write or issue number. Default Node has no mail provider; SMTP configuration, automated delivery and per-issue results remain M11 work. Integration/browser tests use local transports and send no external email.
- 2026-11-26: Honor Figma's 30-day retention for v2 issues, including paused Brews during scheduler maintenance; keep v1's 30-edition contract. Store the last issue number in existing settings, capture older archives' maximum before pruning, and preserve monotonic numbering when every retained issue expires. No schema migration or dependency is needed.

- 2026-11-26: Implement Add source from `11:694` / sheet `11:930` with the existing modal, fields, segmented controls, checkbox, avatar, badge, chip and icon library. Reuse all static vector assets; supplied feed names, counts and avatar tones stay data. Keep the 640px sheet at the reference 96px top inset on desktop, with scrollable content on smaller viewports.
- 2026-11-26: Add a portable source discovery service and dedicated `/api/sources` routes so the captured v1 discovery contract remains unchanged. Resolve native YouTube, subreddit, Mastodon, Bluesky and Apple Podcasts links, validate actual feed documents, preserve redirect destinations, bound alternate/fallback candidates to 12, and infer cadence only from declared publication dates. Show failures and retry controls instead of inventing feeds.
- 2026-11-26: Persist selected browser saved searches in migration 0007 with stable client IDs and numeric source IDs. Use Reader's FTS compiler and apply source search before section filters and item limits. Rules offers the existing Featured output; Starred includes the existing Today and Weekly review sources. Newsletter sources remain visible with setup gating until M10.
- 2026-11-26: Read a private copy address only from an active configured inbound-address record and gate copying through capabilities. Do not fabricate an address when mail is unavailable. Discovery and Cancel leave the config and library unchanged; OPML explicitly adds to the library, and adding chosen new feeds retains completed subscriptions if a later item fails so retries do not duplicate them.
- 2026-11-26: Reddit announced native RSS retirement for 2026-11-13. Keep subreddit URL recognition/conversion but report unavailable native feeds and allow the user to paste their own relay URL; do not invent a hosted replacement. Change the hint's guarantee to “Brew looks for the feed”. Primary source: https://www.reddit.com/r/modnews/comments/1wubgvt/continuing_our_infrastructure_updates_whats/. Bluesky's native redirect is also documented by its maintainers: https://github.com/bluesky-social/social-app/issues/2273; Mastodon discovery: https://docs.joinmastodon.org/user/network/; podcast lookup: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/LookupExamples.html.

- 2026-11-25: Add `marked` 18.3.0 to core for standard Markdown Note blocks; pass its output through the existing article sanitizer before previewing or freezing it. Rendering runs in the API, keeping the parser out of the initial web bundle.
- 2026-11-25: Add `@js-temporal/polyfill` 0.5.1 to core for portable IANA-zone next-issue calculations and DST disambiguation, required by Compose's scheduled preview and the upcoming Schedule sheet. Use the standard compatible policy (earlier repeated time, later skipped time); keep this calculation on the API side so the web shell does not load the polyfill. Reference: https://tc39.es/proposal-temporal/docs/zoneddatetime.html.
- 2026-11-25: Migrate v1 sections to the canonical Compose model in 0006, retaining the exact original section JSON for the old REST shape and leaving frozen issue payloads unchanged. Convert a legacy divider to a preceding Markdown Note with a collision-safe ID. Node applies the portable data migration in the DDL transaction; future targets must pair both steps.
- 2026-11-25: Use canonical composition subroutes alongside the frozen v1 routes. Preview and generation share a pure builder; source unions deduplicate article IDs, Rules uses the same condition matcher and decoded article text, and filtering precedes the item limit. Batch untrusted regexes in a bounded Node worker and expose failures rather than silently showing no matches.
- 2026-11-25: Serialize autosaves and flush before Read, Brew switching, same-origin navigation and generation; retain newer local edits while an earlier write is pending. Cancel obsolete previews. Save the checked scheduled preview once, and retain each frozen issue's own display zone after later config edits.
- 2026-11-25: Compose has real Web, sandboxed Email and Atom draft previews. Generate their explicit colors from the Figma palette; email uses portable system font fallbacks. Keep Send test, Brief and unavailable source controls visible with their setup states. Full Add source and Schedule sheets follow as the next criteria; published outputs/mail delivery, newsletters and AI remain M11, M10 and M17 work. Fixture counts describe its actual library rather than copying inconsistent sample totals.

- 2026-11-25: The owner requests direct commits on `main` and no PRs. Create local `main` from the completed M8 head (the checkout and remote previously used `master`); preserve the existing history.
- 2026-11-25: Read composes the shared sidebar, top bar, controls and icon sprite. Keep issue content frozen and obtain live article read/star/highlight state and successful applied-rule labels through a separate no-store `/api/brews/:id/state` port. Deduplicate issue members and rules; retained issues remain readable when library articles expire, with unavailable actions disabled.
- 2026-11-25: Use the four v2 layout names in Read, accepting v1 `hero` and `list` as aliases while the config migration waits for Compose. Compute lede, section totals, source count, remaining minutes and progress from actual issue/library data. Next-run metadata describes the existing Node scheduler; the explicit IANA schedule model follows in the schedule criterion.
- 2026-11-25: Keep formats visible with disabled controls, a badge and a working setup link until M11 renderers exist. The newsletter-specific cards and opt-in Brief in the same Figma frame belong to M10 and M17; the current grid renders subscribed articles. Supplied artwork stays unchanged in local browser-fixture assets; real article imagery remains feed data.
- 2026-11-25: Use URL-addressable issue selection, remember the last Brew, and give explicit `/b/…` routes precedence over the saved Reader landing preference. Move generation and display preferences to More actions. Lazy-load the library Reader and article overlay so the new default Read shell stays within the cold-load budget.
- 2026-11-25: Keep semantic emphasis markup and apply an unconditional important normal-font reset to all elements and pseudo-elements in the app, landing and demo. Check CSS, JSX/script class/style contexts and SVG attributes in lint/build; reject unreset semantic emphasis. Restrict Tailwind scanning to web source and browser fixtures so adversarial test strings never generate production italic utilities.
- 2026-11-25: Promote the already-installed PostCSS 8.5.16 to a direct dev dependency — parse stylesheets and font shorthands reliably for the no-italics guard; the existing TypeScript parser checks JSX and scripts.
- 2026-11-25: Use npm workspaces — one domain core must run in Node, Workers, the browser and CI.
- 2026-11-25: Preserve `server/`, `shared/` and `web/vite.config.ts` as compatibility exports while implementation moves into workspaces — the v1 unit/e2e test cases and visual baselines remain unchanged. Hono and capabilities follow in the next M7 iterations.
- 2026-11-25: Inject storage, search, fetch, XML parsing, clock, hash, regex and notification ports into core services — Node-only libraries and side effects remain in `targets/node`; the shared SQLite schema and migrations live in `packages/db`.
- 2026-11-25: Copy migrations and SPA assets into the build and resolve them from module URLs — production startup works outside the repository working directory.
- 2026-11-25: Hono owns every REST/media/event route in `packages/api`; keep Fastify as the Node socket, content parser and SPA host allowed by §5.1 — preserve v1 injection, parser limits, errors and production serving while the API stays portable. Service interfaces accept synchronous or asynchronous implementations for future targets.
- 2026-11-25: Capture 96 golden REST responses from commit `8165e73` before replacing routes — compare real v1 bodies, statuses, media bytes and product headers, normalizing only validated timestamps, random undo tokens and timings.
- 2026-11-25: Capabilities describe currently wired target features; Node initially reports mail, Reader API, MCP, WebMCP, AI and publishing unavailable until their milestones add working adapters. The target supplies the declaration to Hono; URL parameters cannot override it. `backgroundFetch.everyMinutes: 1` describes the due-feed scheduler tick, preserving adaptive per-feed intervals.
- 2026-11-25: Validate the shared capabilities contract at the HTTP boundary and withhold cached capability data after failed refreshes — feature controls must not enable actions from malformed or stale error-state data. TanStack Query shares one request among consumers and permits retry without a page reload.
- 2026-11-25: Implement Figma `15:2010` with a scoped v2 palette and self-hosted fonts before M8 — keep v1 screens stable while matching the new settings frame. Use actual host, read-state and fetch-limit data instead of the design’s sample database size, plan, feed totals or export date.
- 2026-11-25: Capability rows branch only on feature fields; mode names are presentation metadata. Locked and setup states stay visible with working URL-addressable guides. `.brew` transfer controls remain disabled until M15; the data guide offers existing OPML export and the Node backup command. General/Reading links reach current controls, while new connection settings open guides until their feature milestones wire the configuration flows.
- 2026-11-25: Strengthen small caption ink in the new screen to meet 4.5:1 against its canvas — axe found 4.4:1 with inherited v1 muted ink. The Figma layout, font metrics and SVG exports retain their intended geometry.
- 2026-11-25: Record the Figma light/dark variables (including eight artwork fills) and shared elevation effects in `design/tokens.json`, with frame provenance; dimensions follow §4.2. Generate CSS and Tailwind aliases from this manifest, with drift and legacy-palette checks in lint and build — one palette now drives all app screens and settings.
- 2026-11-25: Preserve the exact raw Figma muted color and derive a stronger caption token for small text. Primary controls and toggles use ink; links and rule editing use copper. User-selected highlight and tag colors remain data rather than theme colors.
- 2026-11-25: Generate all 17 Figma type styles from `22:2508` alongside color tokens; bind Tailwind sans/serif/mono to Instrument Sans, Newsreader and Geist Mono. Use Newsreader 19/31 for article content by default, keep an explicit saved sans preference, and keep article controls in the UI family. Disable synthetic font faces and retain optical sizing for Newsreader.
- 2026-11-25: Port the 53 Figma `5:2` exports into a generated inline sprite as explicitly required by M8. Preserve every exported path, stroke and viewBox; namespace IDs and replace the monochrome paint with currentColor. Keep checked originals and normalized checksums. The actual exports use 20×20 viewBoxes despite the component description's “24px grid”; exported geometry wins.
- 2026-11-25: Use labelled native controls, controlled composite patterns and native dialog sheets with explicit Tab wrapping, scroll locking and opener focus restoration. Reuse the new wordmark, Kbd, navigation items, badge and capability row in the existing settings UI; future feature screens compose this library.
- 2026-11-25: Preserve original primitive icon alpha geometry at its native dimensions using local SVG masks, allowing the exact theme paint without changing the exports. Strengthen derived caption ink from 80% to 75% muted: axe found 4.36:1 on subtle surfaces. Raw Figma color variables remain unchanged.

### Discoveries / gotchas

- The incoming lockfile could not pass `npm ci` because @emnapi transitive entries disagreed; workspace installation repairs the lockfile.
- Two v1 retention fixtures use July 10 dates and expire when run in November; `server/test/clock.ts` fixes the v1 suite wall clock without modifying its test cases. New core tests use injected clocks.
- `rss-parser` imports Node networking even when only `parseString` is used; core normalizes feed data behind `XmlFeedParserPort` and the Node adapter supplies rss-parser.
- A core browser-bundle regression rejects Node imports/shims; port-only tests exercise feed parsing and scoped regex rules without a database or network.

### Dependency justifications

- M9.2: `@js-temporal/polyfill` 0.5.1 — portable IANA schedule and DST calculation for live next-issue previews; API-only, absent from the web bundle.
- M9.2: `marked` 18.3.0 — standard Markdown parsing for Note blocks, followed by the existing sanitizer; API-only.

- M7.1 added no new third-party packages. Existing dependencies are assigned to their owning workspaces; local @brew/core, @brew/db, @brew/web and @brew/node packages share the domain core and platform adapters.
- `postcss` (direct dev dependency, already installed through Vite): parse CSS for the no-italics guard, including shorthand declarations, comments and unconditional resets.
- `hono`: portable Web Request/Response REST router shared by Node and future targets, required by M7.

### Iteration M7.1 — DONE (2026-11-25)

- Completed: npm workspaces and portable domain extraction, preserving all v1 test cases and screenshot baselines.
- Files changed: `packages/core` (domain services, types, ports, portability tests); `packages/db` (schema/migrations); `packages/web` (moved SPA); `targets/node` (runtime and adapters); `server`/`shared`/`web/vite.config.ts` (compatibility exports); root npm/TypeScript/Vitest/ESLint/Drizzle configuration; build asset/smoke scripts; README and this checklist.
- Verified: clean `npm ci --no-audit --no-fund`; `npm run typecheck`; `npm run lint`; `npm test` (66 passed: 63 unchanged v1 cases plus 3 portability cases); `npm run test:e2e` (23 passed, including eight unchanged light/dark visual baselines, accessibility and performance); `npm run build` (compiled Node target loads migrations, SPA assets and API outside the repository cwd).
- Discovery: the initial parallel e2e run captured the title list before its entry animation completed; the focused rerun and final full suite passed without baseline updates or test changes.
- Next unchecked criterion: replace Fastify routes with Hono while preserving REST contracts. M7 remains in progress; M8–M20 are pending.

### Iteration M7.2 — DONE (2026-11-25)

- Completed: Hono API replaces all Fastify REST handlers, with injected service interfaces and Web Request/Response streams. Fastify retains only the Node transport bridge, content parsing and SPA hosting.
- Files changed: `packages/api` (Hono router, route modules, service ports, security headers, event stream and browser-bundle test); `targets/node/src` (service/data adapters, transport bridge, broker lifecycle and route compatibility exports); `targets/node/contracts` (captured v1 corpus and provenance); Node contract/stream tests; workspace lockfile, Node manifest, server TypeScript config, README and this checklist.
- Verified: `npm run typecheck`; `npm run lint`; `npm test` (171 passed, including 96 captured v1 contracts, five body-adaptation cases, API browser portability and three stream lifecycle cases); `npm run test:e2e` (23 passed, unchanged light/dark visual baselines, accessibility and performance); `npm run build` (compiled Hono API, migrations, SPA and assets verified outside repository cwd).
- Discoveries: parsed JSON strings must be re-encoded when forwarded to Web Request; OPML accepts both XML text and a JSON string under the v1 contract. SSE cancellation must release subscriptions and heartbeat timers, and Node shutdown must close streams before waiting for sockets to drain. These cases are covered by regression tests.
- Next unchecked criterion: Node `/api/capabilities` and the web `useCapabilities()` hook. M7 remains in progress; M8–M20 are pending.

### Iteration M7.3 — DONE (2026-11-25)

- Completed: shared `Capabilities` contract and validator, target-owned Node declaration, no-store Hono `/api/capabilities`, and the web `useCapabilities()` hook with cancellation, shared caching, error recovery and fail-closed refresh behavior.
- Files changed: `packages/core/src/types/capabilities.ts` and `shared/capabilities.ts`; API ports/router; Node declaration/service wiring and integration test; web hook and development-only browser fixture; capabilities unit/e2e tests; TypeScript fixture coverage, compiled-build smoke check, README and this checklist.
- Verified: `npm run typecheck`; `npm run lint` (no warnings); `npm test` (181 passed); `npm run test:e2e` (26 passed, including three capability flows plus unchanged v1 visual, accessibility and performance checks); `npm run build` (compiled capabilities endpoint, SPA and migrations verified outside repository cwd).
- Dependency justifications: no new packages.
- Next unchecked criterion: Sidebar Mode chip and Settings → Where Brew runs from capabilities, matching Figma `15:2010`. M7 remains in progress; M8–M20 are pending.

### Iteration M7.4 — DONE (2026-11-25)

- Completed: capability-driven Mode chip in the Reader sidebar; Settings shortcut; `/settings/runs` matching Figma `15:2010` in light/dark; instance card, seven capability rows, visible disabled actions, setup guides with keyboard/focus behavior, and working library links. Settings load as a separate JS chunk.
- Files changed: web App/Reader/Brew URL entry points; reusable Sidebar/ModeChip/Badge and Figma asset map; settings presenter, page and setup dialog; scoped styles, self-hosted OFL fonts and unchanged local SVG exports with provenance; settings unit/e2e tests and new light/dark snapshots; two Brew snapshots (27 changed pixels for the Settings shortcut); production settings/asset smoke check; README and this checklist.
- Verified: `npm run typecheck`; `npm run lint`; `npm test` (184 passed); `npm run test:e2e` (30 passed, including settings/light/dark assets, zero third-party requests, zero serious/critical axe findings, keyboard setup guides, failure recovery and v1 performance budgets); `npm run build` (settings deep link, local fonts/SVGs, capabilities and SPA pass outside repository cwd).
- Dependency justifications: no new packages. Three OFL fonts are self-hosted early for this screen; the global type/token/component migration remains M8 work.
- M7 exit review passed 2026-11-25: a separate `git clone --no-hardlinks` of the completed source installed with `npm install --no-audit --no-fund` without lockfile changes. With CI reuse disabled, Playwright started `npm run dev` and passed the default Brew landing and real Node Mode-chip/settings/keyboard-guide flows (2 tests).
- Cleanup discovery: automatic approval review rejected deletion of the temporary clone as “blocked by policy”. The verified copy remains in Git-ignored `data/m7-exit-review`; ESLint excludes runtime data so this copy does not affect future checks.
- Next milestone: M8 — generate the full light/dark token system and replace stone/amber utilities; then finish the shared type, component and icon system. M8–M20 remain pending.

### Iteration M8.1 — DONE (2026-11-25)

- Completed: generated light/dark colors, dimensions and elevation tokens; Tailwind semantic aliases; migration of all app stone/amber utilities and scoped settings colors; reproducible generation and legacy-palette checks in lint/build. Global typography remains the next criterion.
- Files changed: Figma token manifest; token generator/library and semantic-color check; web App/Brew/Reader/Rules and shared/settings styles; development-only color foundation fixture; two token unit tests, two palette/theme-switch browser tests and a delayed-rule-preview regression; two new foundation snapshots and four reviewed Brew/Reader baselines; npm scripts, README and this checklist.
- Verified: `npm run typecheck`; `npm run lint`; `npm test` (186 passed); `npm run test:e2e` (33 passed, including light/dark visual checks, accessibility, theme switching, settings keyboard flows and v1 performance budgets); `npm run build` (compiled Node target, assets, migrations and SPA pass outside repository cwd).
- Discoveries: Reader's entrance fade could capture low-opacity text during visual checks; keep text visible while retaining its short positional animation. A late rules preview could clear “Rule saved.”; preview errors now have separate state, obsolete requests are cancelled, and a controlled delayed-response e2e covers the race. An initial settings Escape URL assertion failed once; four focused repeats and the final full suite passed without changing the dialog.
- Dependency justifications: no new packages; the generator uses the existing Prettier dependency.
- Next unchecked criterion: finish the self-hosted type system and assert no third-party font requests. M8 remains in progress; M9–M20 remain pending.

### Iteration M8.2 — DONE (2026-11-25)

- Completed: global self-hosted UI/reading/code families; generated metrics and `type-*` utilities for all 17 Figma styles; Brew typography and normal ledes; Reader article type with saved sans/serif and compact/relaxed preferences; shared font variables in settings; light/dark Figma type fixtures. The existing local OFL WOFF2 assets and swap declarations are reused.
- Files changed: token manifest/generator/output; web base and settings styles; Brew/Reader callsites; type fixture HTML/TSX/CSS; three typography browser tests and two new snapshots; eight reviewed Brew/Reader visual baselines; production font smoke check; font provenance README, root README and this checklist.
- Verified: `npm run typecheck`; `npm run lint` (no warnings); `npm test` (186 passed); `npm run test:e2e` (36 passed, including all 17 computed type metrics, actual Chromium custom-font use, six local Latin/Latin Extended WOFF2 responses, swap loading, zero third-party font/stylesheet requests, reading preference persistence, light/dark visuals, accessibility and v1 performance budgets); `npm run build` (all six WOFF2 signatures and MIME types, migrations, SPA and assets pass outside repository cwd).
- Discoveries: the existing variable WOFF2 files cover the required Newsreader and Instrument Sans weights. Scope the reading preference to content so toolbar controls retain Instrument Sans; explicit saved sans preferences survive the new serif default. Figma's type foundation has no static image/SVG assets.
- Dependency justifications: no new packages.
- Next unchecked criterion: build §4.3 components and fixtures, and port Figma `5:2` to an inline icon sprite. M8 remains in progress; M9–M20 remain pending.

### Iteration M8.3 — DONE (2026-11-25)

- Completed: all §4.3 primitives and 11 repeated composite patterns, with real controls and controlled state; 53-symbol inline SVG sprite and typed Icon API; original primitive masks, deterministic avatar fills, native modal/side sheets, roving radio focus, numeric bounds, visible unavailable controls, section drag/move/Alt+Arrow alternatives, selected article actions and code-copy feedback. Sidebar/settings reuse the shared library.
- Files changed: icon/component provenance manifests; 53 original icon exports and primitive reference assets; icon generator and generated symbols; control, pattern, sheet, mask, icon and avatar modules plus library documentation; shared component CSS and caption token; AppSidebar, Badge, app entry and settings capability rows; fixture HTML/TSX/CSS; 11 browser tests, 12 new light/dark snapshots and one reviewed dark settings baseline; lint/build scripts, Node asset smoke check, README and this checklist.
- Verified: `npm run typecheck`; `npm run lint` (no warnings, token drift and icon source/output checks included); `npm test` (186 passed); `npm run test:e2e` (47 passed, including exact comparison of every source vector/stroke/viewBox, native SVG mask dimensions, both palettes, pointer/keyboard interaction, disabled-option skipping, Calm counts, gating, focus trapping/restoration, accessibility and v1 performance budgets); `npm run build` (new SVG assets, fonts, migrations and SPA served outside repository cwd).
- Discoveries: Chromium's SVG image and inline rasterizers can differ slightly at edge pixels even with identical paths. Compare the rendered symbols' complete vector attributes to the source XML, retain source checksums, and separately keep visual snapshots. Hidden section bodies have zero rendered dimensions; verify asset loading for all references and native geometry when visible. Modal and side-sheet scrims are distinct in Figma (32% and 24% inverse).
- Dependency justifications: no new packages; native React/HTML controls and the existing Prettier runtime cover the library and generator.
- Next unchecked criterion: enforce zero italics in lint/tests, then perform the M8 exit review. M8 remains in progress; M9–M20 remain pending.

### Iteration M8.4 — DONE (2026-11-25)

- Completed: zero-italics policy across app UI, feed summaries, Reader content, landing, interactive demo and social SVG; lint/build typography guard; semantic markup preserved; italic marketing font requests removed. Tailwind source paths exclude adversarial policy tests.
- Files changed: normal-font guard/library and 32 unit regression cases; three browser tests covering real Brew/Reader content in both themes, all current app views, semantic tags, inline-style resistance, landing/demo/dynamic content and SVG text; global app/marketing styles, social SVG, npm scripts/lockfile, README and this checklist.
- Verified: `npm run typecheck`; `npm run lint` (no warnings; normal typography verified across 210 authored files); `npm test` (218 passed); `npm run test:e2e` (50 passed, all existing visual baselines unchanged); `npm run build` (compiled Node target, migrations, SPA, fonts and SVG assets pass outside repository cwd); `npm run website:verify` (all nine marketing artifacts and existing site contracts pass).
- M8 exit review passed 2026-11-25: Playwright's primitive, icon, composite, sidebar, modal and side-sheet gallery screenshots match in light/dark; their axe checks report no serious or critical findings. Existing Brew, Reader, settings, token and type visual/accessibility checks also pass.
- Dependency justification: PostCSS is now explicit for the guard; it was already installed through Vite, so no new transitive package was added.
- Next unchecked criterion: M9 Read view matching Figma `8:2` / `9:270`. M8 is complete; M9–M20 remain pending.

### Iteration M9.1 — DONE (2026-11-25)

- Completed: Read shell from Figma `8:2` / `9:270`, with shared sidebar/top bar; date/number/title/lede/meta masthead; lead, magazine, grid and headlines layouts; section totals and scoped mark-read; selected/focused article actions; real rule highlight/chips; contents rail, progress, remaining minutes, gated formats, next-run metadata and end state. Article open/star/read use the existing library API. Bulk operations confirm and offer scoped Undo; subsequent single-item actions clear the older bulk Undo.
- Completed: numeric `/b/:brew/:issue` deep links, archived date navigation, remembered Brew selection, Compose entry, More actions with generation/edition/display controls, immediate `/` search focus, and explicit-route precedence over the saved Reader landing. Preserve image proxying by default and correctly decode stored proxy URLs only after direct-image opt-in.
- Files changed: core Brew layout/read-state types and storage port; Node live-state adapter; no-store Hono issue-state endpoint; Read view/hook/styles; Brew controller and app navigation/preferences; reusable sidebar/toolbar and lazy article-reader export; eight original Figma image exports with source nodes/checksums; Node state/immutability integration test; five Read browser tests, fixture and two new light/dark snapshots; two replaced Brew baselines; existing e2e entry selectors; README and this checklist.
- Verified: `npm run typecheck`; `npm run lint` (no warnings; typography guard checks 219 authored source files); `npm test` (219 passed, including all v1 REST contracts and the issue-state/immutability case); `npm run test:e2e -- --workers=2` (55 passed, including Read visuals, native artwork geometry, zero third-party shell requests, zero serious/critical axe findings, keyboard actions, archived reload, scoped bulk/undo, failed-state retry, image privacy and existing v1 budgets); `npm run build` (compiled Node API, SPA, fonts/SVGs and migrations pass outside repository cwd). A final focused Read run also verifies the corrected shared elevation token for its status surface.
- Discoveries: the settings stylesheet's dark image filter applied to article artwork when the shared shell was reused; limit it to the original settings icon path. Register the `/` listener before paint so the first keypress cannot race a passive effect. Ingestion stores already-proxied thumbnail URLs, so direct-image preference must unwrap those URLs. Reader visual captures now request reduced motion and finish remaining finite animations; its existing baselines are unchanged.
- Validation note: default parallel browser runs intermittently missed an existing search timing budget and screenshot stability; one unit run missed the existing regex worker timeout. The isolated regex suite and full unit rerun pass without changing rules code. The final complete two-worker browser run preserves every existing budget and assertion. Only the intentionally replaced Brew baselines and the two new Read baselines changed.
- Dependency justifications: no new packages. Reuse React, TanStack Query, native controls/dialogs and the shared Figma library.
- Next unchecked criterion: Compose matching Figma `10:458`, including the v2 config/section migration, controls and live preview. The existing composer remains available until that criterion replaces it. The M9 exit review waits for Compose, Add source, Schedule and the remaining core/read-state criteria; M9–M20 remain in progress or pending.

### Iteration M9.2 — DONE (2026-11-25)

- Completed: Compose from Figma `10:458`, with schedule summary, expanded/collapsed cards, visible grip and move buttons plus Alt+Arrow alternatives, multiple library sources, all four layouts, item/depth/image/unread/order controls, sentence filters with actual counts, per-section days, Markdown Notes and dividers, remove confirmation/Undo, linked Editing outline, Web/Email/Feed tabs and Desktop/Phone preview. Autosave reports pending, saved and retryable failure states; Read and generation await pending saves.
- Completed: canonical v2 types and lossless config migration; compatibility types/routes for v1; shared dry preview/filter builder; immutable numbered issues; IANA next-issue time and scheduling continuity after v2 edits; sanitized summaries/full text with Images off applied to embedded images as well. Existing issue dates retain their frozen zone. No published feed, email delivery or AI content is implied by the previews.
- Files changed: core composition model, schedule, preview/output and shared rule matcher; portable migration/schema; Node storage, scheduler, regex batch and decoded-text adapters; Hono composition/preview routes; Compose editor/draft hook/preview/basic dialogs/styles; Brew controller and modern Read support; shared top bar/section card; three original image assets and provenance; generated portable palette; migration and composition unit/integration tests; seven real-Node Compose browser cases and two new snapshots; legacy Composer entry fixture; build smoke, README and this checklist.
- Verified: `npm run typecheck`; `npm run lint` (no warnings, normal typography across 235 authored files, generated palette/icon checks); `npm test` (231 passed, including all 96 captured v1 REST scenarios); `npm run test:e2e -- --workers=2` (62 passed, all previous baselines unchanged, light/dark Compose snapshots, exact 468×190 and 84×58 image geometry, zero remote shell requests, zero serious/critical axe findings, keyboard/pointer reordering, filters, all preview formats, autosave serialization/failure/retry, obsolete response cancellation, source persistence and save/generate/Read round trip); `npm run build` (Node/SPA/assets/fonts/migrations, Compose deep link and compiled canonical preview API pass outside repository cwd). A final focused save/generate/Read browser run also passes after the scheduler freeze refactor.
- Discoveries: native selects otherwise size themselves to their longest option; scope content sizing to the narrow Compose sentence tokens. Keep preview notices after the paper so warnings do not displace its Figma position. Preserve headline-only display for old list sections, decode HTML entities identically in Rules and Compose, and remove embedded content images when Images is off. Update the migration smoke count from five to six and close its database on assertion failure.
- Dependency justifications: Temporal and Marked as recorded above; no additional framework or UI package.
- Next unchecked criterion: Add source sheet matching `11:694`. The current source and schedule dialogs are functional foundations; their complete Figma sheets and dedicated acceptance checks follow next. Arbitrary-time dry-run and two-way state acceptance/exit review remain unchecked. M9–M20 remain in progress or pending.

### Iteration M9.3 — DONE (2026-11-26)

- Completed: Add source sheet matching Figma `11:694` / `11:930`, with focused URL/search, validated multi-feed discovery, multi-select and subscribed/in-section states, newsletter hint and capability-gated Copy address, all seven library tabs, library filtering, native URL detection, OPML import, pending source preservation, partial-add retry, cancellation, unavailable-source removal, keyboard focus trapping/restoration and deep-link entry.
- Completed: portable native discovery and canonical source API; persistent saved-search sources and FTS matching; actual configured-address lookup without a fabricated fallback. Existing RSS subscriptions and source configs update only through the requested import/add actions. New subscriptions use the existing library/poller; mail ingestion remains M10 work.
- Files changed: core source types/discovery, index and Brew FTS query port/preview; 0007 migration and shared schema; Node source service, storage and API adapters; Hono source routes; full SourcePicker and scoped styles; shared modal class, rich checkbox labels, input ref/stable accessible name; Compose source names/basic-sheet export; README, build smoke and migration count; 14 Node source tests; nine real-Node source browser cases, controlled publisher fixture, two new light/dark snapshots and updated existing Compose source selectors; this checklist.
- Verified: `npm run typecheck`; `npm run lint` (no warnings, normal typography across 241 authored files); `npm test` (245 passed, including all captured v1 REST responses and portable browser-bundle checks); `npm run test:e2e -- --workers=2` (71 passed, all earlier visual baselines unchanged, light/dark source snapshots, zero serious/critical axe findings, zero remote browser shell requests, all tabs, keyboard selection, clipboard, import, partial failure/retry, cancellation, saved-search reload, stable labels and obsolete discovery cancellation); `npm run build` (compiled Node target, SPA, fonts/assets/migrations, source state routes and discovery validation pass outside repository cwd). A final focused OPML browser run and rebuilt production target also pass after singular/plural status wording was polished.
- Live Node verification: YouTube channel `UC_x5XG1OV2P6uZZ5FSM9Ttw` resolved to Google for Developers' native Atom feed; `mastodon.social/@Mastodon` to its `.rss`; `bsky.app/profile/bsky.app` to its stable DID RSS URL; Apple Podcasts ID 394775318 to the publisher's Simplecast feed. All four returned valid parsed documents without an account.
- Discoveries: loading status inside a native label changed the URL field's accessible name while discovery was pending. Give the shared input an explicit stable name while keeping its status independently announced. Clear request state in input/retry handlers, abort obsolete requests, and wait for the sheet to close before asserting autosave. Treat undated feed entries as unknown for cadence rather than using the parser's fallback clock. Preserve honest counts and mail setup states where Figma shows sample data.
- Dependency justifications: no new packages. Reuse the existing RSS parser, portable HTML parser, React/Query library, native File/Clipboard APIs and shared Figma controls/icons. No additional static artwork was required for the modal; the existing Compose artwork stays unchanged.
- Next unchecked criterion: full Schedule & delivery sheet matching `11:1314`. Arbitrary-time dry-run and two-way read-state acceptance/exit review remain unchecked. M9–M20 remain in progress or pending.

### Iteration M9.4 — DONE (2026-11-26)

- Completed: Schedule & delivery side sheet matching Figma `11:1314` / `11:1550`, with Daily/Weekdays/Weekly/Monthly, Monday-first day chips, arbitrary minutes, IANA zone selection and offset, monthly-date validation, pause, skip toggle/stepper, live next-issue status and retry, all five channel rows, capability gating with visible badges/setup links, local cancellation, explicit Save, save failure/retry and keyboard focus trapping/restoration. Correct the Compose summary's existing mail setup fragment to the working delivery guide.
- Completed: write-free server-clock schedule preview; injected `OutboundMailPort` and actual unsaved-preview test sends, with provider acknowledgement, retryable errors and no issue/config/counter writes. Default Node mail and published outputs remain gated until M11 adapters exist. V2 retention now matches the sheet's 30 days, with scheduler pruning for paused Brews and a persistent monotonic issue counter; v1 retains its 30-edition policy. The skip threshold counts unique unread selected stories.
- Files changed: core schedule validation, service, mail/schedule types, capabilities and storage port; Node storage/counter, capability/API/clock adapters and service wrapper; Hono schedule/test-email routes; full ScheduleEditor and scoped styles; Compose/basic-sheet exports/history cache; publishing setup guide; Node schedule integration tests, browser fixture, eight Schedule browser cases and two new light/dark snapshots; typography browser helper, compiled-target smoke, README and this checklist.
- Verified: `npm run typecheck`; `npm run lint` (no warnings, normal typography across 244 authored files); `npm test` (254 passed, including all captured v1 contracts); `npm run test:e2e -- --workers=2` (79 passed, all earlier visual baselines unchanged, light/dark Schedule snapshots, exact sheet/day-chip geometry, zero serious/critical axe findings, zero remote shell requests, weekly/monthly/zone persistence, pause/skip, cancellation, focus, obsolete-response protection, save/next-run retry, real transport-backed test-send success/failure and existing performance budgets); `npm run build` (compiled Node target, schedule preview/default-mail gating, SPA, fonts/assets and migrations pass outside repository cwd). A final focused setup-link browser check also passes after correcting the Compose summary link.
- Validation discoveries: two existing foundation sheet checks failed once (missing dialog and 30 close-icon pixels); four focused repeats and the subsequent full run passed without changing their controls or baselines. A later typography check observed empty computed styles from sidebar nodes replaced during settings rendering; query and inspect the live DOM in one browser evaluation. Six focused repeats and the final full suite pass with the same strict normal-font assertion. No visual tolerance or performance budget changed.
- Dependency justifications: no new packages. Reuse Temporal, the existing renderer, React/Query, native Intl/select controls and the shared Figma component/icon library. No new static artwork is required.
- Next unchecked criterion: arbitrary-time `preview_brew(at)` dry-run and immutable snapshots, followed by two-way read state and the M9 exit review (including a keyboard-only four-section composition). M9–M20 remain in progress or pending.

### Iteration M9.5 — DONE (2026-11-26)

- Completed: canonical core `previewBrew(id, at?, draft?)` and saved-config support on the existing preview API, retaining unsaved-draft preview and next-proposed-time defaults. Explicit UTC/offset timestamps use Temporal validation; ambiguous, coercible and impossible timestamps return 422, invalid/missing Brew IDs return 404, and all preview responses are no-store. Past/future publication cutoffs, rolling source windows and IANA section days are verified without scheduling or delivery side effects.
- Completed: the builder receives only storage read methods and captures a detached draft and Date before asynchronous filters. Dry runs create no config/issue writes, delivery calls, pruning or consumed numbers, including paused Brews, high skip thresholds and filter failures. Stored issue response/content bytes remain frozen through library/config changes, previews and subsequent generation; returned preview data cannot alias caller edits.
- Files changed: core Brew service, preview builder/time parser and storage read-port type; Hono preview route; ten Node dry-run integration cases; controllable preview-time browser fixture and one new browser test covering local-day rendering, strict timestamp errors/retry, zero writes and the frozen Read issue; compiled-target preview smoke, README and this checklist.
- Verified: `npm run typecheck`; `npm run lint` (no warnings, normal typography across 244 authored files); `npm test` (264 passed, including captured v1 REST contracts, dry-run and immutability cases); `npm run test:e2e -- --workers=2` (80 passed, all previous light/dark Figma snapshots unchanged, accessibility and existing v1 performance budgets preserved); `npm run build` (compiled saved/draft preview equivalence, offset handling, no-store validation errors, empty preview archive, Node target, SPA, fonts/assets and migrations pass outside repository cwd). Client bundle hashes remain unchanged because this criterion adds no production UI.
- Discoveries: JavaScript's Date parser accepts JSON coercions, date-only/local strings and some overflowing calendar dates; use Temporal.Instant for unambiguous validated input. A spread section can retain nested caller references across an awaited filter; clone the input once before building. Preview state reflects the current library's read/star values rather than reconstructing historical state, as documented.
- Dependency justifications: no new packages. Reuse the installed Temporal dependency and existing preview renderer, storage and test infrastructure. The named MCP/WebMCP tool binding remains M12 work.
- Next unchecked criterion: two-way read state between Brew and Reader, followed by the M9 exit review and keyboard-only four-section composition. M9–M20 remain in progress or pending.
