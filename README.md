# Brew

[Website](https://brew-reader.vercel.app/) · [Interactive demo](https://brew-reader.vercel.app/demo)

Brew is a local-first, single-user RSS reader. It keeps feeds, articles, rules, and daily Brew snapshots in a SQLite database on your machine; it has no account, cloud database, or telemetry.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:4401>. Vite serves the React app on port `4401` and proxies API requests to Fastify on port `4400`. The first boot creates and migrates `./data/brew.db` automatically.

## Production build

```bash
npm run build
npm start
```

Open <http://127.0.0.1:4400>. In production, Fastify serves the compiled SPA and API from one process.

Set `BREW_DB_PATH` to use a different SQLite file. Set `NODE_ENV=production` when invoking the compiled server directly.

## Quality gates

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

Playwright automatically starts the development servers for the end-to-end suite.

## Project structure

- `server/` — Fastify API, SQLite/Drizzle schema, and migrations
- `web/` — React SPA and Playwright tests
- `shared/` — types shared by the server and browser
- `data/` — local runtime data (ignored by Git)
- `PROGRESS.md` — milestone checklist, decisions, and implementation notes

## Data ownership

The database is stored at `data/brew.db` by default and is excluded from version control. Stop Brew before copying the database manually so the SQLite database and WAL stay consistent. Automated backup and OPML export commands are added in later milestones described by `CODEX_HANDOFF.md`.
