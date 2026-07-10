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
