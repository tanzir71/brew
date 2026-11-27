import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'brew-cli-build-'));
const require = createRequire(import.meta.url);
const npm =
  process.env.npm_execpath ??
  path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' };
for (const key of Object.keys(env))
  if (key.startsWith('BREW_') || key.startsWith('CLOUDFLARE_') || key.startsWith('CF_'))
    delete env[key];
async function run(script, args, cwd = temporary) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve(out)
        : reject(
            new Error(
              `Local package verification failed (${code}): ${err.slice(-6000)} ${out.slice(-3000)}`,
            ),
          ),
    );
  });
}
await run(
  npm,
  ['pack', '--workspace', 'brew-reader', '--json', '--pack-destination', temporary],
  root,
);
const tarball = (await readdir(temporary)).find((name) => name.endsWith('.tgz'));
assert(tarball, 'npm pack must produce a tarball.');
await writeFile(
  path.join(temporary, 'package.json'),
  JSON.stringify({ name: 'brew-cli-isolated-verification', private: true, type: 'module' }),
);
await run(npm, [
  'install',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  path.join(temporary, tarball),
]);
const installed = path.join(temporary, 'node_modules/brew-reader');
const bin = path.join(installed, 'bin/brew-reader.mjs');
assert.match(await run(bin, ['--help']), /brew-reader deploy cloudflare/);
const args = [
  'deploy',
  'cloudflare',
  '--origin',
  'https://brew.example.net',
  '--owner',
  'owner@example.net',
  '--account-id',
  'a'.repeat(32),
  '--dir',
  path.join(temporary, 'dry-run'),
  '--dry-run',
];
const plan = JSON.parse(await run(bin, args));
assert.equal(plan.dryRun, true);
assert(!(await readdir(temporary)).includes('dry-run'), 'Dry runs must not create files.');
const { payloadManifest, stagePayload, atomicWrite } = await import(
  pathToFileURL(path.join(installed, 'dist/files.js'))
);
const { newState, workerConfig } = await import(
  pathToFileURL(path.join(installed, 'dist/model.js'))
);
const payload = path.join(installed, 'payload'),
  manifest = await payloadManifest(payload);
const state = newState({
  accountId: 'a'.repeat(32),
  origin: 'https://brew.example.net',
  owner: 'owner@example.net',
  prefix: 'brew-reader',
  teamDomain: 'brew-test.cloudflareaccess.com',
});
state.databaseId = '00000000-0000-0000-0000-000000000001';
state.apps.owner = {
  id: '00000000-0000-0000-0000-000000000002',
  domain: 'brew.example.net',
  aud: 'c'.repeat(64),
};
const directory = path.join(temporary, 'native');
const release = await stagePayload(payload, directory, manifest);
const config = workerConfig(state, release);
const configPath = path.join(directory, 'wrangler.json');
await atomicWrite(configPath, config);
const isolatedRequire = createRequire(pathToFileURL(path.join(installed, 'package.json')));
const wrangler = path.join(
  path.dirname(isolatedRequire.resolve('wrangler/package.json')),
  'bin/wrangler.js',
);
await run(
  wrangler,
  [
    'deploy',
    '--dry-run',
    '--config',
    configPath,
    '--env-file',
    path.join(directory, 'empty.env'),
    '--outdir',
    path.join(temporary, 'bundle'),
  ],
  temporary,
);
// Load the installed dependency and the installed product payload, outside repository cwd.
const { createTestHarness, unstable_splitSqlQuery } = await import(
  pathToFileURL(isolatedRequire.resolve('wrangler'))
);
// The local HTTP bridge overwrites Host with loopback while preserving URL. A
// test-only edge adapter restores the real edge Host before calling the unchanged
// packaged product. The original deployment config was validated above.
const edge = path.join(path.dirname(path.resolve(directory, config.main)), 'verification-edge.mjs');
await writeFile(
  edge,
  `import product from './worker.js';
export default {fetch(request,env,ctx){const headers=new Headers(request.headers);headers.set('host',new URL(request.url).host);return product.fetch(new Request(request,{headers}),env,ctx);}};`,
);
const nativePath = path.join(directory, 'verification.json');
await atomicWrite(nativePath, {
  ...config,
  no_bundle: false,
  main: path.relative(directory, edge),
});
const server = createTestHarness({ root: temporary, workers: [{ configPath: nativePath }] });
try {
  await server.listen();
  const handle = server.getWorker(),
    worker = await handle.getExport(),
    bindings = await handle.getEnv();
  const migrations = manifest.files.filter((file) => file.path.startsWith('migrations/'));
  assert.equal(migrations.length, 19);
  for (const migration of migrations) {
    const sql = await readFile(path.join(payload, migration.path), 'utf8');
    await bindings.DB.batch(
      unstable_splitSqlQuery(sql).map((statement) => bindings.DB.prepare(statement)),
    );
  }
  const health = await worker.fetch('https://brew.example.net/api/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  for (const route of ['/', '/api/capabilities', '/assets/owner.js']) {
    const response = await worker.fetch('https://brew.example.net' + route);
    assert.equal(response.status, 401, `Unauthenticated ${route} stays private.`);
    await response.body?.cancel();
  }
  const share = await worker.fetch('https://brew.example.net/share/example');
  assert.equal(share.status, 404);
  await share.body?.cancel();
  await bindings.IMAGES.put('verification', 'private image');
  assert.equal(await (await bindings.IMAGES.get('verification')).text(), 'private image');
} finally {
  await server.close();
}
// The button command must reject its unconfigured template before calling Wrangler.
const invalid = spawn(process.execPath, [path.join(root, 'scripts/deploy-cloudflare-button.mjs')], {
  cwd: temporary,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let message = '';
invalid.stdout.on('data', (chunk) => (message += chunk));
invalid.stderr.on('data', (chunk) => (message += chunk));
const code = await new Promise((resolve, reject) => {
  invalid.once('error', reject);
  invalid.once('exit', resolve);
});
assert.notEqual(code, 0);
assert.match(message, /Configure your HTTPS origin/);
assert(require.resolve('wrangler'), 'Repository build dependency remains available.');
process.stdout.write(
  `Packed CLI installed outside cwd; dry run, real Worker/WASM/assets, nineteen native D1 migrations, private R2 and owner denial pass. No account changes. Artifacts: ${temporary}\n`,
);
