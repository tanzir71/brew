# Receive newsletters on Node

Choose one connection per instance: a dedicated IMAP mailbox, Postmark inbound,
or Mailgun Routes. Set its actual receiving address as `BREW_INBOUND_ADDRESS`;
Brew does not provision an email domain. Subscribe or forward newsletters to it.
The address is exposed by `/api/sources/mailbox`, and capabilities report `imap`
or `webhook`. The Newsletters screen follows in the next M10 criterion; letters
already appear in Reader and ordinary feed-sourced Brew sections.

Use the variables in [the example environment file](../.env.example). Set them
through your shell/service manager, or load a filled `.env` using Node 20.6+:

```powershell
$env:NODE_ENV='production'
node --env-file=.env dist/targets/node/src/index.js
```

Build first with `npm run build`. `npm start` and `npm run dev` do not load `.env`
automatically. Restart after changing connection settings. An incomplete or invalid
mode fails startup with the affected setting's name, without printing secret values.
With no configuration, inbound mail stays disabled and no receiving address is shown.

## Dedicated IMAP mailbox

Use a mailbox containing only letters intended for Brew. Set `BREW_INBOUND_MODE=imap`,
the address, `BREW_IMAP_HOST`, `BREW_IMAP_USER` and `BREW_IMAP_PASSWORD` (a provider app
password when required). Defaults are `INBOX`, implicit TLS on port 993, and a check
every 60 seconds. For port 143 with mandatory STARTTLS use `BREW_IMAP_SECURITY=starttls`.
Certificate verification stays enabled. Optional port and interval overrides are in
the example file; the interval accepts 10–3600 seconds.

The first check starts on server startup, then repeats at the configured interval.
Brew imports read and unread messages alike, oldest first, up to 50 per check. It
selects the mailbox read-only and uses PEEK; it does not mark, move or delete mail.
SQLite stores a cursor per account/mailbox and UIDVALIDITY. Password rotation keeps
the cursor, while a UIDVALIDITY reset safely replays through article deduplication.
Sparse UID scans are bounded to 10,000 values per check, so large backlogs can need
several checks. Each check opens a fresh connection; failed connections retry later.

Malformed or oversized letters are skipped without blocking later mail. Originals
remain in the mailbox, and the cursor stores the last rejected UID. Temporary
processing failures stop before advancing past the failed message and retry it on
the next check. The Node log reports counts and a safe connection/processing error
code; raw mail, credentials and server error text are not logged.

## Postmark inbound

Set `BREW_INBOUND_MODE=postmark`, `BREW_INBOUND_ADDRESS` to the exact inbound address,
and `BREW_POSTMARK_USERNAME` / `BREW_POSTMARK_PASSWORD`. Use a random webhook password
of at least 16 characters; it is a separate secret chosen by you. Configure the
provider's inbound webhook as `https://username:password@your-host/api/inbound/email`.
Percent-encode credentials in that URL. This uses Postmark's supported
[HTTP Basic authentication for inbound mail](https://postmarkapp.com/developer/user-guide/inbound/configure-an-inbound-server).

The adapter reads the inbound JSON shape (`From`, `OriginalRecipient`, `Headers`,
`MessageID`, `HtmlBody`, `TextBody`, and optional `RawEmail`). Envelope recipients must
match the configured address exactly; aliases must be configured as the actual
receiving address. It uses the RFC Message-ID when available, preserves full HTML
for Show original, and ignores attachments. Bounce/event payloads are rejected.

## Mailgun Routes

Set `BREW_INBOUND_MODE=mailgun`, the address and `BREW_MAILGUN_SIGNING_KEY` to your
HTTP webhook signing key. For JSON delivery use a forward destination ending in
`/api/inbound/email/json`. The adapter verifies `X-Mailgun-Signature` over the timestamp
and exact raw body, as specified by the current [Mailgun Routes format](https://documentation.mailgun.com/docs/mailgun/user-manual/receive-forward-store/receive-http).

The `/api/inbound/email` endpoint also accepts native URL-encoded/multipart Route
posts, verifying the top-level timestamp/token signature. Legacy JSON with those
signed fields is supported too. The `/api/inbound/email/mime` alias accepts Route
posts containing `body-mime`. Message headers can be an array or encoded JSON; HTML
can be one string or multiple parts. Sender grouping uses the message's From, not
the SMTP bounce sender. Attachments are ignored.

Signatures accept timestamps up to 24 hours old and at most five minutes ahead,
allowing provider retry delays. Receipt hashes are retained for 24 hours. Identical
replays return the recorded acknowledgement; changing content while reusing a token
or provider delivery ID returns 409. Receipts survive server restarts, and the same
delivery identity is serialized within the Node process. A failed write gets no
receipt, so a provider can retry. These checks follow Mailgun's
[webhook signing algorithm](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks).

## Webhook hosting and responses

Expose only `/api/inbound/email` and its aliases through an HTTPS reverse proxy to
Brew's loopback server on port 4400; keep the rest of the single-user API private.
Preserve the Authorization and Mailgun headers and the exact request body. Allow
up to 10 MiB for this route at the proxy. Existing API routes retain their limits.

Successful inserts, blocked senders and duplicate deliveries receive 200 only after
processing finishes. Requests for another recipient receive 403; invalid authentication
receives 401; malformed input receives 400; oversized requests receive 413; unsupported
content receives 415. Temporary processing errors receive 503 so the provider can retry.
An unconfigured webhook receives 501. Postmark/Mailgun decide their retry schedules;
inspect their delivery logs for rejected or exhausted deliveries.

Payloads are limited to 10 MiB and each decoded text/HTML body to 2 MiB. MIME follows
the pipeline's header/part/nesting limits. Only cleaned content enters Reader/search/
Brew; originals follow sender retention even when a cleaned story is starred or tagged.
No provider credentials are stored in SQLite or returned to the browser.

## Other targets

Cloudflare's `email()` binding belongs to M14. Browser/static targets subscribe to an
email-to-feed URL as a normal RSS/Atom source when those targets are implemented;
Node's existing feed subscription already accepts such URLs. No mail account or domain
is fabricated for a target that has no receiving adapter.
