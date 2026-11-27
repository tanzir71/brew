import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../dist/cloudflare-worker/', import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
    'deploy',
    '--dry-run',
    '--config',
    fileURLToPath(new URL('../targets/cloudflare/wrangler.example.jsonc', import.meta.url)),
    '--outdir',
    output,
  ],
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const files = await readdir(output);
assert(
  files.some((file) => file.endsWith('.js')),
  'The product Worker bundle is missing.',
);
const artifacts = await Promise.all(
  files.map(async (file) => ({
    file,
    bytes: await readFile(new URL(file, new URL('../dist/cloudflare-worker/', import.meta.url))),
  })),
);
assert(
  artifacts.some(
    ({ bytes }) => bytes[0] === 0 && bytes[1] === 97 && bytes[2] === 115 && bytes[3] === 109,
  ),
  'The interruptible WASM module is missing from the Worker artifact.',
);
process.stdout.write(
  'Built product Cloudflare Worker and native WASM artifact locally; no deployment performed.\n',
);
