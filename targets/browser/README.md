# Browser runtime

Open [Brew in this browser](https://tanzir71.github.io/brew/browser/) and choose **Start here** to create a real private library with three sample feeds and a 13-story Morning issue. The same React interface, Hono routes and domain services run against local SQLite. The public [demo](https://tanzir71.github.io/brew/demo/) remains a separate sample transport.

Add your own subscriptions after connecting an owner-managed relay in Settings → Where Brew runs → Feeds and full text → Set up. Relay settings never return the saved token. Browser mode catches up on open and checks due feeds while the page stays open; it cannot send email or expose a remote MCP/Reader server. A private email-to-feed URL can be subscribed through the relay. Portable `.brew` export/import is the next unfinished feature; do not treat the raw SQLite export primitive as a portable archive.

`npm run browser:dev` starts the browser app locally. `npm run build:browser-app` emits the deployable app to `docs/browser/`; `npm run website:build` includes it. Serve that folder over HTTPS or localhost. A service worker forwards this tab's HTTP, private images and preview requests to the live library; it stores no library data, caches no private responses and performs no background fetching. Hash URLs keep navigation within a project-hosted path. One live tab owns each library, and another tab reports that it is already open. Reloading or reopening preserves committed data.

For a different public host, set `BREW_BROWSER_PUBLIC_URL` to the complete browser app URL with a trailing slash before building. This sets the standalone sample feed/article links; a new local library derives its sample URLs from the actual app URL. The app, original Figma art, fonts and both WASM engines are self-hosted. `npm run browser:app:verify` exercises the built product in Chromium and Firefox, including cold start, real read/Compose state, persistent Undo, relay setup and local HTTP recovery.

The worker loads the official pinned SQLite WASM build and runs all canonical migrations from `packages/db/migrations`, including the same legacy composition data step as Node. Drizzle uses `packages/db/src/schema.ts`; native FTS5 and its existing triggers maintain the search index.

```ts
import { openBrowserDatabase, schema } from '@brew/browser';

const storage = await openBrowserDatabase();
await storage.transaction(async (tx) => {
  const [folder] = await tx.insert(schema.folders).values({ title: 'Design' }).returning();
  await tx.insert(schema.feeds).values({
    folderId: folder!.id,
    title: 'Notes',
    url: 'https://example.net/feed',
  });
});
const folders = await storage.db.query.folders.findMany();
await storage.close();
```

Use the callback's `tx` for every operation within a transaction. `storage.transaction()` serializes the entire asynchronous callback; `storage.db.transaction()` is deliberately unavailable. Drizzle batches and low-level `execute()` arrays are atomic. Low-level queries accept one statement each, with bound values. Transaction controls and attachment of other databases belong to the adapter and are rejected in those queries.

OPFS SAH-pool storage is preferred and does not require cross-origin isolation headers. If its APIs are absent, a new library uses an IndexedDB snapshot of the same SQLite file. Each fallback write waits for the strict IndexedDB transaction to finish before acknowledging success; a failed save restores the previously acknowledged SQLite image. The fallback copies the full database per committed write group, so callers should batch related changes.

Backend selection is saved with the library. A previously selected OPFS backend becoming unavailable is an error, and explicit backend changes require migration. Opening the library cannot silently select an empty fallback. OPFS initialization preserves files if it fails. Missing or invalid saved images are errors.

One Web Lock protects each named library for its worker's lifetime. A second tab gets a recoverable error rather than competing for OPFS handles or overwriting an IndexedDB snapshot. Closing the worker or leaving the page releases the lock; committed data survives reopening. Use an HTTPS origin or localhost and a browser with Web Locks. Browser clearing/eviction of origin storage remains subject to the browser's policies.

`exportBytes()` returns a consistent SQLite image suitable for native SQLite; it is the storage primitive for the later portable archive, without that archive's manifest or import workflow.

Portable archive primitives are in development. `archiveRows()` captures a coherent
library snapshot; `createBrowserArchive()` and `inspectBrowserArchive()` construct
and validate the `.brew` file in an isolated memory-only worker. The private
`replaceArchive()` operation requires quiescing the owning services first and
closing/reopening storage afterwards. It waits for persistence and rejects old
service scopes after success. Product controls remain disabled until confirmation,
durable Undo, content admission and all-target transfer are complete. See the
[format and adapter contract](../../packages/db/ARCHIVES.md). The additional
`npm run browser:archive:verify` check restores a real browser export into Node,
exports it back, replaces persistent browser storage, and checks exact rows and
FTS after reopening in Chromium and Firefox with both persistence backends.

Run `npm run build:browser` to build the self-hosted module, workers and WASM assets in `targets/browser/dist`. The root build includes this target and compiles Node. After that build, install the test browsers with `npx playwright install chromium firefox` and run `npm run browser:verify`. Browser binaries are required for verification, rather than production builds. The verifiers use real Chromium and Firefox persistence, the compiled Node migration adapter and native SQLite to check reopening, FTS5, Drizzle mapping, transaction isolation and file compatibility. The fetching verifier also runs the actual relay Worker locally, covering RSS/Atom/JSON, conditional requests, rules, scheduling and interrupted processing.

Use `openBrowserLibrary()` to own storage and fetching together:

```ts
import { openBrowserLibrary, schema } from '@brew/browser';

const library = await openBrowserLibrary({
  onCycle: (result) => console.log(result),
  onError: (message) => console.error(message),
});
await library.configureRelay({
  endpoint: 'https://your-relay.workers.dev/',
  token: relayTokenFromYourSettingsForm,
});
await library.storage.db.insert(schema.feeds).values({
  title: 'Notes',
  url: 'https://example.net/feed',
});
await library.refreshDue();
// Manual refresh ignores the interval for this feed:
await library.refreshFeed(1);
await library.close();
```

Opening a saved library starts catch-up asynchronously. Due-feed checks run every minute while the page is open, and again when it becomes visible or comes online. Browser suspension and background timer throttling can delay them. Closing the page stops fetching; this is not a background service. `refreshDue()` coalesces overlapping due checks; explicit refreshes serialize with other runtime operations. A newsletter sender is never polled as RSS. Call `configureRelay(null)` to remove the saved relay credentials. Changes wait for interrupted work to settle; call `refreshDue()` after configuration to retry immediately.

Feed URLs travel in an authenticated POST body. The token lives in the private SQLite settings and is sent only to the configured relay. Configuration results expose the endpoint and configured flag, never the token. The relay sees requested feed URLs and responses; use a relay you control. A relay authentication/origin/host error leaves source backoff unchanged; a real upstream failure follows Node's shared health policy. Redirects are checked against the allowlist. Response bodies are limited to 10 MiB and requests to twenty seconds.

Parsing, sanitization and bounded regex run in a separate worker. SQLite operations pass through the library's existing serialized connection, so a network wait does not block reads or break explicit Drizzle transaction isolation. Article inserts and pending jobs commit atomically; rule progress resumes on open. An interrupted external action has an unknown delivery outcome and is not automatically replayed. Rules can POST directly to an owner-configured webhook if it permits browser CORS; the feed relay never forwards webhook credentials or payloads. An optional `notifications` port can acknowledge an already-authorized browser notification. No permission prompt is triggered here; without a configured port the action records a failure and processing continues.

To deploy your own relay, copy [the 30-line Worker](relay/worker.js) and [configuration example](relay/wrangler.example.jsonc) into a separate directory. Rename the configuration to `wrangler.jsonc`, set `APP_ORIGIN` to your exact Brew origin (without a trailing slash), and set `ALLOWED_HOSTS` to comma-separated exact feed hosts, including any redirect hosts. No wildcard is supported. Run `npx wrangler secret put RELAY_TOKEN` with a random token of at least 32 printable non-space characters, then `npx wrangler deploy`. Supply the same token in Brew's configuration. For local development, `npx wrangler dev` and an HTTP loopback endpoint are supported. The template rejects other origins, missing/short tokens, userinfo, fragments, unlisted hosts and more than five redirects. It forwards neither owner cookies nor upstream credentials. This repository's tests deploy nothing to an account.

References: [official package](https://github.com/sqlite/sqlite-wasm), [SQLite persistence](https://sqlite.org/wasm/doc/trunk/persistence.md), [SQLite database images](https://sqlite.org/wasm/doc/trunk/api-c-style.md#sqlite3_deserialize).

Fetching references: [rss-parser's browser build](https://github.com/rbren/rss-parser#usage), [Worker CORS responses](https://developers.cloudflare.com/workers/examples/cors-header-proxy/), [QuickJS WASM loading](https://github.com/justjake/quickjs-emscripten#customizing-wasm-loading).
