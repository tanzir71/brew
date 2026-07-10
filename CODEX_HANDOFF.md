# CODEX_HANDOFF.md — "Brew" (working name): A Personal RSS Reader

> **Audience:** An autonomous coding agent (Codex) running in a loop.
> **Owner:** Tanzir (single user, UX designer — holds a high bar for UI polish).
> **Goal:** A local-first, single-user RSS reader that combines Feedly's UI/UX, Inoreader's rules engine, Feedbro's zero-server privacy, and Mailbrew's consolidated digest view.
> **Date:** 2026-07-10

---

## 0. How to run this document in a loop

You (the agent) must follow this protocol on **every** iteration:

1. Read `PROGRESS.md` in the repo root (create it on the first run using the template in §12).
2. Find the lowest-numbered milestone in §11 that is not marked `DONE`.
3. Within that milestone, pick the first unchecked acceptance criterion. Implement the smallest change that satisfies it.
4. Run the quality gates (§10). If any gate fails, fix it before proceeding — never mark a criterion complete with failing gates.
5. Update `PROGRESS.md`: check off the criterion, note files changed, note any decisions made, note anything discovered that future iterations must know.
6. Commit with message `M<milestone>: <criterion summary>`.
7. Stop. The next loop iteration starts fresh at step 1.

**Hard rules:**

- Never skip milestones. Never work on two milestones simultaneously.
- If a criterion is ambiguous, make the decision that best matches the product principles in §2, record it in `PROGRESS.md → Decisions`, and move on. Do not stall.
- If a milestone is fully checked, run its **Milestone Exit Review** (§11, per milestone), then mark it `DONE`.
- Never introduce a server dependency, external database, account system, or telemetry. This is a local, private, single-user app.
- Refactors are allowed only when a criterion demands it or a quality gate fails. No speculative abstraction.
- If you finish all milestones, work through §13 (Refinement Backlog) in order — that is the "fully refined" loop.

---

## 1. Product summary

A **local-first web app** (runs at `localhost`, all data in a local SQLite file) for a single user. Three pillars:

1. **Reader** — a fast, beautiful, keyboard-driven reading experience across subscribed RSS/Atom/JSON feeds (Feedly-quality UI).
2. **Rules engine** — user-defined automations that run on every new article: filter, tag, highlight, star, mark read, route to digest sections, notify (Inoreader-quality power, better UX).
3. **The Brew** — a Mailbrew-style consolidated daily timeline: a single, beautifully composed digest page assembled from configurable sections, generated on a schedule, replacing the anxiety of an unread-count firehose with a calm "here's your morning paper" view. In-app only, no email.

---

## 2. Product principles (use these to resolve ambiguity)

1. **Calm over completeness.** Default views should never scream unread counts. The Brew is the default landing page.
2. **Speed is a feature.** Every interaction < 100 ms perceived. List rendering must be virtualized. No spinners for local data.
3. **Keyboard first, mouse polished.** Every action reachable by keyboard (§7.6); every control also discoverable by mouse.
4. **Rules should feel like sentences, not SQL.** The rule builder reads left-to-right as plain English.
5. **Own your data.** SQLite file + OPML export at all times. No lock-in, no cloud.
6. **Design restraint.** One accent color, generous whitespace, real typographic hierarchy. When in doubt, copy Feedly's spacing/type discipline and Mailbrew's digest composition.

---

## 3. Competitor analysis

### 3.1 Feedly — *steal the UI/UX*

| Aspect | Detail | What we do |
|---|---|---|
| Strengths | Polished, fluid interface even at large feed volumes; clean typographic hierarchy; multiple density views (title-only, magazine, cards, article); folder/board organization; "Today" view; excellent article reader with inline images and estimated read time | **Adopt**: view density switcher, Today-style Brew, folder sidebar, distraction-free article overlay, read-time estimates |
| Weaknesses | Best features (AI feeds "Leo", 2,500 sources, notes) paywalled at Pro+ ($99/yr); cloud account required; free tier capped; increasingly pivoted to enterprise threat-intel, personal product is stagnating | **Avoid**: paywall psychology, account requirement, feature gating |
| Rules | Weak for personal use — prioritization via AI ("Leo") rather than deterministic user rules | Our rules engine is deterministic and transparent |

