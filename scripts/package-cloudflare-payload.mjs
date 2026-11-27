import { readdir, readFile, writeFile, mkdir, copyFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import process from 'node:process';

const root = fileURLToPath(new URL('../', import.meta.url));
const payload = path.join(root, 'packages/cli/payload');
// This is generated output at one fixed workspace path, never an argument or env value.
assert.equal(path.resolve(payload), path.resolve(root, 'packages', 'cli', 'payload'));
const stat = await lstat(payload).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
assert(!stat?.isSymbolicLink(), 'Refuse to replace a linked payload directory.');
await rm(payload, { recursive: true, force: true });
const files = [];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function copy(source, relative) {
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const input = path.join(source, entry.name),
      output = relative + '/' + entry.name;
    assert(!entry.isSymbolicLink(), 'Build inputs cannot be links.');
    if (entry.isDirectory()) await copy(input, output);
    else {
      if (relative === 'worker' && !/^(worker\.js|[a-f\d]+-wasm)$/.test(entry.name)) continue;
      if (relative === 'migrations' && !entry.name.endsWith('.sql')) continue;
      const bytes = await readFile(input);
      await mkdir(path.dirname(path.join(payload, output)), { recursive: true });
      await copyFile(input, path.join(payload, output));
      files.push({ path: output, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
await copy(path.join(root, 'dist/cloudflare-worker'), 'worker');
await copy(path.join(root, 'packages/web/dist'), 'assets');
await copy(path.join(root, 'packages/db/migrations'), 'migrations');
files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
assert.equal(
  files.filter((file) => file.path.startsWith('migrations/')).length,
  19,
  'All canonical migrations are packaged.',
);
await writeFile(
  path.join(payload, 'manifest.json'),
  JSON.stringify({ version: 1, hash: hash(JSON.stringify(files)), files }, null, 2) + '\n',
);
process.stdout.write(
  `Packaged ${files.length} Cloudflare runtime, WASM, web and migration files.\n`,
);
