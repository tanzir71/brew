import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { CloudflareApi } from './api.js';
import { DeployError, type Inputs, validateInputs } from './model.js';
import { loadState } from './files.js';
import { deployCloudflare } from './deploy.js';

export const help = `Brew reader deployment (Node 22.12+)

  brew-reader deploy cloudflare [options]

  --origin https://brew.example.com  Unused hostname in this Cloudflare account
  --owner owner@example.com         Only this email may enter the owner app
  --account-id ID                   Defaults to CLOUDFLARE_ACCOUNT_ID
  --team-domain team.cloudflareaccess.com  Optional; otherwise detected from Access
  --name brew-reader                Resource name prefix (a unique suffix is added)
  --dir .brew-cloudflare            Private, resumable deployment directory
  --dry-run                        Print the plan; no account or file changes

Set CLOUDFLARE_API_TOKEN for account Access Apps/Policies Edit, Workers Scripts Edit,
D1 Edit, R2 Storage Edit, and the hostname zone's DNS Read/Edit and Workers Routes Edit.
Also grant Access Organizations Read, Identity Providers Read, and Zone Read.
Create a Zero Trust organization and sign-in provider first. Existing unrelated DNS/resources are never replaced.
Rerun the same directory to resume. Optional email is configured after deployment.
`;
export function parseArgs(args: string[]) {
  if (args.includes('--help') || !args.length) return { help: true } as const;
  if (args[0] !== 'deploy' || args[1] !== 'cloudflare')
    throw new DeployError('Use brew-reader deploy cloudflare. Run --help for options.');
  const values: Record<string, string> = {};
  let dryRun = false;
  for (let index = 2; index < args.length; index++) {
    const flag = args[index]!;
    if (flag === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (
      !['--origin', '--owner', '--account-id', '--team-domain', '--name', '--dir'].includes(flag) ||
      values[flag] !== undefined ||
      !args[index + 1] ||
      args[index + 1]!.startsWith('--')
    )
      throw new DeployError('Invalid or repeated deployment option. Run --help.');
    values[flag] = args[++index]!;
  }
  return { help: false, values, dryRun } as const;
}
async function runWrangler(args: string[], directory: string, env: NodeJS.ProcessEnv) {
  const require = createRequire(import.meta.url),
    executable = path.join(
      path.dirname(require.resolve('wrangler/package.json')),
      'bin/wrangler.js',
    );
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    CLOUDFLARE_API_BASE_URL: 'https://api.cloudflare.com/client/v4',
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG: 'error',
    CI: '1',
  };
  for (const key of Object.keys(childEnv)) if (key.startsWith('BREW_')) delete childEnv[key];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...args], {
      cwd: directory,
      env: childEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Consume output without exposing provider errors, env values or secrets.
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    child.once('error', () =>
      reject(new DeployError('Could not start the packaged Wrangler. Reinstall brew-reader.')),
    );
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new DeployError(
              'Wrangler did not finish the deployment step. Resources are retained; rerun with the same directory.',
            ),
          ),
    );
  });
}
export async function runCli(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    process.stdout.write(help);
    return;
  }
  const directory = path.resolve(parsed.values['--dir'] ?? '.brew-cloudflare');
  const saved = await loadState(directory),
    values = parsed.values;
  const inputs: Inputs = {
    accountId: values['--account-id'] ?? saved?.inputs.accountId ?? env.CLOUDFLARE_ACCOUNT_ID ?? '',
    origin: values['--origin'] ?? saved?.inputs.origin ?? env.BREW_PUBLIC_URL ?? '',
    owner: values['--owner'] ?? saved?.inputs.owner ?? env.BREW_DEPLOY_OWNER_EMAIL ?? '',
    prefix: values['--name'] ?? saved?.inputs.prefix ?? 'brew-reader',
    teamDomain: values['--team-domain'] ?? saved?.inputs.teamDomain ?? env.BREW_ACCESS_TEAM_DOMAIN,
  };
  if (process.stdin.isTTY && (!inputs.accountId || !inputs.origin || !inputs.owner)) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!inputs.accountId) inputs.accountId = await prompt.question('Cloudflare account ID: ');
      if (!inputs.origin) inputs.origin = await prompt.question('Brew HTTPS origin: ');
      if (!inputs.owner) inputs.owner = await prompt.question('Owner email for Access: ');
    } finally {
      prompt.close();
    }
  }
  const options = {
    directory,
    payload: fileURLToPath(new URL('../payload/', import.meta.url)),
    inputs: validateInputs(inputs),
    dryRun: parsed.dryRun,
  };
  const result = await deployCloudflare(
    options,
    parsed.dryRun
      ? undefined
      : {
          api: new CloudflareApi(env.CLOUDFLARE_API_TOKEN ?? ''),
          run: (args, dir) =>
            runWrangler(args, dir, { ...env, CLOUDFLARE_ACCOUNT_ID: inputs.accountId }),
          log: (line) => process.stderr.write(line + '\n'),
        },
  );
  if (parsed.dryRun) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else
    process.stdout.write(
      `Brew is deployed at ${inputs.origin}\nSign in with the owner email. Optional mail setup: https://github.com/tanzir71/brew/blob/main/docs/cloudflare.md\n`,
    );
}
