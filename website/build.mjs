import { build } from 'esbuild';
import { cp, copyFile, mkdir } from 'node:fs/promises';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { build as buildDemo } from 'vite';
import path from 'node:path';
const environment = { ...process.env, NODE_ENV: 'test' };
for (const name of Object.keys(environment))
  if (/^BREW_(?:SMTP|IMAP|INBOUND|MAILGUN|POSTMARK|RESEND|DB_PATH|PUBLIC_URL)/.test(name))
    delete environment[name];
const fixtures = spawnSync(process.execPath, ['--import', 'tsx', 'website/fixtures.ts'], {
  stdio: 'inherit',
  env: environment,
});
if (fixtures.status !== 0) throw new Error('Could not build isolated demo fixtures.');
await mkdir('data/website', { recursive: true });
await cp('packages/web/public/fonts', 'docs/fonts', { recursive: true });
await copyFile('packages/web/public/favicon.svg', 'docs/favicon.svg');
await build({
  entryPoints: ['website/render.tsx'],
  outfile: 'data/website/render.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  jsx: 'automatic',
});
await import('../data/website/render.mjs');
await buildDemo({ configFile: path.resolve('website/demo/vite.config.ts') });
