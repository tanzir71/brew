# API discovery

Fetch `GET /api/openapi.json` from the Brew instance. In a local Node install:

```sh
curl http://127.0.0.1:4400/api/openapi.json
```

The document uses OpenAPI `3.1.0` and a relative `/` server URL. It describes the
actual registered Hono handlers, including REST, private Markdown/JSON exports,
Atom/JSON issue feeds, SSE, inbound webhooks and MCP. At M12.22 it covers 119 operations
on 101 paths with 55 reusable data schemas. It excludes HTML application routes,
static assets and unimplemented endpoints.

GET and HEAD return `application/json`, `Cache-Control: private, no-store` and
`X-Robots-Tag: noindex, nofollow`. HEAD has no response body. The server caches the
generated schema per application instance; it never calls services to collect
records, samples, credentials, configured addresses or delivery settings. Request
Host and forwarded-host headers cannot change the documented server origin.

## Using the contract

Resolve local `#/components/schemas/...` references when interpreting bodies.
Operations declare their actual success codes, error codes, media types, required
bodies and path/query parameters. JSON request bodies require
`Content-Type: application/json`. A 204 response has no body. Other errors usually
contain an `error` string; unexpected failures may also contain `message` and
`statusCode`.

Read `/api/capabilities` before using an optional feature. A documented operation
can return 501 when its adapter needs setup. Documentation does not enable that
adapter. Scoped bearer tokens authorize only `/mcp`; owner REST rejects bearer
credentials and still requires protection at the deployment boundary. Token
management requires a same-origin Origin header for writes. See [Agent access](agent-access.md). Postmark webhooks already use configured HTTP
Basic authentication. Mailgun verifies signed payload fields or raw-body signature
headers, as described on the inbound operations. No credential values appear in
the document.

The Node [MCP server](mcp.md) serves `/mcp` and CLI stdio, sharing the existing
services and durable action journal.

For article lists, `includeTotal=true` adds the exact total; `nextCursor` drives
cursor navigation. Search returns `nextOffset`. Rules history uses
`/api/rules/{id}/executions?page=N` with an exact total and 50-row pages. Its legacy
`/logs` route remains a bounded array of at most 100 rows. Rule previews return a
50-item sample; `includeTotal=true` adds the complete match total and sample limit
without executing actions. Brew previews do not save an issue or deliver it;
their temporary snapshot ID is zero.

Some export routes use a combined ID and format path parameter. For example,
`/a/{output}` accepts `12.md` or `12.json`, while `/b/{output}` accepts `4.atom` or
`4.json`. Keep selected filters in query parameters, such as
`/rules/12.json?tab=log&page=3&agent=1`. These exports describe saved state and do
not save an editor draft or mark content read.

For supported durable owner writes, use `POST /api/actions` with `confirm: true`.
Revision-bearing operations first require their read-only preview. Preserve a
`requestId` when checking a lost acknowledgement; changing arguments with the same
identity returns 409. A receipt's `id` identifies
`POST /api/actions/{id}/undo`. Inspect `canUndo`, `expiresAt` and `externalEffects`.
Undo has a 30-second window and refuses conflicting later changes. Legacy REST
writes remain available and do not all provide a durable receipt. The generated
operation descriptions identify those alternatives.

## Maintaining route coverage

Metadata is attached to each real handler with `documented(...)` in
`packages/api/src/routes/`, `newsletters.ts`, `inbound.ts` and `app.ts`. Shared data
shapes live in `openapi-schemas.ts`. Existing core and adapter validation still
controls runtime behavior; documentation middleware does not validate or transform
requests. Keep metadata aligned when changing a contract.

`registerOpenApi` uses
[hono-openapi's route generator](https://hono.dev/examples/hono-openapi), with
suffix routes explicitly included. There is no checked-in generated JSON or
separate list of endpoint paths. Registration completes before the document is
first served.

`targets/node/openapi.test.ts` compares every registered operation with the
generated paths, rejects missing/duplicate operation IDs and checks required path
parameters. Swagger Parser validates the OpenAPI 3.1 structure without external
reference access. Ajv compiles every data schema and checks actual Node/SQLite
responses, including previews, durable writes, conflicts and Undo. Tests also
verify separate application caches, no data/configuration leakage, private HEAD
and read-only discovery. The browser test checks the same endpoint through Vite's
real Node proxy; the compiled build verifier checks it outside the repository
working directory.
