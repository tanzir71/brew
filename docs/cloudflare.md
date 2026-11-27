# Cloudflare target

M14 is in progress. The Node target remains the completed deployment target.
The product Worker now connects actual fetch, scheduled and email handlers to
the shared API and D1/R2 services. Free resource budgeting, optional outbound
mail and the installer remain unfinished; the complete runtime criterion stays
open until that integration and its resource evidence are complete.

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
after a bounded one-minute stream. Migration 0013 adds a shared event journal;
rule notifications retain at most 256 entries and cascade away when their article
is deleted. A new subscriber starts with future `notification` events, matching
Node's live broker, while the revision refreshes library state after disconnection.
Cancellation clears polling and lifetime timers. Worker invocations do not need
to share in-memory listeners.

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
adapter. Regex-filtered previews use the explicit interruptible executor below;
omitting that port still returns the shared unavailable error.

## Rules, sources and native ingestion

The library graph adds D1 rule CRUD, exact previews, complete paged execution
history, hit counts and actual actions. Node retains synchronous CRUD methods;
both targets use the shared execution service and validation. Candidate identities
are selected once and contexts are read in batches of 40. This preserves ordering,
scope and the 50-item sample while counting every visible match. Tag creation and
assignment commit together on D1. The executor awaits tags, article changes,
notifications and logs, including failures, before returning.

Source discovery uses the same parser and native URL handling as Node. Saved
searches use shared validation and SQL, retain stable client IDs, and feed real
FTS-backed Brew previews. Mailbox lookup reports the configured active address.
Discovery and unsaved previews do not subscribe feeds or change saved state.

The shared feed/newsletter pipelines accept asynchronous hashing. The Worker uses
Web Crypto SHA-1 and Node keeps its synchronous hash helper; normalized identities
and stored hashes match. A bounded reader applies the shared 10 MiB MIME limit
before accumulating an Email Routing stream. Actual workerd email events now
exercise MIME parsing, cleaning, D1 insertion, rule execution and duplicate replay.
The integration email wrapper still lacks the product envelope/address checks;
it is not a production Email Routing entrypoint. The harness requires Message-ID
for native email dispatch, so an additional bounded test ingress verifies the
pipeline's fallback identity inside workerd.

