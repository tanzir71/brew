# Portable library archive

The `.brew` format is a stored ZIP32 with exactly `manifest.json` and
`library.sqlite`. Version 1 uses UTF-8 JSON and a canonical SQLite file. The
manifest records the creation time, originating target, ordered SQL migration
names, database byte length and SHA-256, and optional local UI preferences.
The two ZIP entries also have CRC32 checksums. Keep the original export:
encrypted or recompressed ZIPs are unsupported.

`packages/core/src/archive.ts` validates the container, manifest and SQLite
header without platform dependencies. Checksums detect corruption; they do
not establish that an archive is trusted. A target must additionally admit
the exact canonical schema and migration prefix, check SQLite integrity and
foreign keys, and reconstruct rows using its own trusted migrations.

`archive-sql.ts` moves personal tables and SQLite sequence high-water marks.
FTS is rebuilt by canonical article triggers. Runtime identities, transfer
staging and migration-ledger rows are not personal data: the destination
creates them locally. The manifest still records the source migration prefix,
which must agree with the source SQLite ledger. Version 1 admits migration 19
and later known prefixes, and upgrades them before replacing current data.

Node's `inspectNodeArchive` and the dedicated browser `WasmArchives` worker
validate and normalize an archive independently of the live library. Inspection
never mutates the destination. Replacement is a private primitive requiring
exclusive owner admission. It checks the complete table/column layout, values
and sequences, then deletes and restores rows in one actual SQL transaction.
An import failure rolls back rows, FTS and the library identity together.
IndexedDB replacement also waits for its durable snapshot; a failed save
restores the last acknowledged SQLite image.

A successful replacement rotates the destination identity. Existing native
connections, cached statements and browser service scopes then reject access
until reopened. Native read admission and the query share one SQLite snapshot;
temporary triggers guard writes. A native iterator retains its checked snapshot
until exhausted or returned. Browser transactions check admission inside their
existing storage-worker queue. Reopening creates a fresh service scope.

Current implementation status: Node/browser primitives and the real
Chromium/Firefox storage-to-Node-to-storage round trip exist. Shared UI,
confirmation, durable Undo, content admission and Cloudflare transfer are
unfinished. Full-library controls remain disabled in the product. A raw
SQLite download or OPML export is not equivalent to this feature.

Run the independent runtime check after building Node and the browser module:

```powershell
npx tsc -p tsconfig.server.json
npm run build:browser
node scripts/verify-browser-archives.mjs
```

The check uses an isolated HTTP origin, actual dedicated workers and both
OPFS and IndexedDB. It writes its private test artifacts under
`test-results/browser-archives`; do not publish them.
