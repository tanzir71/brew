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

### Current milestone: M7

### Checklist state


### M7 — Core extraction, capabilities, mode chip
- [x] Workspaces created; domain logic moved to `packages/core` with ports. All v1 unit and e2e tests pass unchanged.
- [x] Hono API replaces the Fastify routes in the Node target, with identical REST contracts (contract tests against v1 responses).
- [ ] `/api/capabilities` implemented for the Node target. A `useCapabilities()` hook exists in the web app.
- [ ] Sidebar Mode chip and Settings → Where Brew runs (`15:2010`) render from capabilities.

### M8 — Design system v2
- [ ] `tokens.css` generated from §4.2 (light and dark); Tailwind theme reads the CSS variables; stone/amber utilities removed.
- [ ] Newsreader, Instrument Sans and Geist Mono self-hosted (woff2, `font-display: swap`); no third-party font requests (asserted in e2e).
- [ ] Components of §4.3 built with stories or fixtures. Icon set ported from Figma `5:2` as an inline SVG sprite.
- [ ] Zero italics: a lint rule or test fails on `font-style: italic`, `<em>` without a reset, or `italic` utilities.

### M9 — Read and Compose
- [ ] Read view matches `8:2`/`9:270`: masthead (date · No. · title · lede · meta), section headers with "Mark section read", the four layouts, selected item with visible actions, rule highlight with chip, rail (In this Brew, progress, formats, next Brew), end-of-Brew state.
- [ ] Compose matches `10:458`: schedule summary card, section cards (collapsed/expanded), **visible drag handle + Move up/down buttons + Alt+↑/↓**, From/Layout/Items/Show/Options/Order/Filter fields, Note block, live preview with Web/Email/Feed tabs, Desktop/Phone toggle, "Editing" outline linked to the expanded card. Autosave shows "All changes saved".
- [ ] Add source sheet matches `11:694`: URL discovery, multi-select, "is also a newsletter" hint with Copy address, library tabs, detection hint for YouTube/subreddit/Mastodon/Bluesky/podcast URLs (convert to their native feed URLs), OPML import.
- [ ] Schedule & delivery sheet matches `11:1314`: Daily/Weekdays/Weekly/Monthly, day chips, time, IANA time zone, skip-if-fewer-than, channels gated by capabilities, "Send a test now".
- [ ] `preview_brew(at)` builds an uncommitted issue for any time ("dry run"). Snapshots stay immutable.
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

- 2026-11-25: Use npm workspaces — one domain core must run in Node, Workers, the browser and CI.
- 2026-11-25: Preserve `server/`, `shared/` and `web/vite.config.ts` as compatibility exports while implementation moves into workspaces — the v1 unit/e2e test cases and visual baselines remain unchanged. Hono and capabilities follow in the next M7 iterations.
- 2026-11-25: Inject storage, search, fetch, XML parsing, clock, hash, regex and notification ports into core services — Node-only libraries and side effects remain in `targets/node`; the shared SQLite schema and migrations live in `packages/db`.
- 2026-11-25: Copy migrations and SPA assets into the build and resolve them from module URLs — production startup works outside the repository working directory.
- 2026-11-25: Hono owns every REST/media/event route in `packages/api`; keep Fastify as the Node socket, content parser and SPA host allowed by §5.1 — preserve v1 injection, parser limits, errors and production serving while the API stays portable. Service interfaces accept synchronous or asynchronous implementations for future targets.
- 2026-11-25: Capture 96 golden REST responses from commit `8165e73` before replacing routes — compare real v1 bodies, statuses, media bytes and product headers, normalizing only validated timestamps, random undo tokens and timings.

### Discoveries / gotchas

- The incoming lockfile could not pass `npm ci` because @emnapi transitive entries disagreed; workspace installation repairs the lockfile.
- Two v1 retention fixtures use July 10 dates and expire when run in November; `server/test/clock.ts` fixes the v1 suite wall clock without modifying its test cases. New core tests use injected clocks.
- `rss-parser` imports Node networking even when only `parseString` is used; core normalizes feed data behind `XmlFeedParserPort` and the Node adapter supplies rss-parser.
- A core browser-bundle regression rejects Node imports/shims; port-only tests exercise feed parsing and scoped regex rules without a database or network.

### Dependency justifications

- M7.1 added no new third-party packages. Existing dependencies are assigned to their owning workspaces; local @brew/core, @brew/db, @brew/web and @brew/node packages share the domain core and platform adapters.
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