Nine library cases compare Node discovery, sources, rule definitions, previews,
state changes and full history. They verify all actions, live cross-invocation
notifications, bounded journal/reconnection/deletion behavior, failed asynchronous
notification and tag writes, rule ordering during actual ingestion, and native
MIME processing. Regex execution now uses the actual WASM executor below. Missing
setup remains an explicit error. A timer around synchronous host regex cannot supply
interruption, and local Wrangler does not enforce deployment CPU limits. See
[Wrangler resource limits](https://developers.cloudflare.com/workers/wrangler/configuration/#limits).

## Interruptible JavaScript regex

`regex-worker.ts` loads the pinned QuickJS 2025-09-13 interpreter as a precompiled
WASM module. Pass `cloudflareRegex` to the library graph's `regex` option. Wrangler
needs this rule for the package's exported WASM alias:

```json
{ "type": "CompiledWasm", "globs": ["**/*.wasm", "**/wasm"], "fallthrough": true }
```

Patterns and values enter isolated contexts as data handles. The fixed guest
program constructs JavaScript `RegExp` with Node's `iu` flags; it exposes no host
functions, application objects, network, storage or module loader. Backreferences,
named captures, lookbehind, Unicode properties, NUL and lone surrogates are checked
against the real Node executor. Each operation disposes its handles, context and
runtime, including after errors. Concurrent requests reuse the compiled module,
with a fresh runtime and matching state for each operation.

QuickJS polls an interrupt callback during regex backtracking. The executor uses
both a deadline (at most 500 ms) and finite fuel (512 permitted interrupt/chunk checkpoints,
scaled down for shorter requested deadlines). Fuel remains effective when deployed
Worker clocks are frozen during CPU-only work; it is a work bound rather than a
calibrated millisecond guarantee. See [Cloudflare timers](https://developers.cloudflare.com/workers/runtime-apis/performance/)
and the [upstream regex polling implementation](https://github.com/justjake/quickjs-emscripten/blob/main/vendor/quickjs/libregexp.c).
This does not establish compliance with a deployed plan's CPU allowance.

Guest memory is capped at 32 MiB and stack at 256 KiB; imported WASM memory has a
64 MiB maximum. Compilation is bounded separately to 4000 UTF-16 code units.
One call accepts at most 50000 values, 4 Mi UTF-16 units per value and 16 Mi units
in total. Chunking bounds transient allocations without truncating the result.
Exhaustion returns an explicit redacted error and no partial match array. These
execution limits can reject otherwise valid patterns or oversized workloads;
matching never falls back to the host engine or a different regex dialect.

Shared rule previews now batch matching through the existing `testMany` port.
They preserve scope, order, visibility, complete totals and the first 50 matches.
A failed batch retries individual values to retain Node's existing policy of
excluding only a failed value; Compose continues to report a failed batch as an
error. The Node executor retains its real worker-thread interruption.

Real workerd tests exercise frozen clocks, catastrophic patterns, recovery,
ordered 50000-value batches, resource refusal, concurrency and Node compatibility.
The library, Brew, durable-action and MCP fixtures bind this executor through the
actual services; rule ingestion and dry runs execute it too. These remain explicit
integration fixtures, while product handler integration is still unfinished.

## Newsletter library and private page twins

The newsletter library now uses shared sender/count/paging selectors and preview
planning with Node. Its D1 adapter serves cleaned letters, retained originals and
sender preferences behind the existing routes. Exact preview revision hashes use
the same canonical input and SHA-256, with native Web Crypto on the Worker.

Preference writes compare the sender, affected Brew rows and retention candidates
against one read snapshot. An atomic batch updates routing, preferences and
retention together; a conflicting concurrent write retries against fresh data.
Failed batches leave no routing, pruning or temporary marker behind. Concurrent
independent sender edits merge, and two senders assigned to the same Brew retain
both source selections. Insertion also rechecks blocking atomically in both Node
and D1, so a block committed while mail is being processed prevents it being stored.

The graph registers the shared private page twins for letters, feeds, Rules,
Compose and other saved pages. They preserve existing privacy headers and never
include newsletter originals or mark letters read. Nine additional workerd cases
compare Node views, counts, complete paging, sanitized/inert content, exact revision
hashes and private outputs; exercise routing/concurrent edits/rollback/retention;
and drive native email into the actual newsletter API and twins. A D1 race check
protects a letter starred by another invocation before retention commits.

## Subscriptions and Reader sync

OPML parsing, preview planning and XML export are shared with Node. D1 imports
all subscriptions and any new folders in one atomic batch, including duplicate
URL normalization and concurrent import protection. Preview performs no writes or
external fetches, and exports exclude newsletter senders. Both targets enforce
the existing 1 MB document limit before importing.

The library graph also binds the shared Google Reader/Fever and app-password
routes. D1 selectors share Node's visibility, stream unions/exclusions, stable
cursor ordering, timestamps and labels. JSON bindings handle 10000 IDs and 100
streams without exceeding D1's parameter limit. State/tag changes, label edits
and revision updates use atomic batches; a revoked credential generation cannot
commit a delayed write. Temporary transaction markers never survive a failed
batch. Subscription add/remove/import now uses the actual durable action service
and returns a receipt for Undo. The full product capability declaration still
awaits its Worker entrypoint and owner authentication boundary.

Worker app keys use native Web Crypto randomness, SHA-256, HMAC and timing-safe
comparison. Fever's required MD5 value is stored only as a SHA-256 verifier.
[Cloudflare documents MD5 support for legacy protocols](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
Sessions persist in D1, are bounded to 100, and rotation/disable revoke all prior
sessions and Fever access. Login and Fever share an atomic per-instance attempt
window so a new invocation cannot reset throttling. Owner authentication remains
separate and unfinished.

Ten workerd/D1 cases compare Node parsing, imports/exports, stream counts and all
cursor pages; run actual Google Reader/Fever forms; verify bidirectional Node
credential/session compatibility, no plaintext secrets, rotation, throttling and
session bounds; and exercise forced rollback and revoked-generation writes.
The subscription contract now verifies actual quick-add plus durable Undo.
The fixture is not a product Worker or owner authentication boundary.

## Durable action journal foundation

Canonical migration 0014 adds persistent journal triggers using the same field
selection and conflict policy as Node's temporary triggers. A D1 transaction
activates recording, writes local state and cascades, extends Undo expiry,
finalizes caller-supplied receipt updates, and removes activation in one atomic
batch. The flag never spans asynchronous work. The action service below now uses
this foundation; the product ingress section below connects it to real handlers.

Restore checks the journal and recorded fields again at commit, protects later
children and saved source references, preserves unrelated later fields and
reverses foreign-key cascades in parent order. Short journals retain exact reverse
order, including unique-name swaps. Bulk restoration uses joined updates and JSON
chunks within D1's binding limit. A 50000-item read/Undo case runs inside workerd
and compares Node's result, without relaxing its deadline. Node also caches SQL
statements for the duration of Undo rather than recompile them per row.

D1 permits only five compound SELECT terms and 32 function arguments. The shared
trigger builder therefore uses bounded JSON groups, including wide article/feed
rows, rather than a SELECT union for every column. Cloudflare's current limits
also specify that an atomic batch counts as one D1 query invocation; individual
statement size and binding limits still apply to every statement. See
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Fifteen new real workerd/D1 cases cover capture, cascade restoration, transaction
rollback, commit-time conflicts, later source/child uses, tag ownership, concurrent
journal isolation, unique-name swaps and the full 50000-item case. These checks
verify local behavior and query/binding bounds, not deployed Free-plan CPU limits.
The raw SQL ingress is exclusively a test fixture and is never a product route.

## Confirmed actions and durable receipts

The library graph registers the existing action routes through a real async
service. Node and D1 share confirmation/validation, normalized request fingerprints,
redacted arguments, exact read-review inputs and receipt formatting. The D1 adapter
handles all existing action kinds: read/star/tags, subscription and OPML changes,
feed/folder/rule deletion, rule creation/Copy/application, and reviewed sender
preferences with routing and retention. Direct preference and legacy OPML routes
reuse the same prepared mutation plans.

Local effects, the receipt, Undo data, authorization rechecks and library revision
commit together. Duplicate request identities replay the original receipt across
invocations, including after Undo; different arguments conflict. Token actions
recheck a live write grant in D1, preserve the existing limited action kinds and
scope Undo to the originating token. Reader generation is checked again in the commit transaction. Cancellation is
rechecked after asynchronous authorization and before issuing the batch. This admission logic does not substitute for
the still-unfinished production owner or scoped-token ingress.

Rule application uses the shared executor and actual rule adapter. Each local
phase is journaled atomically; external operations hold no activation flag. A
persistent 15-second lease is renewed on local phases and before each external
operation. Replays observe pending work without launching it again; active work
refuses Undo, and an expired interrupted lease exposes failed status and its
remaining Undo window. Failed actions retain successful local changes and report
the real failure count. Undo cannot recall external effects. Receipt cleanup drops
expired Undo data and history, preserving active leases and redacted receipts.
Purged Undo data fences a stalled runner from resuming local or external work.

Twenty-one new workerd/D1 and adapter cases compare Node contracts and cover all action
kinds, concurrent commit/replay/Undo, actual held webhooks across invocations,
partial failures, cancellation, commit-time token revocation, interrupted recovery,
expiry, complete OPML and sender retention/routing Undo. A full 50000-item action
runs through the actual Worker preview/commit/Undo routes. Controlled elapsed time
also verifies lease renewal between a sequence of external actions. No existing
timeout, visual tolerance or performance budget is relaxed. Product ingress is exercised below; complete resource budgeting remains open.

## Scoped agents and MCP

The library graph now provides native Worker token issuance, verification,
revocation and redacted activity. Tokens use 32 bytes from Web Crypto, the same
base64url format and SHA-256 verifier as Node, read-only defaults and bounded
expiry. Shared validation, SQL and mappers preserve cross-target credentials.
The 100-token cap is enforced inside the insert; live-grant checks and last-use
updates are atomic. Secrets appear only in the creation response.

The actual MCP SDK runs inside workerd with the shared catalog. HTTP ingress,
per-tool admission, token routes, activity and private page twins await the real
asynchronous adapters. Token writes use the durable action service, live D1
authorization, scoped replay identity and token-owned Undo. Reads and rule dry
runs preserve library state. Write tokens cannot delete content or save rules.
Revocation during subscription discovery prevents the first commit.

WebMCP uses the same catalog through its existing opt-in capability and owner
same-origin boundary; scoped credentials cannot enter owner routes or exports.
The private instance guide reflects the configured capabilities without listing
library records or credentials. These are real library bindings tested through
an explicit integration fixture, not the product Worker or its owner
authentication gate. No new dependency, schema migration or UI is introduced.

Nine workerd/D1 cases cover native secrets and Node interoperability, concurrent
token creation, all read tools and paging, actual SDK negotiation, revocation and
expiry, restricted writes, replay/Undo ownership, activity pagination/redaction,
async admission, actual subscriptions and WebMCP gating. Compiled verification
also drives real MCP writes, Undo and revocation outside the repository cwd.

## Local verification

Use Node.js 22 or newer for the official Cloudflare development tools. No remote
Cloudflare account, resource or credential is used by these checks.

```sh
npm test -- targets/cloudflare/storage.test.ts
npm test -- targets/cloudflare/reader-api.test.ts
npm test -- targets/cloudflare/brew-api.test.ts
npm test -- targets/cloudflare/library-api.test.ts
npm test -- targets/cloudflare/newsletter-api.test.ts
npm test -- targets/cloudflare/reader-sync.test.ts
npm test -- targets/cloudflare/action-journal.test.ts
npm test -- targets/cloudflare/actions-api.test.ts
npm test -- targets/cloudflare/agent-api.test.ts
npm test -- targets/cloudflare/regex.test.ts
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

The original storage checks execute in the Node harness against real bindings.
The library cases additionally run feed and MIME ingestion, rules, sources and
Reader/Brew HTTP inside workerd. Compiled verification also checks saved sources,
rules and asynchronous hashing/ingestion outside the repository directory. The product email admission path is exercised by the native product harness
described below.

## Polling prerequisite

The shared ingestion port reads duplicate-filter state, new titles and recent
candidate titles in one consistent D1 batch. Node uses the same queries inside a
SQLite transaction. The shared NFKC/trigram policy uses a bounded candidate cache and
excludes each article's own ID; matching titles are hidden in one update before
rules run. Cloudflare rechecks polling or receiving-address admission inside that
update. A failed update rolls back all hides.

Ingestion snapshots rule definitions once per evaluation and reads contexts in
groups of 40, preserving input order, rule priority, stop-processing, action order,
real webhook retries/results and notifications. An evaluation with no enabled
rules loads no contexts; later evaluations read fresh definitions. Existing
single-article evaluation remains available. These policies are shared by Node,
feed polling and inbound newsletters.

Matched rules group ordered tag actions into one atomic write per group, flushing
before a webhook or notification can observe their state. Article fields remain
deferred until the rule finishes; those changes and the completed action log now
commit together in one batch. Node uses the same SQL helpers in SQLite
transactions. Narrow per-action ports, including the Node undo journal, retain
their existing execution path. A local rule with any number of tag actions and
no external actions normally uses two D1 write calls; a rule without tags uses
one. This reduces calls but does not bound the statements or work in a group.

A confirmed SQLite constraint rollback permits individual tag-action fallback,
so one rejected action does not erase other action results. Invalid tag values
fail explicitly. Transport/storage failures with uncertain write outcomes
propagate without replaying the batch or inventing provider acknowledgments.
Native binding cases cover constraint failures, field/log rollback and a real
commit followed by response loss; a workerd ingest check verifies 24 tag adds,
one removal and read/star changes in two write calls. External HTTP retries and
notification failures keep their actual results and ordering. Tag groups and
external effects are separate commits from the final field/log transaction;
durable interruption recovery across those boundaries remains unfinished.

A native workerd check ingests 120 sanitized articles with inactive duplicate and
rule policy in five D1 calls: the existing deduplication lookup/insert, duplicate
snapshot, rule-definition read and retention batch. Another actual product cron
ingests a 120-item feed with a nonmatching rule. Matching actions and multiple
feeds still add calls; durable processing/resource continuation and deployed CPU
verification remain necessary before claiming complete Free compliance.

`cloudflarePollingServices` adds the real poller to the library graph. Node and
Cloudflare now share conditional requests, parsing policy, adaptive intervals,
failure backoff and health updates. The Worker parser supports RSS, Atom and JSON
Feed and bounds response streams to 10 MiB, including misleading Content-Length.

Canonical migration 0015 adds expiring per-feed leases. One atomic D1 batch claims
at most the remaining fetch allowance in due-time/ID order; separate invocations
and manual refreshes cannot claim an active lease. Unstarted claims are released
after all concurrent work drains. Crashed runs recover after 16 minutes. Article
insertion, retention and feed metadata check ownership and the original source URL
inside their writes, so a superseded response cannot restore a deleted source or
overwrite its replacement. Newsletter senders are never fetched as RSS.

Create one `CloudflareFetchBudget` per invocation, with the capability's
`limits.maxFetchesPerRun` (1–40). Pass it to the polling graph so feeds, rule
webhooks and Brew webhooks share the same allowance. Every attempted request and
redirect hop counts. Polling concurrency scales down for the maximum redirect
cost so long chains can finish instead of repeatedly starving every due source. GET/HEAD redirects are followed manually; cross-origin hops
remove credentials. Streaming writes require manual redirects. Discarded bodies
are cancelled. Exhaustion before an input feed finishes leaves its validators and
health unchanged so a later invocation can retry; it is not a remote-source error.

The native scheduled integration fixture polls 200 feeds over five invocations,
with 40 external requests each, and verifies overlap/expiry/deletion races, real
ingestion, conditional refreshes, Node parity and shared rule-webhook accounting.
The fixture is not the product Worker or its owner authentication boundary.

This proves the external-fetch bound only. The current per-feed ingestion/rule
calls can exceed the separate Free D1 query allowance; durable batching and
resource continuation still need work. Local workerd does not prove the deployed
10 ms Free CPU budget. M14 remains open until the complete runtime meets its
resource limits. See the [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Still required: durable resource continuation, optional outbound provider setup
and the Cloudflare installer/deploy flow. These checks do not claim a working deployed
Worker or completion of M14.


## Product Worker and admission

`targets/cloudflare/src/worker.ts` is the product entrypoint.
`targets/cloudflare/wrangler.example.jsonc` binds the canonical migrations, D1, R2,
SPA assets, precompiled WASM and a once-per-minute Cron Trigger. `npm run build`
now also bundles that entrypoint and its WASM with Wrangler in dry-run mode;
it does not provision resources or deploy. The example remains an integration
checkpoint, with Free D1/CPU compliance still under implementation.

Configure `BREW_PUBLIC_URL` as the exact HTTPS origin,
`BREW_ACCESS_TEAM_DOMAIN` as `https://your-team.cloudflareaccess.com`, and
`BREW_ACCESS_AUD` as the Access application's audience. The Worker verifies the
`Cf-Access-Jwt-Assertion` signature with native Web Crypto through pinned `jose`,
RS256 only, and validates issuer, audience, expiration, not-before and future
issue times. Cookies and an authenticated-email header do not substitute for
signature verification. Public keys come only from the configured team, never a
JWT-provided URL. Key responses are bounded to 64 KiB/20 keys; keys cache for ten
minutes, with a 30-second refresh cooldown and deduplicated concurrent loading.
Failures return redacted private 401/503 responses and never accept expired cache
state. The cache retains public verification state, not an invocation's fetcher,
budget, owner token or identity.

`assets.run_worker_first: true` is required: owner HTML, fonts, scripts and other
assets pass the same admission boundary as owner REST and private text twins.
Owner mutations require an exact same-origin Origin header; command-line owner
clients must supply it too. Requests must use the configured origin/Host. Unknown
API paths return JSON 404 and never the SPA shell. GET/HEAD, static assets and
credential admission do not bootstrap database state. Legacy data/address
initialization runs as deployment/background work through the actual scheduled
and email handlers. Health is a generic read-only liveness response.

Reader routes under `/api/greader/` and `/api/fever` retain their real app-password
credentials. `/mcp` retains its scoped Brew token. Configure Access policy so
these machine endpoints can reach the Worker with those credentials, while owner
paths receive Access application assertions. A valid Access assertion does not
replace a Reader password or MCP token. The shared namespace isolation remains
active after owner admission.

Optional `PUBLIC_ASSETS` is an independent service binding containing published
static artifacts only. GET/HEAD `/share/*` remains public; writes are refused.
Forwarded requests omit owner credentials, cookies, assertions and query/fragment
data, and never enter the owner database/API graph. Its public caching is separate
from private owner responses. Access policy must also permit those published paths.
Publishing controls remain unavailable until the M16 publisher is implemented;
`publicCopy` stays false.

The scheduled handler runs actual journal cleanup, newsletter retention and both
legacy/composition schedules, then due polling. Frozen issue/delivery receipts
prevent repeats across invocations; scheduled delivery gets the shared allowance
before polling. `BREW_MAX_FETCHES_PER_RUN` accepts integers 1–40 (default 40).
`BREW_WEBMCP=1` enables the existing opt-in WebMCP capability. Outbound mail and AI
remain unavailable until their providers are wired, and Reader capability follows
the persisted app-password setup.

Scheduled newsletter retention processes at most 500 letters in one atomic D1
batch per invocation, rather than issuing a query for every sender. A private
settings cursor records the last ID and the fixed upper ID of the current sweep.
Later invocations resume it, including after an isolate restart. New mail waits
for the next sweep, so continuous arrivals cannot prevent revisiting older mail.
Original HTML is cleared after each sender's retention period; starred or tagged
letters keep their cleaned content, and RSS articles are untouched. The current
sender kind, retention and saved state are checked inside the transaction.
Cursor advancement and mutations commit together; overlapping invocations take
successive pages, and failed pages roll back for retry. Large inboxes therefore
finish retention over several cron runs. This bounds the processed page and its
D1 invocation calls, not total SQL rows inspected or the complete Worker's CPU
and query usage; polling, rules and scheduled generation still need their own
resource continuation.

Cron also loads Brew configuration metadata once for both shared legacy and
composition schedulers. That snapshot belongs to the current invocation; owner
HTTP and email work retain live adapters and do not run archive maintenance.
Format/composition lookups during the schedule scan use the snapshot rather than
making a D1 request for every configuration. The existing Node scheduling,
timezone, skip-threshold, issue-freeze and delivery policies remain in use.

Composition history cleanup removes at most 500 expired issues, oldest first,
per cron invocation, including paused configurations. It preserves each affected
configuration's maximum issue number in the same D1 transaction before deleting
history. The next invocation continues from the remaining expired rows. Kind and
expiry are rechecked during deletion; failed transactions retain both history and
counters for retry. Legacy history keeps its existing count-based retention.
Metadata and cleanup use one read batch and, when expired rows exist, one write
batch. This removes per-configuration metadata/pruning query growth; due issue
generation and delivery still need resource continuation, and a large metadata
snapshot is not evidence of compliance with deployed Free CPU limits.

For a live configuration, keep the private receiving address in a secret binding,
rather than checking it into a repository. For Email Routing,
`BREW_INBOUND_ADDRESS` bootstraps the initial receiving
identity only when no address has ever been stored. Existing identities and
revocations win over stale deployment variables. The native handler validates the
envelope sender and active envelope recipient before reading MIME. Header From
may legitimately differ from a bounce envelope, and Bcc mail need not contain To.
Sender creation, letter insertion and retention recheck the active receiving
identity inside their SQL writes, including revocation during reading/hashing.
Input failures are rejected permanently with a redacted reason; transient storage
failures throw for provider retry. No message is forwarded or replied to.

The native product harness uses actual D1/R2/assets and cryptographic signatures,
and executes the real handlers. It covers owner assets/REST/twins, temporal and
issuer/audience/signature failures, same-origin writes, machine credential
isolation, public static artifacts, R2 hits, 200 feeds over scheduled invocations,
scheduled delivery order/receipts, real inbound MIME and address revocation races.
Wrangler's local assets proxy overwrites Host with loopback, so the test-only
transport wrapper restores it from the original URL and explicitly models Host
mismatches; production keeps both checks. This is not deployed Free CPU or D1
quota evidence.

See [Access token validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
[Worker-first asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
and [Email Routing handlers](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/).