### 3.2 Inoreader — *steal the rules engine*

| Aspect | Detail | What we do |
|---|---|---|
| Strengths | Rules execute actions automatically on incoming articles (tag, star, mark read, push notification, webhook); content filters + duplicate filters that clean feeds before you see them; trigger conditions on title/content/author/URL with AND/OR combinations; "copy from" to duplicate rules | **Adopt**: full condition/action model (§7.4), duplicate detection filter, rule duplication, per-rule execution log |
| Weaknesses | Rule/filter counts are metered by plan (e.g. 50 filters, 30 rules on Pro) — quota anxiety; UI is dense and dated; rule builder is form-heavy and intimidating | **Avoid**: quotas (unlimited rules), form-heavy builder — ours reads as a sentence |
| UX | Functional but cluttered; ads on free tier | Ours: no ads, no clutter |

### 3.3 Feedbro — *steal the locality/privacy*

| Aspect | Detail | What we do |
|---|---|---|
| Strengths | Runs entirely in the browser — data never leaves the machine; free, unlimited feeds; built-in rule engine (filter, highlight, auto-bookmark, tag, hide, regex highlight, Slack/Discord actions); "ClearBody" full-text extraction for truncated feeds; feed auto-discovery from any page URL | **Adopt**: local-only data, unlimited everything, full-text extraction (§7.3), feed auto-discovery from a pasted site URL, regex support in rules |
| Weaknesses | Extension sandbox limits: dated utilitarian UI, no mobile, background polling dies with the browser, storage fragility, no digest concept | **Avoid**: we escape the sandbox by being a localhost app with a proper background poller and SQLite durability |

### 3.4 Mailbrew — *steal the digest* (discontinued; acquired by Readwise 2023 — the niche is open)

| Aspect | Detail | What we do |
|---|---|---|
| Strengths | Composable digest from heterogeneous sources; scheduled delivery ("your paper at 7am") killed feed anxiety; beautiful scannable layout — hero items, compact lists, section dividers; per-section item caps ("top 5 from X"); reading-position tracking | **Adopt**: section-based Brew composer (§7.5), schedule-generated snapshots, per-section caps and layout styles, "resume where you left off" |
| Weaknesses | Email-only delivery (rendering limits); subscription SaaS; shut down — proof that cloud dependence is fatal for personal tools | **Avoid**: email pipeline entirely (in-app only, per owner decision); any cloud dependency |

### 3.5 Positioning synthesis

No product on the market combines all four quadrants: Feedly polish is cloud + paywalled; Inoreader power is cluttered + metered; Feedbro privacy is ugly + sandboxed; Mailbrew calm is dead. **This app = the intersection, minus the compromises, for one user, on one machine.**

---

## 4. Tech stack (decided — do not revisit)

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js ≥ 20, single process | One `npm run dev`, one deployable |
| Repo layout | Single package, `/server`, `/web`, `/shared` folders | No monorepo tooling overhead |
| Backend | Fastify (REST + SSE) | Fast, small, first-class TypeScript |
| DB | SQLite via `better-sqlite3` + Drizzle ORM (migrations in `/server/db/migrations`) | Durable, single file at `./data/brew.db`, synchronous = simple |
| Scheduler | `node-cron` in-process | Polling + Brew generation |
| Feed parsing | `rss-parser` (RSS/Atom) + native JSON Feed handling | Battle-tested |
| Full-text extraction | `@mozilla/readability` + `linkedom` | Feedbro's ClearBody equivalent |
| Feed discovery | Fetch page → parse `<link rel="alternate">` + common paths (`/feed`, `/rss.xml`, `/atom.xml`, `/index.xml`) | |
| Sanitization | `dompurify` (server-side via linkedom) on all stored HTML | Security gate |
| Frontend | Vite + React 18 + TypeScript | |
| Styling | Tailwind CSS + CSS variables for theming (light/dark) | |
| State/data | TanStack Query + SSE for live updates | |
| Virtualized lists | `@tanstack/react-virtual` | Speed principle |
| Testing | Vitest (unit/integration), Playwright (e2e), fixture feeds in `/server/test/fixtures` | |
| Lint/format | ESLint + Prettier, strict TS (`"strict": true`, no `any` escapes) | |

