/* global console */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { URL } from 'node:url';
const root = path.resolve('docs');
const required = [
  'index.html',
  'site.css',
  'site.js',
  'demo/index.html',
  'browser/index.html',
  'browser/sw.js',
  'favicon.svg',
  'og.png',
  'llms.txt',
  'index.md',
  '.nojekyll',
];
for (const relative of required) {
  const info = await stat(path.join(root, relative));
  assert(info.isFile() && (relative === '.nojekyll' || info.size > 0), relative + ' is empty');
}
for (const relative of ['index.html', 'demo/index.html', 'browser/index.html']) {
  const html = await readFile(path.join(root, relative), 'utf8');
  for (const token of ['<!doctype html>', '<title>', 'name="description"'])
    assert(html.toLowerCase().includes(token), relative + ': ' + token);
  assert(!/�|tanzir71\/rss|Morning Brew|figma\.com\/api\/mcp\/asset/.test(html));
  for (const prefix of ['/', '/brew/']) {
    const page = new URL(relative === 'index.html' ? './' : path.posix.dirname(relative) + '/', 'https://site.test' + prefix);
    for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (/^(?:https?:|mailto:|data:|#)/.test(href)) continue;
      const target = new URL(href, page);
      assert(target.pathname.startsWith(prefix), href + ' escapes ' + prefix);
      let file = target.pathname.slice(prefix.length);
      if (!file || file.endsWith('/')) file += 'index.html';
      assert((await stat(path.join(root, file))).isFile(), relative + ': missing ' + file);
    }
  }
}
const manifest = JSON.parse(await readFile('website/assets.json', 'utf8'));
for (const asset of manifest.assets) {
  const bytes = await readFile(path.join(root, asset.file));
  assert(bytes.length > 0);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.file);
  const svg = bytes.toString('utf8').match(/<svg\b[^>]*>/)?.[0];
  assert(svg, asset.file + ' SVG root');
  for (const dimension of ['width', 'height'])
    assert(
      Math.abs(Number(svg.match(new RegExp(dimension + '="([\\d.]+)"'))?.[1]) - asset[dimension]) <
        0.001,
      asset.file + ' ' + dimension,
    );
}
const point = await readFile(path.join(root, 'figma/components/fb52b.svg'));
assert.equal(
  createHash('sha256').update(point).digest('hex'),
  manifest.assets.find((a) => a.export === 'fb52b.svg').sha256,
);
const demo = await readFile(path.join(root, 'demo/index.html'), 'utf8');
assert(demo.includes('canned data') && demo.includes('nothing is saved'));
const home = await readFile(path.join(root, 'index.html'), 'utf8');
const stylesheetVersion = createHash('sha256').update(await readFile(path.join(root, 'site.css'))).digest('hex').slice(0, 12);
assert(home.includes(`href="./site.css?v=${stylesheetVersion}"`), 'The landing must request its current stylesheet version.');
for (const phrase of ['on your own server or Cloudflare', 'in development', './demo/'])
  assert(home.includes(phrase), phrase);
console.log(
  'Website contract passed: ' +
    required.length +
    ' artifacts, root/project paths, ' +
    manifest.assets.length +
    ' exact Figma exports and shared wordmark point.',
);
