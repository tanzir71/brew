# v1 REST contract corpus

`v1-responses.json` was captured by replaying `scenarios.ts` against the original
Fastify routes at commit `8165e73`, before the Hono migration. Each request uses a
fresh SQLite database seeded by `seedContractDatabase` and a deterministic fetcher.
The golden file is evidence from v1; do not regenerate it from the Hono router.

Tests compare status, response body, media bytes, and product headers (including
CSP, content type, OPML download and cache headers). Wall-clock timestamps,
random undo tokens and timing measurements are normalized. Published fixture
dates, article ordering, pagination, counts, ids, nullability and error messages
remain exact. The tests separately validate token shape and non-negative timings.

Streaming and cancellation are verified separately against both the portable
Hono router and the live Node transport.