**Ports:** server `4400`, Vite dev `4401` (proxied). Production build: Fastify serves the built `web/dist`. One command: `npm start`.

---

## 5. Architecture

```
┌────────────────────────────── Node process ──────────────────────────────┐
│  Fastify HTTP (REST /api/*, SSE /api/events, static web/dist)            │
│  ├── FeedService        (CRUD, OPML import/export, discovery)            │
│  ├── PollerService      (node-cron; per-feed adaptive interval;          │
│  │                       conditional GET w/ ETag + Last-Modified;        │
│  │                       concurrency limit 6; per-feed backoff on error) │
│  ├── IngestPipeline     (parse → dedupe → sanitize → extract full text   │
│  │                       [lazy] → persist → RULES ENGINE → SSE publish)  │
│  ├── RulesService       (evaluate + execute + log; manual re-run)        │
│  ├── BrewService        (scheduled snapshot builder + on-demand preview) │
│  └── SQLite (./data/brew.db)                                            │
└──────────────────────────────────────────────────────────────────────────┘
                     ▲ REST + SSE
              React SPA (Reader / Rules / Brew / Settings)
```

**Ingest order matters:** rules run *after* persistence but *before* the article is announced via SSE, so a "mark read"/"hide" rule means the user never sees the article flash in.

---

## 6. Data model (Drizzle schema — names are canonical)

```
folders      id, title, position, created_at
feeds        id, folder_id?, url (unique), site_url, title, description,
             favicon_url, fetch_interval_minutes (default 30, adaptive),
             etag, last_modified, last_fetched_at, last_status,
             consecutive_failures, full_text_mode (bool), muted (bool),
             created_at
articles     id, feed_id, guid, url, title, author, summary_html,
             content_html, full_text_html?, image_url?, published_at,
             fetched_at, read_at?, starred_at?, hidden (bool),
             hash (dedupe: sha1 of normalized url+title)
             UNIQUE(feed_id, guid)
tags         id, name (unique), color
article_tags article_id, tag_id  (PK both)
rules        id, name, enabled, position (execution order),
             match_type ('all'|'any'), scope_json (feeds/folders or all),
             conditions_json, actions_json, stop_processing (bool),
             created_at, updated_at
rule_logs    id, rule_id, article_id, executed_at, actions_taken_json
brew_configs id, name, schedule_cron (default '0 7 * * *'), enabled,
             sections_json (ordered array, see §7.5), created_at
brews        id, brew_config_id, generated_at, payload_json (frozen snapshot)
settings     key, value  (theme, default view density, landing page, etc.)
```

Indexes: `articles(feed_id, published_at desc)`, `articles(read_at)`, `articles(hash)`, `rule_logs(rule_id, executed_at)`.

---

## 7. Feature specifications

### 7.1 Feed management
- Add feed by URL; if the URL is an HTML page, run discovery and let the user pick among found feeds.
- OPML import (preserving folder structure) and export. Import must be idempotent (skip existing URLs).
- Folder CRUD, drag-to-reorder feeds and folders in sidebar.
- Per-feed: rename, move folder, toggle `full_text_mode`, mute (keep fetching, exclude from unread counts and Brew), delete (cascades articles), "fetch now".
- Feed health indicator in settings: last fetch, status, failure streak; feeds failing > 7 days get a warning badge.

