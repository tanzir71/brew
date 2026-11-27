# Reader app compatibility

The Node target implements a Google Reader compatibility API and Fever v3 over
the same feeds, folders, articles, read state and stars used by Brew. Access is
off until the owner creates a separate app password. No additional account is
created. Check `GET /api/capabilities`: `readerApi` describes effective setup.

## Setup and credentials

Protect the owner app at your deployment boundary. Configure `BREW_PUBLIC_URL`
for a remote instance and use HTTPS there. Native clients must be able to reach
the Reader endpoints through any reverse proxy protection you configure.

Open **Settings → Apps & sync** (`/settings/apps`). The page shows this instance's
Google Reader and Fever URLs, prefers the configured public server origin, and
includes Reeder Classic / NetNewsWire FreshRSS instructions and Unread Fever
instructions. These are compatibility endpoints; no FreshRSS account on another
service is needed. Unsupported instances keep the controls visible and disabled
with setup guidance. Loading failures offer Retry.

Choose **Generate app password**, enter an app username, then copy the generated
password from the one-time dialog into your reader. The secret stays in that
dialog's memory and is cleared on dismissal, navigation or page hide; it never
enters browser storage, the URL, query cache or saved-page exports. Generation
is never retried automatically. If its response is lost, the page explains that
generating again replaces any password the first request created.

**Rotate app password** and **Disable app access** require a native confirmation
dialog and describe disconnection of all reader apps. Cancel starts focused for
these existing-access changes. Rotation does not restore the old password.
Status/capabilities refresh after changes; disable returns focus to the generation
control when the refresh finishes, without taking focus from newer user input.

The owner API can also configure access with a same-origin JSON request:

```js
const credentials = await fetch('/api/reader-access', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'reader' }),
}).then((response) => response.json());
```

The browser supplies the Origin header. The response contains `username` and a
new app `password`, shown only by this response. Copy it into the reader app.
Custom passwords are rejected: every password is a generated 192-bit random key.
Repeating this request rotates the credential and revokes all Reader sessions
and the previous Fever key. `GET /api/reader-access` returns status, username and
the server/protocol URLs, never a password. Same-origin `DELETE /api/reader-access`
disables access immediately. Private GET/HEAD `/settings/apps.md` and `.json`
describe saved setup and client notes without credentials or browser drafts.

The database stores a salted SHA-256 verifier of the generated password. Fever
requires MD5 of `username:password` on the wire; Brew stores only a SHA-256 verifier
of that protocol key. Reader session and write-token verifiers are also hashed.
Reader sessions survive restarts and remain valid until rotation/disable, subject
to a maximum of 100 retained sessions. Thirty failed authentication attempts in
one minute temporarily throttle Reader/Fever sign-in in that Node process.

These credentials grant reading, read/star/tag changes and subscription management.
They are separate from MCP tokens and cannot authorize owner REST, token management
or MCP. GoogleLogin headers outside the Reader namespace and bearer headers outside
their explicit namespaces are rejected. Reader responses are private, no-store and
noindex; default Node request logging removes query strings on these endpoints.
App passwords, Fever keys, Reader sessions and T values are secrets.

## Google Reader

Use `<instance>/api/greader` as the server base. The login endpoint is
`POST /api/greader/accounts/ClientLogin` with URL-encoded `Email` and `Passwd`.
Its default text response contains SID, LSID and Auth lines; `output=json` returns
their JSON equivalents. Supply `Authorization: GoogleLogin auth=<Auth>` on later
requests. `Bearer <Reader session>` is also accepted in this namespace.

The remaining endpoints live under `/api/greader/reader/api/0`:

| Endpoint                                            | Behavior                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| GET `token`, `user-info`                            | Write token T; single-owner identity                                        |
| GET `subscription/list`, `tag/list`, `unread-count` | Subscriptions, folders/item tags and unread counts                          |
| GET/POST `stream/items/ids`                         | Decimal item IDs and opaque continuation                                    |
| GET/POST `stream/items/contents`                    | Requested repeated `i` values in request order                              |
| GET/POST `stream/contents`                          | Stream contents, including GET stream-path aliases                          |
| POST `edit-tag`                                     | Repeated `i`, add `a` / remove `r`: read, starred, kept-unread, item labels |
| POST `mark-all-as-read`                             | Scoped bulk read, optional crawl-time cutoff `ts` in microseconds           |
| POST `subscription/quickadd`, `subscription/edit`   | Discover/subscribe, rename, move folder, unsubscribe                        |
| POST `tag/edit`, `rename-tag`, `disable-tag`        | Create, rename, remove folder/label                                         |
| POST `subscription/import`                          | Authenticated XML OPML import; no T required                                |
| GET `subscription/export`                           | OPML export                                                                 |

