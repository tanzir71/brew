import path from 'node:path';
import { CloudflareApi } from './api.js';
import {
  DeployError,
  type DeployState,
  type Inputs,
  newState,
  deploymentPlan,
  workerConfig,
} from './model.js';
import {
  atomicWrite,
  checkConfig,
  digest,
  loadState,
  lockDirectory,
  payloadManifest,
  stagePayload,
} from './files.js';

export interface DeployOptions {
  directory: string;
  payload: string;
  inputs: Inputs;
  dryRun?: boolean;
}
export interface DeployPorts {
  api: CloudflareApi;
  run: (args: string[], directory: string) => Promise<void>;
  verify?: (origin: string) => Promise<void>;
  log?: (line: string) => void;
}
export async function verifyDeployment(origin: string, fetcher: typeof fetch = globalThis.fetch) {
  const read = async (path: string) =>
    fetcher(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
  const health = await read('/api/health');
  if (health.status !== 200 || !((await health.json()) as { ok?: boolean }).ok)
    throw new DeployError(
      'The Worker was uploaded but health is not ready. DNS or TLS may still be propagating; rerun the same command to verify.',
    );
  const owner = await read('/');
  await owner.body?.cancel();
  if (![301, 302, 303, 307, 308, 401, 403].includes(owner.status))
    throw new DeployError(
      'The owner boundary could not be verified. Review Access before using this instance.',
    );
}
export async function deployCloudflare(
  options: DeployOptions,
  ports?: DeployPorts,
): Promise<DeployState | ReturnType<typeof deploymentPlan>> {
  const manifest = await payloadManifest(options.payload);
  const saved = await loadState(options.directory);
  const state = saved ?? newState(options.inputs);
  if (
    saved &&
    (['accountId', 'origin', 'owner', 'prefix'].some(
      (key) => saved.inputs[key as keyof Inputs] !== options.inputs[key as keyof Inputs],
    ) ||
      (options.inputs.teamDomain &&
        saved.inputs.teamDomain &&
        options.inputs.teamDomain !== saved.inputs.teamDomain))
  )
    throw new DeployError(
      'This directory belongs to different deployment settings. Reuse its original settings or choose a new directory.',
    );
  if (options.dryRun) return deploymentPlan(state, manifest);
  if (!ports) throw new DeployError('Cloudflare credentials are required for deployment.');
  const unlock = await lockDirectory(options.directory),
    save = () => atomicWrite(path.join(options.directory, 'deploy.json'), state);
  try {
    const reread = await loadState(options.directory);
    if (reread && reread.instance !== state.instance)
      throw new DeployError('The deployment directory changed. Rerun to resume it.');
    // Accept our exact next config after a crash between writing it and saving its hash.
    const release = `releases/${manifest.hash}`;
    await checkConfig(options.directory, state, workerConfig(state, release));
    await save();
    ports.log?.('Checking the account, hostname and deployment ownership.');
    await ports.api.preflight(state);
    await save();
    ports.log?.('Preparing owner Access and credential-specific public paths.');
    await ports.api.access(state, save);
    ports.log?.('Preparing the private D1 database and R2 image bucket.');
    await ports.api.storage(state, save);
    await stagePayload(options.payload, options.directory, manifest);
    const config = workerConfig(state, release);
    await atomicWrite(path.join(options.directory, 'wrangler.json'), config);
    state.configHash = digest(JSON.stringify(config, null, 2) + '\n');
    await save();
    const flags = [
      '--config',
      path.join(options.directory, 'wrangler.json'),
      '--env-file',
      path.join(options.directory, 'empty.env'),
    ];
    if (state.payload !== manifest.hash || !state.deployed) {
      ports.log?.('Applying canonical D1 migrations.');
      await ports.run(
        ['d1', 'migrations', 'apply', 'DB', '--remote', '--yes', ...flags],
        options.directory,
      );
      // Verify policy ownership again immediately before the hostname is attached.
      await ports.api.access(state, save);
      state.workerIntent = true;
      delete state.deployed;
      delete state.verified;
      await save();
      ports.log?.('Uploading the Worker, assets, WASM and cron configuration.');
      await ports.run(['deploy', ...flags], options.directory);
      state.payload = manifest.hash;
      state.deployed = new Date().toISOString();
      await save();
    }
    ports.log?.('Checking health and the private owner boundary.');
    await (ports.verify ?? verifyDeployment)(state.inputs.origin);
    state.verified = new Date().toISOString();
    await save();
    return state;
  } finally {
    await unlock();
  }
}