### 7.2 Polling & ingest
- Adaptive interval: start 30 min; if a feed posts > 10 items/day shrink toward 15 min; if < 1 item/week grow toward 6 h. Clamp [15 min, 24 h].
- Conditional GET with ETag/Last-Modified; treat 304 as success.
- Exponential backoff on failures (interval × 2^failures, capped 24 h); reset on success.
- Dedupe by `(feed_id, guid)` then by `hash` across the feed.
- Sanitize all HTML server-side before persisting. Strip trackers (1×1 imgs, known tracking params on links: `utm_*`, `fbclid`, etc.).
- SSE event `article:new` batched per poll cycle.

### 7.3 Reader (Feedly-quality)
- **Layout:** left sidebar (Brew, Today, All, Starred, Tags, folders/feeds with unread counts — counts hidden when a "calm mode" setting is on), center list, article opens as an overlay/right pane (user setting).
- **View densities:** Title-only / Magazine (thumb + summary) / Cards. Persisted per-folder.
- **Article view:** clean typographic template (max-width ~680 px, 18 px body, 1.6 line-height), lazy full-text fetch button ("Load full article") when `full_text_mode` off, estimated read time, original-link, star, tag, share-copy-link.
- **List behaviors:** infinite virtualized scroll, mark-read-on-scroll (toggleable), "mark all read" with undo toast (5 s), unread/all filter, oldest/newest sort.
- **Today view:** all articles published in the last 24 h grouped by folder.
- Light + dark theme, system-default, instant toggle.

### 7.4 Rules engine (Inoreader power, sentence UX)

A rule = **scope + conditions + actions**, evaluated in `position` order on every newly ingested article. Unlimited rules.

**Builder UX:** renders as a sentence: *"When an article in **[Design feeds]** matches **[all]** of: title **contains** 'figma' — then **tag it 'Tools'**, **star it**, and **feature it in the Brew**."* Each bracket is an inline dropdown/input. Live preview panel shows the last 50 existing articles that would match (dry-run endpoint).

**Conditions** (field / operator / value):
- Fields: `title`, `content`, `author`, `url`, `feed`, `folder`
- Operators: `contains`, `not_contains`, `equals`, `starts_with`, `ends_with`, `matches_regex` (with regex validation + safe execution timeout)
- Combinator: match **all** / **any**; a rule may hold up to 10 conditions.

