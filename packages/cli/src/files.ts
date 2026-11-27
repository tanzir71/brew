import { createHash, randomUUID } from 'node:crypto';
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  lstat,
  open,
  unlink,
  copyFile,
  realpath,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';
import { DeployError, type DeployState, type PayloadManifest, validateInputs } from './model.js';
export const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
async function exists(file: string) {
  try {
    return await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
async function plain(file: string, directory = false) {
  const stat = await exists(file);
  if (stat && (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())))
    throw new DeployError('Deployment paths must be ordinary files and directories, not links.');
  return stat;
}
export async function payloadManifest(root: string): Promise<PayloadManifest> {
  const manifest = JSON.parse(
    await readFile(path.join(root, 'manifest.json'), 'utf8'),
  ) as PayloadManifest;
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length ||
    manifest.hash !== digest(JSON.stringify(manifest.files))
  )
    throw new DeployError('The deployment payload manifest is invalid. Reinstall the package.');
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (
      !/^(worker|assets|migrations)\/[a-z\d_./@-]+$/i.test(file.path) ||
      file.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      seen.has(file.path)
    )
      throw new DeployError('The payload contains an unsafe or repeated path.');
    seen.add(file.path);
    const full = path.join(root, ...file.path.split('/'));
    await plain(full);
    const bytes = await readFile(full);
    if (bytes.byteLength !== file.bytes || digest(bytes) !== file.sha256)
      throw new DeployError(
        'The deployment payload is incomplete or changed. Reinstall the package.',
      );
  }
  if (
    !seen.has('worker/worker.js') ||
    !manifest.files.some((file) => file.path.endsWith('-wasm')) ||
    !seen.has('assets/index.html') ||
    !manifest.files.some((file) => file.path.startsWith('migrations/'))
  )
    throw new DeployError('The package is missing a runtime, WASM, assets or migrations.');
  return manifest;
}
export async function loadState(directory: string): Promise<DeployState | null> {
  const directoryStat = await plain(directory, true);
  const file = path.join(directory, 'deploy.json');
  if (!(await plain(file))) {
    if (directoryStat && (await readdir(directory)).some((name) => name !== '.deploy.lock'))
      throw new DeployError('Use an empty directory or an existing Brew deployment directory.');
    return null;
  }
  const state = JSON.parse(await readFile(file, 'utf8')) as DeployState;
  if (
    state.version !== 1 ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(state.instance) ||
    !state.apps ||
    !state.intents ||
    state.worker !== `${state.inputs.prefix}-${state.instance.replaceAll('-', '').slice(0, 8)}` ||
    state.databaseName !== `${state.worker}-db` ||
    state.bucket !== `${state.worker}-images`
  )
    throw new DeployError('The deployment state is invalid. Do not reuse an unrelated directory.');
  state.inputs = validateInputs(state.inputs);
  return state;
}
export async function atomicWrite(file: string, value: unknown) {
  await plain(file);
  const temporary = file + `.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temporary, file);
}
export async function checkConfig(directory: string, state: DeployState, next?: unknown) {
  const file = path.join(directory, 'wrangler.json');
  if (!(await plain(file))) {
    if (state.configHash)
      throw new DeployError(
        'The managed Wrangler configuration is missing. Restore it before resuming.',
      );
    return;
  }
  const hash = digest(await readFile(file));
  if (
    hash !== state.configHash &&
    (next === undefined || hash !== digest(JSON.stringify(next, null, 2) + '\n'))
  )
    throw new DeployError(
      'The managed Wrangler configuration has changed. Review and restore it before resuming.',
    );
}
export async function lockDirectory(directory: string) {
  await plain(directory, true);
  await mkdir(directory, { recursive: true });
  await plain(directory, true);
  const resolved = await realpath(directory);
  if (path.resolve(resolved) !== path.resolve(directory))
    throw new DeployError('Use the real deployment directory, without directory links.');
  const lock = path.join(directory, '.deploy.lock');
  await plain(lock);
  const value = JSON.stringify({ pid: process.pid, token: randomUUID() });
  try {
    const handle = await open(lock, 'wx', 0o600);
    await handle.writeFile(value);
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new DeployError(
        'Another deployment owns this directory. If it stopped, remove its .deploy.lock file before resuming.',
      );
    throw error;
  }
  return async () => {
    if ((await readFile(lock, 'utf8')) === value) await unlink(lock);
  };
}
export async function stagePayload(root: string, directory: string, manifest: PayloadManifest) {
  const release = `releases/${manifest.hash}`;
  for (const file of manifest.files) {
    const destination = path.join(directory, release, ...file.path.split('/'));
    const parts = path.relative(directory, path.dirname(destination)).split(path.sep);
    let cursor = directory;
    for (const part of parts) {
      cursor = path.join(cursor, part);
      await plain(cursor, true);
      await mkdir(cursor, { recursive: true });
    }
    if (await plain(destination)) {
      if (digest(await readFile(destination)) !== file.sha256)
        throw new DeployError(
          'A staged payload has changed. Keep it for review and use a new deployment directory.',
        );
    } else await copyFile(path.join(root, ...file.path.split('/')), destination);
  }
  const ignore = path.join(directory, '.gitignore');
  if (!(await plain(ignore)))
    await writeFile(ignore, '*\n!.gitignore\n', { flag: 'wx', mode: 0o600 });
  const env = path.join(directory, 'empty.env');
  if (!(await plain(env))) await writeFile(env, '', { flag: 'wx', mode: 0o600 });
  if ((await readFile(env)).length) throw new DeployError('The managed empty.env must stay empty.');
  return release;
}
