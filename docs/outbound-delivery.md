# Outbound delivery

Node sends a generated Brew through SMTP and/or a JSON webhook selected in
Compose → Schedule & delivery. It saves the frozen issue first. Delivery failure
does not remove the issue or turn generation into a missing-issue error.

SMTP stays off until it is configured. Supply these environment variables to
the Node process and restart it; `.env.example` shows the syntax. Brew does not
automatically load `.env` through `npm start` or `npm run dev`.

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
uses the unsaved draft and reports the actual SMTP acceptance result. It creates
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
deduplicate that key. Email gets a stable Message-ID derived from the same issue
identity; SMTP has no general exactly-once guarantee after a network interruption.

`GET /api/brews/:id/delivery` returns `{ issueId, results }` with private/no-store
caching. Older issues without delivery records return `results: null`. New
records live in the existing `brews.sent_json`, separately from immutable content.
Each channel reports `disabled`, `unavailable`, `pending`, `sent` or `failed`,
attempt counts/times, a message ID or last HTTP status where available, and a
bounded error category. Raw SMTP replies, destination URLs and credentials are
not copied into these results.

An atomic claim is stored before external I/O. Reopening an issue or restarting
Brew never silently resends it. `pending` after an interrupted process means the
delivery outcome is unknown; Brew does not guess or automatically replay it.
Scheduled generation records its schedule receipt before waiting on delivery,
and Node shutdown waits for active scheduled work before closing storage.
Email and webhook outcomes are independent; a failure in one does not cancel
the other. Atom/JSON subscription toggles and per-issue text twins are independent
of these outbound channels. Static public-copy publishing remains separate.
