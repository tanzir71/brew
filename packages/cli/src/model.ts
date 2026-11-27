import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

export class DeployError extends Error {}
export interface Inputs {
  accountId: string;
  origin: string;
  owner: string;
  prefix: string;
  teamDomain?: string;
}
export interface AccessResource {
  id: string;
  aud: string;
  domain: string;
}
export interface DeployState {
  version: 1;
  instance: string;
  inputs: Inputs;
  worker: string;
  databaseName: string;
  bucket: string;
  databaseId?: string;
  apps: Record<string, AccessResource>;
  intents: Record<string, boolean>;
  workerIntent?: boolean;
  payload?: string;
  deployed?: string;
  verified?: string;
  configHash?: string;
}
export interface PayloadManifest {
  version: 1;
  hash: string;
  files: { path: string; bytes: number; sha256: string }[];
}
export const bypassPaths = [
  '/api/health',
  '/api/greader/*',
  '/api/fever',
  '/mcp',
  '/share/*',
] as const;
export function validateInputs(input: Inputs): Inputs {
  let url: URL;
  try {
    url = new URL(input.origin);
  } catch {
    throw new DeployError('Choose a valid HTTPS origin.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)+$/i.test(
      url.hostname,
    ) ||
    isIP(url.hostname) !== 0 ||
    url.hostname.length > 253 ||
    url.hostname.endsWith('.workers.dev')
  )
    throw new DeployError(
      'Use an HTTPS custom hostname in your Cloudflare account, without a path or port.',
    );
  if (!/^[a-f\d]{32}$/i.test(input.accountId))
    throw new DeployError('Supply a valid Cloudflare account ID.');
  if (!/^[a-z\d][a-z\d-]{0,39}$/.test(input.prefix))
    throw new DeployError('The name prefix must be 1–40 lowercase letters, digits or hyphens.');
  if (
    input.owner.length > 254 ||
    !/^[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,}$/i.test(input.owner)
  )
    throw new DeployError('Supply one bare owner email address.');
  if (
    input.teamDomain &&
    !/^[a-z\d](?:[a-z\d-]*[a-z\d])?\.cloudflareaccess\.com$/i.test(input.teamDomain)
  )
    throw new DeployError('Use your exact team.cloudflareaccess.com domain.');
  return { ...input, origin: url.origin, teamDomain: input.teamDomain?.toLowerCase() };
}
export function newState(input: Inputs, instance = randomUUID()): DeployState {
  const inputs = validateInputs(input),
    worker = `${inputs.prefix}-${instance.replaceAll('-', '').slice(0, 8)}`;
  return {
    version: 1,
    instance,
    inputs,
    worker,
    databaseName: `${worker}-db`,
    bucket: `${worker}-images`,
    apps: {},
    intents: {},
  };
}
export function accessDefinitions(state: DeployState) {
  const host = new URL(state.inputs.origin).hostname;
  return [
    { key: 'owner', domain: host },
    ...bypassPaths.map((path, index) => ({ key: `path-${index}`, domain: host + path })),
  ].map((item) => ({
    ...item,
    name: `Brew ${state.worker} ${item.key}`,
    policy: {
      name: `Brew ${item.key}`,
      decision: item.key === 'owner' ? 'allow' : 'bypass',
      include:
        item.key === 'owner' ? [{ email: { email: state.inputs.owner } }] : [{ everyone: {} }],
      exclude: [],
      require: [],
      precedence: 1,
    },
  }));
}
export function workerConfig(state: DeployState, release: string) {
  return {
    name: state.worker,
    account_id: state.inputs.accountId,
    main: `${release}/worker/worker.js`,
    no_bundle: true,
    compatibility_date: '2026-07-01',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: false,
    preview_urls: false,
    send_metrics: false,
    keep_vars: true,
    observability: { enabled: false },
    routes: [{ pattern: new URL(state.inputs.origin).hostname, custom_domain: true }],
    assets: {
      directory: `${release}/assets`,
      binding: 'ASSETS',
      run_worker_first: true,
      not_found_handling: 'single-page-application',
    },
    rules: [{ type: 'CompiledWasm', globs: ['**/*-wasm', '**/*.wasm'], fallthrough: true }],
    d1_databases: [
      {
        binding: 'DB',
        database_name: state.databaseName,
        database_id: state.databaseId ?? '00000000-0000-0000-0000-000000000000',
        migrations_dir: `${release}/migrations`,
      },
    ],
    r2_buckets: [{ binding: 'IMAGES', bucket_name: state.bucket }],
    triggers: { crons: ['* * * * *'] },
    vars: {
      BREW_PUBLIC_URL: state.inputs.origin,
      BREW_ACCESS_TEAM_DOMAIN: `https://${state.inputs.teamDomain ?? 'SET_YOUR_TEAM.cloudflareaccess.com'}`,
      BREW_ACCESS_AUD: state.apps.owner?.aud ?? 'SET_AFTER_ACCESS_CREATION',
      BREW_MAX_FETCHES_PER_RUN: '40',
      BREW_WEBMCP: '0',
    },
  };
}
export function deploymentPlan(state: DeployState, manifest: PayloadManifest) {
  return {
    dryRun: true,
    worker: state.worker,
    origin: state.inputs.origin,
    accountId: state.inputs.accountId,
    creates: {
      database: state.databaseName,
      privateBucket: state.bucket,
      access: accessDefinitions(state),
    },
    config: workerConfig(state, `releases/${manifest.hash}`),
    commands: [['d1', 'migrations', 'apply', 'DB', '--remote', '--yes'], ['deploy']],
    notes: [
      'No account changes or credentials are written by this dry run.',
      'Existing unrelated resources and DNS records are never adopted.',
      'Optional mail setup follows deployment; no mail is sent by the installer.',
    ],
  };
}
