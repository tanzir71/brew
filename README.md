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
│   web/ — React SPA                                         │
│   reading UI · feed management · rules · Brew snapshots    │
│        │                                                   │
│        │  HTTP (dev: Vite :4401 proxies → API :4400;       │
│        │        prod: one Fastify process serves both)     │
│        ▼                                                   │
│   server/ — Fastify API                                    │
│   feed fetching/refresh · article storage · rules engine   │
│   daily snapshot builder · Drizzle ORM migrations          │
│        │                                                   │
│        ▼                                                   │
│   data/brew.db — SQLite (auto-created & migrated on boot)  │
│   feeds · articles · rules · snapshots                     │
│                                                            │
│   shared/ — TypeScript types used by both sides            │
└──────────────────────────────────────────────────────────┘
              │ outbound only
              ▼
      the feeds you subscribe to
```

Why it's shaped this way: one process in production (Fastify serves the compiled SPA and the API), one file of state (SQLite + WAL), types shared end-to-end from database to UI. The only network traffic is Brew fetching your feeds.

## Getting started (from zero)

### Prerequisites

| Tool | Why | Get it |
|---|---|---|
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

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript strict check |
| `npm run lint` | Code style |
| `npm test` | Unit tests |
| `npm run test:e2e` | Playwright end-to-end (starts dev servers itself) |
| `npm run build` | Production build |

## Project structure

```
server/   Fastify API, SQLite/Drizzle schema, migrations
web/      React SPA + Playwright tests
shared/   types shared by server and browser
data/     local runtime data (git-ignored)
PROGRESS.md   milestone checklist and decisions
```

## Data ownership

Your entire state is `data/brew.db`. To back up manually, **stop Brew first** so the SQLite database and WAL stay consistent, then copy the file. Automated backup and OPML export commands arrive in later milestones (see `CODEX_HANDOFF.md`).

## Troubleshooting

- **Port already in use** → something else owns 4400/4401; stop it or change ports.
- **Feeds not refreshing** → check the server terminal for fetch errors; some feeds rate-limit aggressively.
- **Started fresh unexpectedly** → the app looks for `./data/brew.db` relative to where it runs; check `BREW_DB_PATH` and your working directory.
