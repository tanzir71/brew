# Browser storage

This target currently supplies SQLite storage. The browser product, its service graph, fetching, first-run flow and portable `.brew` archive are still in development. The public demo remains a separate sample transport.

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

Run `npm run build:browser` to build the self-hosted module, worker and WASM assets in `targets/browser/dist`. The root build includes this target and compiles Node. After that build, install the test browsers with `npx playwright install chromium firefox` and run `npm run browser:verify`. Browser binaries are required for verification, rather than production builds. The verifier uses real Chromium and Firefox persistence, the compiled Node migration adapter and native SQLite to check reopening, FTS5, Drizzle mapping, transaction isolation and file compatibility. The worker communicates only with its caller and loads its own local assets; it makes no feed or service requests.

References: [official package](https://github.com/sqlite/sqlite-wasm), [SQLite persistence](https://sqlite.org/wasm/doc/trunk/persistence.md), [SQLite database images](https://sqlite.org/wasm/doc/trunk/api-c-style.md#sqlite3_deserialize).
