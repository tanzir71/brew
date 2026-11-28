# Install Brew on Cloudflare

The [brew-reader@0.1.0 installer](https://www.npmjs.com/package/brew-reader)
is published on npm, and the deploy-button template is on the public main branch.
Use Node 22.12+ and `npx brew-reader deploy cloudflare`. The package includes the
actual Worker, WASM, web assets and all canonical SQL migrations. For source
development, run `npm ci && npm run build` in this checkout, then use
`npx --no-install brew-reader deploy cloudflare`. `npm pack --workspace brew-reader`
produces a self-contained local tarball.

## One command

Prepare an active Cloudflare DNS zone, an unused hostname, enabled R2, and a
Zero Trust organization with One-time PIN or another sign-in provider. Create
a scoped API token for this account and zone. It needs account Workers Scripts
Edit, D1 Edit, R2 Storage Edit, Access Apps and Policies Edit, Access Organizations
Read and Identity Providers Read, plus zone Zone Read, DNS Read/Edit and Workers
Routes Edit. Set `CLOUDFLARE_API_TOKEN` in the shell environment, never a command
argument or a Worker secret. Set `CLOUDFLARE_ACCOUNT_ID` to skip that prompt.

Run:

```sh
npx brew-reader deploy cloudflare
```

The prompts collect account ID, HTTPS origin and owner email. For automation:

```sh
npx brew-reader deploy cloudflare --account-id ACCOUNT_ID --origin https://brew.your-domain.com --owner you@your-domain.com --dir .brew-cloudflare
```

Add `--dry-run` for a plan that does not need credentials or write files. A fresh
plan shows a proposed unique resource suffix; the first real run persists its
own suffix. `--name` changes the resource prefix; `--team-domain` can constrain
the detected Zero Trust organization. The origin must be an unused custom
hostname in the account, with no path or port. Existing DNS, Workers, data or
Access policies are never replaced. Keep other Access apps away from this host.

The installer creates a default-deny owner application before attaching the
Worker to DNS, then allows only the supplied owner email. More-specific bypass
apps cover `/api/health`, `/api/greader/*`, `/api/fever`, `/mcp` and `/share/*`.
These paths still enforce their own app passwords, scoped tokens or static-only
publication rules. The Worker independently verifies the owner Access issuer
and audience. Wildcard `/*` matches descendants; the Fever endpoint's exact
path covers its optional trailing slash under Access's path-matching rules.
See [Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/).

Next, it provisions private D1 and R2, applies the canonical migrations through
the `DB` binding, uploads Worker/WASM/assets and enables the minute cron. It
disables workers.dev and preview URLs, leaves optional mail off and verifies
public health plus unauthenticated owner denial. It does not log raw provider
responses or save the control-plane token in deployment files.

## Resume, upgrade and optional mail

Keep the deployment directory private and backed up. `deploy.json` records
creation intents, resource IDs and the accepted owner boundary; releases are
content addressed. Rerun the same command and directory after network failure
or DNS/TLS propagation. The installer rechecks ownership and policies before
continuing. A verified unchanged payload needs no second upload; a new package
payload applies pending migrations and uploads to the same resources. Interrupted
operations retain resources. Review a stale `.deploy.lock` and remove that exact
file only after confirming the original process stopped. Never delete D1/R2
to recover an installation. Uninstall and data deletion are deliberate manual
Cloudflare dashboard actions; this command has no destructive reset option.

The managed Wrangler configuration is checked for unexpected changes. Keep
optional mail values as secrets so upgrades preserve them with `keep_vars`:

```sh
npx wrangler secret put BREW_INBOUND_ADDRESS --config .brew-cloudflare/wrangler.json
npx wrangler secret put BREW_RESEND_API_KEY --config .brew-cloudflare/wrangler.json
npx wrangler secret put BREW_RESEND_FROM --config .brew-cloudflare/wrangler.json
```

For inbound mail, configure the chosen domain's Email Routing and a destination
that sends the exact inbound address to the deployed Worker name. DNS/MX and
Email Routing rules remain explicit owner setup. Do not replace an existing
domain's mail provider automatically. The runtime validates the configured
active address. For outbound mail, Resend requires a verified sender domain;
no message is sent during installation. See the [runtime and mail guide](cloudflare.md).

## Deploy button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Ftanzir71%2Fbrew%2Ftree%2Fmain)

The button uses the whole repository because shared packages are outside the
Cloudflare target directory. It uses the published `main` branch, which is now
the repository's default branch. The explicit `tree/main` URL pins the source
branch used for this deployment flow.

This source-template route uses Cloudflare's account sign-in and automatic
D1/R2 provisioning. Configure an owner self-hosted Access app for your hostname,
allow only your email, and create the five more-specific bypass apps listed
above. Set `BREW_PUBLIC_URL`, `BREW_ACCESS_TEAM_DOMAIN` and that owner app's
`BREW_ACCESS_AUD` in the button's variables. Do not use a Cloudflare API token as
a runtime binding. Accept root build `npm run build` and deploy `npm run deploy`;
use Node 22.12+. The deploy script validates these values, derives the custom
hostname route, migrates `DB` and deploys with the button-provisioned resource
names/IDs. Placeholders fail before migration/upload. The CLI automates Access
setup when you prefer to supply a scoped control-plane token yourself.

See Cloudflare's [deploy-button contract](https://developers.cloudflare.com/workers/platform/deploy-buttons/).
The public package and source are verified; runtime checks use native local
fixtures. No live Cloudflare account has been provisioned or deployment measured.
The [documented resource limits](cloudflare.md) still apply;
bounded polling does not establish Free CPU compliance for every library.
