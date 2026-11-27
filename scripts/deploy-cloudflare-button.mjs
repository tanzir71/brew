import process from 'node:process';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { experimental_readRawConfig } from 'wrangler';
import { validateInputs } from '../packages/cli/dist/model.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const original = path.join(root, 'wrangler.jsonc');
const { rawConfig: config } = experimental_readRawConfig({ config: original });
const vars = { ...config.vars };
for (const key of ['BREW_PUBLIC_URL', 'BREW_ACCESS_TEAM_DOMAIN', 'BREW_ACCESS_AUD'])
  if (process.env[key]) vars[key] = process.env[key];
try {
  const validated = validateInputs({
    accountId: '0'.repeat(32),
    origin: vars.BREW_PUBLIC_URL,
    owner: 'validation@example.com',
    prefix: 'brew-reader',
    teamDomain: vars.BREW_ACCESS_TEAM_DOMAIN?.replace(/^https:\/\//, ''),
  });
  vars.BREW_ACCESS_TEAM_DOMAIN = `https://${validated.teamDomain}`;
  if (
    vars.BREW_PUBLIC_URL === 'https://brew.example.com' ||
    vars.BREW_ACCESS_TEAM_DOMAIN === 'https://your-team.cloudflareaccess.com' ||
    !/^[a-f\d]{64}$/i.test(vars.BREW_ACCESS_AUD)
  )
    throw new Error('Placeholders');
} catch {
  throw new Error(
    'Configure your HTTPS origin, exact Access team domain and owner application audience first. See docs/cloudflare-install.md. No deployment has been attempted.',
  );
}
// Keep relative paths at the root and preserve the resource IDs provisioned by the button.
const template = { ...config };
template.vars = vars;
template.routes = [{ pattern: new URL(vars.BREW_PUBLIC_URL).hostname, custom_domain: true }];
const temporary = path.join(root, `.brew-button-${randomUUID()}.json`);
await writeFile(temporary, JSON.stringify(template, null, 2), { flag: 'wx', mode: 0o600 });
const wrangler = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
try {
  for (const args of [['d1', 'migrations', 'apply', 'DB', '--remote', '--yes'], ['deploy']]) {
    const result = spawnSync(process.execPath, [wrangler, ...args, '--config', temporary], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        'Cloudflare deployment stopped; resources and migration history are retained.',
      );
  }
} finally {
  await unlink(temporary);
}
