# PROGRESS

## Current milestone: M0

## Checklist state

### M0 — Skeleton

- [x] Repo scaffolded per §4 (folders, TS strict, ESLint/Prettier, Vitest, Playwright, Tailwind, Drizzle configured, all §10 scripts runnable and green on empty project).
- [x] Fastify serves the SPA; `/api/health` returns `{ok:true}`; SSE endpoint streams heartbeat.
- [ ] SQLite opens/migrates on boot; schema of §6 created via migration 0001.
- [ ] `README.md` with run instructions.

## Decisions

- 2026-07-10: Use Tailwind CSS v4 through its Vite plugin — it keeps the scaffold minimal and avoids obsolete configuration.
- 2026-07-10: Keep server and web compilation separate — browser and Node module resolution have different requirements while remaining one package.

## Discoveries / gotchas for future iterations

- The repository began with only `CODEX_HANDOFF.md` and was not initialized as Git.
- Vite must bind explicitly to `127.0.0.1` on this Windows host; its default IPv6 binding is not reachable by Playwright's IPv4 base URL.

## Dependency justifications

- Fastify + `@fastify/static`: REST/SSE server and production SPA hosting required by §4.
- Drizzle ORM + `better-sqlite3` + drizzle-kit: canonical local SQLite persistence and migrations.
- React + Vite + Tailwind: specified SPA and styling stack.
- TanStack Query + Virtual: specified live data cache and large-list virtualization.
- rss-parser, Readability, linkedom, DOMPurify, node-cron: specified ingest, extraction, sanitization, and scheduling stack.
- TypeScript, ESLint, Prettier, Vitest, Playwright: required strict quality gates.
- tsx + concurrently: one-command local development for the server and SPA.
