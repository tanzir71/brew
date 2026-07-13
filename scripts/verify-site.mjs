/* global console, process */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('docs');
const required = ['index.html', 'site.css', 'site.js', 'demo/index.html', 'demo/demo.css', 'demo/demo.js', 'favicon.svg', 'og.svg', 'llms.txt'];
const failures = [];

for (const relative of required) {
  const file = path.join(root, relative);
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) failures.push(`${relative} is empty`);
  } catch { failures.push(`${relative} is missing`); }
}

for (const relative of ['index.html', 'demo/index.html']) {
  const html = await readFile(path.join(root, relative), 'utf8');
  for (const token of ['<!doctype html>', '<title>', 'name="description"', 'href="/favicon.svg"']) {
    if (!html.toLowerCase().includes(token.toLowerCase())) failures.push(`${relative} lacks ${token}`);
  }
  if (html.includes('�')) failures.push(`${relative} contains replacement characters`);
  for (const match of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
    const pathname = match[1].split(/[?#]/)[0];
    if (pathname === '/' || pathname === '/demo/') continue;
    const local = path.join(root, pathname.slice(1));
    try { await stat(local); } catch { failures.push(`${relative} references missing ${pathname}`); }
  }
}

const home = await readFile(path.join(root, 'index.html'), 'utf8');
for (const phrase of ['one SQLite file', 'No account', 'computer running Brew', '/demo/']) {
  if (!home.includes(phrase)) failures.push(`homepage is missing honest-scope phrase: ${phrase}`);
}
const demo = await readFile(path.join(root, 'demo/index.html'), 'utf8');
for (const phrase of ['canned data', 'Morning Brew', 'Rules', 'nothing is saved']) {
  if (!demo.includes(phrase)) failures.push(`demo is missing disclosure or fixture: ${phrase}`);
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
console.log(`Website contract verified: ${required.length} artifacts, honest scope, and /demo/ fixture.`);