Form mutations require T from `token`, normally alongside the Authorization
header. Reeder's FreshRSS convention `T=x` is also accepted with a valid
Authorization header; the placeholder never authenticates a request by itself.
T-only POST clients are supported; a query token does not authenticate a
GET. Forms may be URL-encoded or multipart with text fields. XML import accepts
`text/xml`, `application/xml` and `text/x-opml` and uses the authenticated header.
Reader requests have a 1 MiB transport limit.

Streams include `user/-/state/com.google/reading-list`, read, unread and starred;
`feed/<Brew feed ID>`; and `user/-/label/<folder or item-tag name>`. `user/1` is an
alias for `user/-`. Folder names with slashes are supported. Brew has one folder
per feed; item tags and folder labels share the Reader label namespace.

List filters include repeated `s` and `xt`, page size `n` (default 1000, maximum
10000), continuation `c`, `r=o` for oldest, and crawl-time `ot`/`nt` in seconds.
`ot` includes its boundary second, so newly crawled older stories remain visible
on incremental sync; clients should deduplicate by stable ID.
Follow continuation verbatim. Published time plus article ID forms a stable keyset
boundary. Entry IDs serialize the existing non-reused AUTOINCREMENT identity as
`tag:google.com,2005:reader/item/<16 hex digits>`; decimal and canonical hex IDs are
accepted without 32-bit truncation. Structured responses use JSON.

## Fever

Use `<instance>/api/fever` (trailing slash also works). Send a URL-encoded POST
with `api_key=MD5(username:password)`. Query selectors can be combined: `groups`,
`feeds`, `items`, `unread_item_ids`, `saved_item_ids`. The response includes
`api_version: 3` and `auth: 1`; bad credentials return HTTP 200 with `auth: 0`.

Items are limited to 50 per response. `since_id` pages ascending, `max_id` pages
descending, and `with_ids` requests up to 50 explicit IDs. `total_items` is the
complete visible library count; unread/saved ID lists are complete, independent
of item paging. Feeds provide folder associations and favicon ID zero; `favicons`
and optional Hot Links return empty lists.

POST `mark=item&as=read|unread|saved|unsaved&id=<ID>` sets state idempotently.
`mark=feed|group&as=read&id=<ID>&before=<Unix seconds>` marks a scope read before
the cutoff; group zero selects all. GET never performs these mutations.

## Shared state and verification

Fetching contents never marks articles read. Both APIs exclude hidden articles,
return sanitized HTML and omit raw newsletter originals. Only-in-Brew senders are
excluded from passive streams/state lists; an explicitly selected feed or known
item ID can still retrieve that sender's articles. Read/star changes update live
Reader and Brew state through the shared SSE connection without rewriting saved
issue content. Bulk state changes are atomic; invalid batches leave no partial
item changes. Rotated credentials are rechecked inside mutation transactions.

Subscribe/unsubscribe/import use the existing durable owner action journal and
return `X-Brew-Undo-Id` for the owner's normal Undo window. State replication and
label edits set shared state directly and do not create per-item Undo receipts.

Protocol tests exercise real Node/Hono/SQLite, high IDs, multi-page libraries,
authentication/revocation, OPML/Undo and real SSE. Browser tests exercise live
Reader updates. The compiled build repeats authentication/content/state/Fever
checks outside the repository directory. The contracts were informed by the
[FreshRSS Reader API](https://freshrss.github.io/FreshRSS/en/developers/06_GoogleReader_API.html),
[FreshRSS Fever documentation](https://github.com/FreshRSS/FreshRSS/blob/edge/docs/en/developers/06_Fever_API.md)
and [NetNewsWire's Reader caller](https://github.com/Ranchero-Software/NetNewsWire/blob/main/Modules/Account/Sources/Account/ReaderAPI/ReaderAPICaller.swift).
These are protocol-derived tests, not captured native-app sessions. M13's native
NetNewsWire/Reeder replay exit review remains open.
