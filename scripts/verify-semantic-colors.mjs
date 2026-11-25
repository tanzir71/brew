import { readdir, readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { error } from 'node:console';
import process from 'node:process';

const forbidden = /\b(?:stone|amber)-\d+/;
async function check(directory) {
  let failures = 0;
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(file.name + (file.isDirectory() ? '/' : ''), directory);
    if (file.isDirectory()) failures += await check(url);
    else if (/\.(css|tsx?|html)$/.test(file.name)) {
      const lines = (await readFile(url, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (forbidden.test(line)) {
          error(`${url.pathname}:${index + 1}: Use a semantic Brew color token.`);
          failures++;
        }
      });
    }
  }
  return failures;
}
if (await check(new URL('../packages/web/src/', import.meta.url))) process.exitCode = 1;
