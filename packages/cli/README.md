# Brew reader deployment

Deploy the private Brew reader to your own Cloudflare account with Node 22.12+:

```sh
npx brew-reader deploy cloudflare
```

The command asks for your account ID, unused HTTPS hostname and owner email.
Set `CLOUDFLARE_API_TOKEN` in your environment first. Your active DNS zone and
Zero Trust organization with a sign-in provider must already exist. R2 must be
enabled in the account. Brew creates owner Access policies, private D1/R2,
canonical migrations, web assets, Worker/WASM and minute cron configuration.
Only the owner email is allowed into the app. Reader clients and MCP use their
own generated credentials; published shares remain independent of owner login.

Preview without a token, writes or account requests:

```sh
npx brew-reader deploy cloudflare --dry-run --account-id ACCOUNT_ID --origin https://brew.your-domain.com --owner you@your-domain.com
```

Use the same `--dir` (default `.brew-cloudflare`) to resume after an interruption
or upgrade. Keep its private state and content-addressed releases. Brew refuses
unrelated DNS/resources and changed policies/configuration. It never deletes
resources during recovery. Tokens stay in the process environment and are not
saved or forwarded to the deployed Worker. Health and unauthenticated owner
denial are checked after upload; DNS/TLS propagation may require a later rerun.

Required scoped API-token permissions: account Workers Scripts Edit, D1 Edit,
R2 Storage Edit, Access Apps and Policies Edit, Access Organizations Read and
Identity Providers Read; zone Zone Read, DNS Read/Edit and Workers Routes Edit.

Optional inbound Email Routing and outbound Resend setup, permissions, recovery,
the deploy button and current runtime limits are documented in the
[installation guide](https://github.com/tanzir71/brew/blob/main/docs/cloudflare-install.md)
and [runtime guide](https://github.com/tanzir71/brew/blob/main/docs/cloudflare.md).

From a built source checkout use `npx --no-install brew-reader deploy cloudflare`,
or install the tarball produced by `npm pack --workspace brew-reader`. A fresh
public `npx brew-reader` requires an npm release; see the installation guide for
the current release status.
