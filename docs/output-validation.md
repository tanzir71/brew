# Output fixture review

M11 exit review, 26 November 2026 (25 November UTC).

The synthetic fixtures in `packages/core/test/output-fixtures.ts` cover four
layouts, every depth, an unavailable Brief, local and publisher links, nested
lists, quotations, code, a content table, Unicode, notes, a divider, an empty
section, an empty issue, and the existing 20-letter cleaning corpus. They contain
no private mail. Full HTML and plain-text goldens live in
`targets/node/test/fixtures/outputs/` and are checked by
`targets/node/output-exit.test.ts`.

The actual Node SMTP adapter sends all three HTML/plain-text fixture pairs over
the local TLS test server. Postal Mime decodes the captured messages and verifies
both complete parts, Unicode subject and absence of attachments. Four browser
goldens review the reading fixture at 760px and 390px in light and dark. They check
the 600px desktop table, phone reflow, a loaded image, normal typography, theme
colors, safe absolute links, no horizontal overflow and no serious/critical axe
violations. Image requests are fulfilled locally with the existing native letter
artwork; no publisher is contacted. Existing Outlook conditional tables and inline
content styles also have structural coverage. This is browser and MIME coverage;
it is not a claim of testing proprietary desktop mail clients.

## Independent Atom validation

Both complete Atom goldens were submitted as UTF-8 direct input to the
[W3C Feed Validator SOAP service](https://validator.w3.org/feed/docs/soap.html),
with `manual=1`, `output=soap12` and at least one second between requests.
The actual SOAP responses are retained beside the fixtures as `*.w3c.xml`.

| Fixture       | SHA-256 of submitted bytes                                         | Validity | Errors | Warnings |
| ------------- | ------------------------------------------------------------------ | -------- | ------ | -------- |
| `empty.atom`  | `16d999211ce5884c83f4086a1202354dd6508a126454d2fb6955f09640fcb361` | true     | 0      | 1        |
| `issues.atom` | `332f42969082b84fc2edded7c985d99ddd520a9c8401f276005dc2d664d04337` | true     | 0      | 1        |

Each warning is `SelfDoesntMatchLocation`: direct input has no hosted document
URL, while the fixture intentionally identifies its reserved
`https://brew.example.test/b/17.atom` subscription. No feed was published and the
fixture URL was not fetched. The validator returned no content or metadata errors.
The files are pinned to LF endings so these byte hashes survive Windows checkout.

The offline suite independently parses strict XML and checks the relevant
[RFC 4287](https://www.rfc-editor.org/rfc/rfc4287.html) requirements: Atom namespace,
one feed/entry ID, title and updated date, valid dates and absolute identities,
author inheritance, a self link, whole-issue entries and correctly escaped HTML
content. Full feed goldens make output changes reviewable. Revalidate the changed
goldens with W3C and refresh this evidence after intentionally updating Atom output;
normal test runs need no network or external validator.

## Frozen caches

New v2 issues populate the existing `rendered_md` and `rendered_json` columns in
the same SQLite transaction as their payload and final issue number. These are
origin-neutral content twins, so a moved instance retains valid local links and
never embeds the previous owner's delivery destinations or mutable reading state.
A rendering failure rolls back both the issue and its number. Reads and later
config/scroll/delivery changes leave the payload and cached twins untouched.

HTTP twins continue to render frozen content with the current request origin or
configured `BREW_PUBLIC_URL` for external consumers. They do not backfill caches
or rewrite legacy issues during GET/HEAD. Legacy cache columns remain nullable.
Compiled-target smoke checks verify the new cache values outside the repository
working directory. Static publication remains separate and unavailable in Node.
