# Cloudflare target

M14 is in progress. The deployable application remains the Node target while
the Worker handlers and asynchronous API services are being connected. The
first M14 acceptance criterion is still open. Storage ports and the Reader/Brew
service graph below are verified prerequisites.

## D1

`targets/cloudflare/src/storage.ts` uses a primary D1 session per invocation and
the shared Drizzle schema from `packages/db`. Multi-statement writes use D1's
atomic `batch()` rather than separate awaited writes. Ingest and newsletter
ports use the same core normalization, MIME parser, cleaner, sanitizer, duplicate
policy and retention rules as Node. Existing articles avoid repeat sanitization,
and SQL rechecks deduplication inside the insertion transaction to handle
concurrent deliveries. Starred/tagged articles keep their cleaned content after
retention, while original letter HTML is pruned.

The canonical SQL files are in `packages/db/migrations`. The tests apply those
files through Wrangler's SQL splitter, preserving multi-line FTS trigger bodies;
D1's line-oriented `exec()` is unsuitable for that migration. The portable data
step paired with migration 0006 also converts legacy Brew sections and schedules
on D1, preserving the original payload and an explicitly supplied time zone.
It does not overwrite compositions that have already been converted or edited.

See [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
and [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

## R2 images

The shared `/api/img` route accepts an optional `ImageCachePort`. The R2 adapter
stores images in a private bucket under `images/<SHA-256 of full source URL>`;
origin URLs and signed query parameters do not become object names. Entries
expire after one day. Expired or invalid metadata is treated as a miss. Private,
no-store, no-cache and cookie-setting origin responses are not stored. A cache
read/write outage falls back to the origin response.

The proxy validates HTTP(S) and image content types, limits streams to 10 MiB,
and cancels oversized bodies before reading more. All served images keep private
browser-cache headers. The cache does not expose bucket objects as public URLs.
Bucket lifecycle provisioning is part of the unfinished installer work.

See the [R2 Worker binding API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

## Reader API execution in workerd

The production Reader service factory supplies D1-backed feeds/folders, Reader
navigation, exact totals and cursors, FTS search, article read/star/tag changes,
hidden lists, full-text extraction and private Markdown/JSON twins. It registers
the existing Hono routes and OpenAPI metadata. Node and D1 share the SQL builders,
newsletter visibility rules, search paging, feed discovery, Readability extraction
and sanitizer. Runtime-specific adapters handle asynchronous D1 operations.

Legacy bulk-read Undo receipts persist in D1 across requests for their existing
five-second window. Restoring a receipt only clears rows that still carry its
read timestamp and consumes the receipt once. The full durable owner action
journal remains separate work.

Cross-isolate live updates use a D1 revision counter committed with mutations.
Subscribers catch up when they connect, poll every five seconds and reconnect
after a bounded one-minute stream. Cancellation clears polling and lifetime
timers. This avoids assuming that Worker invocations share in-memory listeners.

Seven integration cases use Cloudflare's official test harness to bundle the
actual Reader factory and execute HTTP routes inside workerd with real D1/R2 and
a local upstream service binding. They compare Node navigation, scopes, pages,
search and twins, then verify mutations, tag failure atomicity, cross-request
Undo/expiry, XML discovery, sanitized extraction, live updates, R2 caching and
scoped-credential isolation. Test-only entrypoints inject a clock and the subset's
capabilities; they are not the deployable Worker or its final capability declaration.

See the [official test harness](https://developers.cloudflare.com/workers/testing/test-harness/configure/).

## Brew composition and frozen issues

The expanded library graph supplies real asynchronous Brew services behind the
shared configuration, preview, generate, history, read-state, delivery-result and
private output routes. Node keeps its existing synchronous compatibility methods;
both targets use the same composition runner, source selectors, sentence matching,
schedule/threshold policy, sanitizer and renderers. D1 selectors bind ID collections
as JSON, including newsletter selections and live state for more than 100 articles.

An atomic D1 batch allocates the persistent issue number, stores the frozen payload
and origin-neutral Markdown/JSON caches, and records a scheduled minute's receipt.
Concurrent invocations can preview the same minute, but only one freezes and
delivers it. A failed cache write rolls back the issue, counter and receipt together.
Retention preserves numbering after the entire retained history expires. Reads and
previews never backfill caches or write article state.

The shared delivery runner awaits its durable claim before external I/O and
serializes snapshots of concurrent email/webhook results. Reopening a service graph
cannot silently resend a claimed issue. Webhooks use manual redirect handling and
reject redirects explicitly: Workers does not support `redirect: "error"`. See the
[Worker Request API](https://developers.cloudflare.com/workers/runtime-apis/request/).

Nine additional workerd cases compare Node previews, frozen issues and outputs,
exercise concurrent generation and scheduled invocations, retry/no-forwarding
webhook behavior, persistent delivery claims, skipped minutes, cache-failure
rollback, retention, legacy compatibility and newsletter unassignment. Their
scheduled handler and outbound-mail port belong to the integration fixture; they
do not establish a product scheduler, Email Routing or a Resend/Email Service
adapter. A target interruptible regex executor is also still required. Without
one, regex-filtered previews return the shared explicit unavailable error.

## Local verification

Use Node.js 22 or newer for the official Cloudflare development tools. No remote
Cloudflare account, resource or credential is used by these checks.

```sh
npm test -- targets/cloudflare/storage.test.ts
npm test -- targets/cloudflare/reader-api.test.ts
npm test -- targets/cloudflare/brew-api.test.ts
npm run typecheck
npm run build
```

Miniflare runs real local workerd D1/R2 bindings. Tests compare the canonical
tables, indexes and FTS triggers with Node, upgrade a v1 Brew row, exercise atomic
rollback and concurrent duplicate deliveries, process real MIME, and verify R2
hits, expiry, private responses, outages and stream cancellation. The build also
loads the compiled ports outside the repository working directory and verifies
real D1 newsletter ingest, an R2-backed image cache hit and frozen Brew generation
through the compiled HTTP graph with a matching Markdown cache.

The MIME ingest pipeline's storage checks still execute in the Node harness
against real bindings. Reader/Brew HTTP, composition, scheduling policy,
feed discovery, extraction and sanitization
also execute in bundled workerd tests. Inbound MIME execution inside the product
Worker remains part of the remaining handler integration.

Still required: product Worker fetch/scheduled/email handlers, the remaining
rules/agent/Reader-sync/newsletter/source API adapters, an interruptible regex
executor, bounded polling, Email Routing/outbound mail, owner authentication, and
the Cloudflare installer/deploy flow. These checks do not claim a working deployed
Worker or completion of M14.
