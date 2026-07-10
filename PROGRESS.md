# PROGRESS

## Current milestone: M2

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

### M2 — Reader core

- [x] Sidebar with folders/feeds/unread counts; All/Today/Starred views.
- [ ] Virtualized article list, three densities, unread filter, sort.
- [ ] Article overlay/pane per §7.3 including lazy full-text extraction.
- [ ] Read/star/tag actions with optimistic UI and SSE-driven live inserts.
- [ ] Mark-all-read with undo; mark-read-on-scroll setting.
- [ ] Light/dark themes.

## Decisions

- 2026-07-10: Use Tailwind CSS v4 through its Vite plugin — it keeps the scaffold minimal and avoids obsolete configuration.
- 2026-07-10: Keep server and web compilation separate — browser and Node module resolution have different requirements while remaining one package.
- 2026-07-10: Adapt active feeds by 25% per successful poll toward 15 minutes and quiet feeds by 50% toward 6 hours — gradual changes avoid cadence oscillation while honoring the specified targets.
- 2026-07-10: Follow DOMPurify with a strict linkedom tag/attribute/protocol allowlist — DOMPurify currently reports linkedom's partial window as unsupported, so the explicit pass preserves the mandated stack without trusting unsanitized fallback output.
- 2026-07-10: Flatten nested OPML folder paths as `Parent / Child` — Brew's canonical schema has one folder level, and retaining the full path avoids silently losing organization.
- 2026-07-10: Persist `failing_since` separately from the latest fetch attempt — a seven-day health warning cannot be derived accurately from `last_fetched_at`, which advances on every retry.

## Discoveries / gotchas for future iterations

- The repository began with only `CODEX_HANDOFF.md` and was not initialized as Git.
- Vite must bind explicitly to `127.0.0.1` on this Windows host; its default IPv6 binding is not reachable by Playwright's IPv4 base URL.
- Production compilation does not copy SQL assets, so the migration loader falls back to the repository migration directory when running from `dist`.
- Feed discovery validates declared alternate links and common-path candidates by parsing their response; unreachable and non-feed candidates are quietly omitted.
- DOMPurify with linkedom can return input unchanged because linkedom lacks parts of `WindowLike`; hostile-fixture tests must continue covering the explicit allowlist fallback.

## Dependency justifications

- Fastify + `@fastify/static`: REST/SSE server and production SPA hosting required by §4.
- Drizzle ORM + `better-sqlite3` + drizzle-kit: canonical local SQLite persistence and migrations.
- React + Vite + Tailwind: specified SPA and styling stack.
- TanStack Query + Virtual: specified live data cache and large-list virtualization.
- rss-parser, Readability, linkedom, DOMPurify, node-cron: specified ingest, extraction, sanitization, and scheduling stack.
- TypeScript, ESLint, Prettier, Vitest, Playwright: required strict quality gates.
- tsx + concurrently: one-command local development for the server and SPA.
