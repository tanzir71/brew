/* global console, process */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';

const root = path.resolve('docs');
const required = [
  'index.html',
  'site.css',
  'site.js',
  'demo/index.html',
  'demo/demo.css',
  'demo/demo.js',
  'favicon.svg',
  'og.svg',
  'llms.txt',
];
const failures = [];
for (const relative of required) {
  try {
    const info = await stat(path.join(root, relative));
    if (!info.isFile() || info.size === 0) failures.push(`${relative} is empty`);
  } catch {
    failures.push(`${relative} is missing`);
  }
}
for (const relative of ['index.html', 'demo/index.html']) {
  const html = await readFile(path.join(root, relative), 'utf8');
  for (const token of ['<!doctype html>', '<title>', 'name="description"'])
    if (!html.toLowerCase().includes(token.toLowerCase()))
      failures.push(`${relative} lacks ${token}`);
  if (html.includes('�')) failures.push(`${relative} contains replacement characters`);
  for (const prefix of ['/', '/brew/'])
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(?:https?:|mailto:|data:|#)/.test(match[1])) continue;
      const page = new URL(
        relative === 'index.html' ? './' : 'demo/',
        `https://site.test${prefix}`,
      );
      const target = new URL(match[1], page);
      if (!target.pathname.startsWith(prefix)) {
        failures.push(`${relative} escapes project base ${prefix}: ${match[1]}`);
        continue;
      }
      let file = target.pathname.slice(prefix.length);
      if (!file || file.endsWith('/')) file += 'index.html';
      try {
        if (!(await stat(path.join(root, file))).isFile()) throw new Error('not a file');
      } catch {
        failures.push(`${relative} references missing ${target.pathname}`);
      }
    }
  if (html.includes('tanzir71/rss') || html.includes('Morning Brew'))
    failures.push(`${relative} has obsolete repository or Brew naming`);
}
try {
  await stat(path.join(root, '.nojekyll'));
} catch {
  failures.push('GitHub Pages needs docs/.nojekyll');
}
const home = await readFile(path.join(root, 'index.html'), 'utf8');
for (const phrase of ['one SQLite file', 'No account', 'computer running Brew', './demo/'])
  if (!home.includes(phrase)) failures.push(`homepage is missing honest-scope phrase: ${phrase}`);
const demo = await readFile(path.join(root, 'demo/index.html'), 'utf8');
for (const phrase of ['canned data', 'Morning', 'Rules', 'nothing is saved'])
  if (!demo.includes(phrase)) failures.push(`demo is missing disclosure or fixture: ${phrase}`);
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
console.log(
  `Website contract verified: ${required.length} artifacts, root/project paths, honest scope and demo fixture.`,
);