**Actions** (any combination):
- `add_tag(tag)` / `remove_tag(tag)`
- `star`
- `mark_read`
- `hide` (article never appears in lists; still stored; visible via a "Hidden" filter in settings for audit)
- `highlight(color)` (colored left-border in lists — Feedbro's trick)
- `feature_in_brew` / `exclude_from_brew`
- `notify` (Web Notification with article title; only if permission granted)
- `webhook(url)` (POST JSON; 5 s timeout; failures logged, never retried more than once)

**Semantics:** rules run in order; `stop_processing` on a rule halts the chain for that article. Every execution writes a `rule_logs` row. Rules page shows per-rule hit counts (24 h / 30 d) and a log drawer. Rules can be manually re-run against the last N days ("Apply to existing articles").

**Duplicate filter** (special built-in rule type): hide an article whose normalized title has ≥ 0.9 trigram similarity with an article from the last 3 days. Toggleable globally.

### 7.5 The Brew (Mailbrew-style digest)

- A **Brew config** = ordered list of **sections**; each section:
  - `source`: folder | feed | tag | starred | "featured by rules" | Today-all
  - `max_items`: 1–20 (default 5)
  - `layout`: `hero` (1 big card w/ image) | `list` (compact headlines) | `magazine` (thumb rows)
  - `title` + optional divider text
  - `sort`: newest | "longest" (by read time) — default newest
  - `only_unread` (default true)
- **Generation:** cron (default 07:00 daily) freezes a snapshot into `brews.payload_json` — the Brew never shifts under the reader mid-coffee. "Generate now" button for previews. Keep last 30 snapshots; a date-picker header navigates history ("yesterday's paper").
- **Rendering:** newspaper-calm single column, ~720 px, section headers with rule dividers, hero images, read times, source attributions. Items marked read from within the Brew. Scroll position persisted per snapshot ("resume where you left off").
- **Empty states matter:** a section with no items collapses to a single quiet line, not an empty box.
- The Brew is the **default landing page** (setting to change).
- Multiple Brew configs allowed (e.g. "Morning", "Weekend Deep Reads"), switchable by tabs.

### 7.6 Keyboard shortcuts (global, `?` opens cheat-sheet overlay)

`j/k` next/prev article · `o`/`Enter` open · `Esc` close · `m` toggle read · `s` star · `t` tag · `v` open original · `Shift+A` mark all read · `g b` go Brew · `g t` go Today · `g a` go All · `/` search · `r` refresh · `1/2/3` view density.

### 7.7 Search
- Full-text search over title + content using SQLite FTS5 (`articles_fts` virtual table, kept in sync by triggers). Search bar with scoping chips (all / current folder / starred). Results virtualized like any list.

---

## 8. Non-functional requirements

- **Performance budgets:** list scroll 60 fps with 10k articles; article open < 100 ms; app cold load < 1.5 s; poll cycle for 200 feeds < 60 s.
- **Resilience:** malformed feeds must never crash the poller (per-feed try/catch, log, backoff). DB writes in transactions.
- **Security:** all rendered article HTML sanitized; CSP on served app; external images proxied through `/api/img?src=` with an allowlist scheme check (privacy: optional setting "load images directly").
- **Accessibility:** WCAG 2.1 AA intent — focus states, aria on list/article semantics, full keyboard operability, contrast-checked palette in both themes.
- **Data safety:** `npm run backup` copies the SQLite file with timestamp; OPML export always available.

---

## 9. Out of scope (do not build)

Email delivery · accounts/auth/multi-user · mobile apps · cloud sync · AI summarization · social-network scrapers (RSS/Atom/JSON Feed only) · browser extension · read-later services integration.

---

## 10. Quality gates (run all, every iteration)

1. `npm run typecheck` — zero errors.
2. `npm run lint` — zero errors.
3. `npm test` (Vitest) — all pass; new logic ships with tests (rules engine and ingest pipeline require table-driven tests against fixtures).
4. `npm run test:e2e` (Playwright) — all pass; each milestone adds at least one e2e flow.
5. `npm run build` — clean production build.
6. No new dependency without a one-line justification in `PROGRESS.md → Decisions`.

---

## 11. Milestones & acceptance criteria

### M0 — Skeleton
- [ ] Repo scaffolded per §4 (folders, TS strict, ESLint/Prettier, Vitest, Playwright, Tailwind, Drizzle configured, all §10 scripts runnable and green on empty project).
- [ ] Fastify serves the SPA; `/api/health` returns `{ok:true}`; SSE endpoint streams heartbeat.
- [ ] SQLite opens/migrates on boot; schema of §6 created via migration 0001.
- [ ] `README.md` with run instructions.
- **Exit review:** fresh clone → `npm i && npm run dev` works on first try.

### M1 — Feeds & ingest
- [ ] Add feed by URL (incl. discovery from HTML pages); delete; rename; folders CRUD.
- [ ] Poller with conditional GET, adaptive intervals, backoff, concurrency limit (unit-tested with mocked HTTP against fixtures: RSS2, Atom, JSON Feed, malformed XML, 304, 410, redirect).
- [ ] Ingest pipeline: dedupe, sanitize, tracker stripping (tested).
- [ ] OPML import/export round-trips folder structure (test with a 100-feed fixture).
- [ ] Feed health surface in settings.
- **Exit review:** subscribe to 20 real feeds; two consecutive poll cycles produce zero duplicate articles.

### M2 — Reader core
- [ ] Sidebar with folders/feeds/unread counts; All/Today/Starred views.
- [ ] Virtualized article list, three densities, unread filter, sort.
- [ ] Article overlay/pane per §7.3 incl. lazy full-text extraction.
- [ ] Read/star/tag actions with optimistic UI + SSE-driven live inserts.
- [ ] Mark-all-read with undo; mark-read-on-scroll setting.
- [ ] Light/dark themes.
- **Exit review (UX bar):** Playwright screenshot pass at 3 densities × 2 themes; typographic scale documented in `web/src/styles/tokens.css`; interactions feel < 100 ms (measure with Playwright trace).

### M3 — Keyboard & search
- [ ] All shortcuts of §7.6 + `?` cheat sheet.
- [ ] FTS5 search with scoping chips (e2e: index 1k fixture articles, search returns < 50 ms).

### M4 — Rules engine
- [ ] Data model, evaluation in ingest path, ordering, `stop_processing` (table-driven unit tests: every operator × every action, regex timeout, condition combinators).
- [ ] Sentence-style builder UI with live dry-run preview.
- [ ] All actions of §7.4 incl. highlight rendering in lists, notify, webhook.
- [ ] Rule logs + hit counts + "apply to existing articles".
- [ ] Duplicate filter with trigram similarity (tested with near-duplicate fixtures).
- **Exit review:** create 5 realistic rules via UI in an e2e test; ingest fixture batch; assert exact resulting article states.

### M5 — The Brew
- [ ] Brew config CRUD: section composer with drag-reorder, all section options of §7.5.
- [ ] Scheduled snapshot generation + "generate now" + 30-snapshot history with date navigation.
- [ ] Brew rendering: hero/list/magazine layouts, calm empty states, read-from-Brew, resume position.
- [ ] Brew as default landing page; multiple named Brews via tabs.
- **Exit review:** golden-screenshot test of a seeded Brew in both themes; snapshot immutability test (new articles don't mutate an existing Brew).

### M6 — Hardening & polish
- [ ] Performance budgets of §8 verified with a 10k-article seed script (`npm run seed:big`).
- [ ] Image proxy + CSP + sanitization audit (tests attempt XSS via feed fixtures — must render inert).
- [ ] Accessibility pass: axe-core in Playwright, zero serious/critical violations on Reader, Rules, Brew.
- [ ] Backup script; error boundaries; empty/loading/error states for every view.
- [ ] Final visual polish pass against §2.6: spacing/type audit, favicon, app icon, page titles.
- **Exit review:** run the full e2e suite 3×; zero flakes.

---

## 12. PROGRESS.md template (create on first run)

```markdown
# PROGRESS
## Current milestone: M0
## Checklist state
(mirror §11 checkboxes here and keep updated)
## Decisions
- YYYY-MM-DD: <decision> — <rationale>
## Discoveries / gotchas for future iterations
- ...
## Dependency justifications
- <package>: <one line>
```

---

## 13. Refinement backlog (post-M6 loop, in order)

1. Feed favicon fetching + fallback letter-avatars.
2. Per-feed article retention policy (default: keep 90 days unless starred/tagged).
3. Brew "weekly review" section type (top starred of the week).
4. Rule templates gallery (mute keyword, highlight author, feature folder).
5. Import from Feedly/Inoreader OPML quirks (test with real exports).
6. Reader font/width/line-height preferences.
7. Saved searches as sidebar pseudo-feeds.
8. Podcast enclosure support (inline audio player).
9. PWA manifest for installable window.
10. Micro-interactions: subtle list-insert animation, star burst, undo toast refinement.

Each backlog item follows the same loop protocol (§0) with self-defined acceptance criteria recorded in `PROGRESS.md` before implementation.
