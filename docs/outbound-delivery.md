# Outbound delivery

Node sends a generated Brew through SMTP or Resend and/or a JSON webhook selected in
Compose → Schedule & delivery. It saves the frozen issue first. Delivery failure
does not remove the issue or turn generation into a missing-issue error.

SMTP stays off until it is configured. Supply these environment variables to
the Node process and restart it; `.env.example` shows the syntax. Brew does not
automatically load `.env` through `npm start` or `npm run dev`.

For Resend on Node or Cloudflare, configure `BREW_RESEND_API_KEY` and
`BREW_RESEND_FROM` (one bare sender address), plus `BREW_PUBLIC_URL` for absolute
links and proxied images. Use a verified sender domain and a domain-restricted
[sending-access API key](https://resend.com/docs/api-reference/api-keys/create-api-key).
On Node, supply environment variables and restart; an existing SMTP configuration
takes precedence. On Cloudflare, store the API key with `wrangler secret put`
and the sender in Worker configuration; then redeploy. No provider key is stored
in SQLite, returned through capabilities, or included in content outputs.
Absent, partial or malformed optional Resend settings keep email unavailable.

The shared port uses the [Resend send API](https://resend.com/docs/api-reference/emails/send-email)
with explicit HTML/plain text, a single recipient and the required User-Agent.
It sends one request without automatic retry or redirects. A five-second deadline
covers both the request and receipt stream; receipts are limited to 8 KiB. Only
a successful HTTP reply containing a valid provider message ID records `sent`.
Provider rejection, malformed replies and timeouts remain failed outcomes without
exposing response bodies or transport errors. Acceptance is not final inbox placement.
Cloudflare counts the send through the same invocation allowance as polling and webhooks.

| Variable | Value |
| --- | --- |
| `BREW_PUBLIC_URL` | Required for SMTP: the instance's HTTP(S) origin, without credentials. Scheduled mail needs absolute links and proxied images. |
| `BREW_SMTP_HOST` | SMTP hostname or bare IP address. |
| `BREW_SMTP_FROM` | One bare sender email address accepted by your provider. |
| `BREW_SMTP_SECURITY` | `starttls` (default) or `tls` (implicit TLS). Encryption and certificate checks are mandatory. |
| `BREW_SMTP_PORT` | Defaults to 587 for STARTTLS or 465 for implicit TLS. |
| `BREW_SMTP_USER`, `BREW_SMTP_PASSWORD` | Both, or neither for a trusted relay. Use your provider's SMTP credentials/app password. |
| `BREW_SMTP_SERVERNAME` | Optional TLS certificate hostname, useful when connecting to an IP address. |

SMTP uses Nodemailer, confined to the Node target. See its
[SMTP transport documentation](https://nodemailer.com/smtp). Connection/greeting
waits are bounded at ten seconds and idle socket waits at thirty seconds. The
adapter requires TLS 1.2 or newer, refuses certificate failures and STARTTLS
downgrades, and disables file/URL attachment loading. Credentials remain in
environment configuration, outside SQLite and API replies.

Enable Email and choose one recipient. Generated mail contains the frozen
issue's inline-styled, 600px HTML and a plain-text alternative. Send a test now
uses the unsaved draft and reports the actual provider acceptance result. It creates
no issue, consumes no number, updates no delivery settings/results and sends no
webhook. A successful SMTP acceptance does not promise final inbox placement.

Webhook delivery is available on Node without SMTP. Enable Webhook and enter an
HTTP(S) destination without embedded credentials or a fragment. The POST body is
the content-only JSON issue twin: it excludes source/filter configuration,
reading state, delivery settings, mail credentials and original newsletter HTML.
Responses are not retained. Redirects are refused. Each attempt has a five-second
deadline; any failure gets exactly one retry, for at most two attempts.

Both webhook attempts carry the same `Idempotency-Key`, based on the frozen
issue URL (or its private URN when no canonical origin is set). The recipient can
deduplicate that key. SMTP gets a stable Message-ID derived from the same issue
identity; it has no general exactly-once guarantee after a network interruption.
Resend gets a bounded SHA-256-derived key for that identity, following its
[24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys).
Unsaved test sends omit the key. Brew's durable receipts prevent silent replay
after that provider window expires too.

`GET /api/brews/:id/delivery` returns `{ issueId, results }` with private/no-store
caching. Older issues without delivery records return `results: null`. New
records live in the existing `brews.sent_json`, separately from immutable content.
Each channel reports `disabled`, `unavailable`, `pending`, `sent` or `failed`,
attempt counts/times, a message ID or last HTTP status where available, and a
bounded error category. Raw provider replies, destination URLs and credentials are
not copied into these results.

An atomic claim is stored before external I/O. Reopening an issue or restarting
Brew never silently resends it. `pending` after an interrupted process means the
delivery outcome is unknown; Brew does not guess or automatically replay it.
Scheduled generation records its schedule receipt before waiting on delivery,
and Node shutdown waits for active scheduled work before closing storage.
Email and webhook outcomes are independent; a failure in one does not cancel
the other. Atom/JSON subscription toggles and per-issue text twins are independent
of these outbound channels. Static public-copy publishing remains separate.

See [output fixture review](output-validation.md) for HTML/plain-text goldens,
actual multipart SMTP coverage, light/dark phone renders and independent Atom
validation evidence.
