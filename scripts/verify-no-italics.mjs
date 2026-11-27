import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { error, log } from 'node:console';
import postcss from 'postcss';
import { checkCss, checkMarkup, checkScript } from './lib/no-italics.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const styles = new Map();
const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.wrangler', 'contracts', 'fixtures'].includes(entry.name))
        await collect(filename);
    } else if (
      /\.(?:[cm]?[jt]sx?|css|html|svg)$/.test(entry.name) &&
      !/\.(?:test|spec)\.[^.]+$/.test(entry.name)
    )
      files.push(filename);
  }
}
for (const directory of ['packages', 'targets', 'docs']) await collect(path.join(root, directory));
const sources = new Map(
  await Promise.all(files.map(async (filename) => [filename, await readFile(filename, 'utf8')])),
);
const problems = [];
const add = (filename, diagnostics) =>
  diagnostics.forEach((diagnostic) =>
    problems.push(`${path.relative(root, filename)}:${diagnostic.line}: ${diagnostic.message}`),
  );
for (const [filename, source] of sources)
  if (filename.endsWith('.css')) {
    const result = checkCss(source, filename);
    styles.set(filename, result.normalReset);
    add(filename, result.problems);
  }
async function hasReset(filename, seen = new Set()) {
  if (seen.has(filename)) return false;
  seen.add(filename);
  if (styles.get(filename)) return true;
  const css = sources.get(filename);
  if (css === undefined) return false;
  const imports = [];
  postcss.parse(css).walkAtRules('import', (rule) => {
    const match = rule.params.match(/^(?:url\(\s*)?['"]([^'"]+)['"]/);
    if (match?.[1].startsWith('.')) imports.push(path.resolve(path.dirname(filename), match[1]));
  });
  for (const imported of imports) if (await hasReset(imported, seen)) return true;
  return false;
}
const appReset = await hasReset(path.join(root, 'packages/web/src/styles.css'));
if (!appReset)
  problems.push(
    'packages/web/src/styles.css:1: Add an unconditional * { font-style: normal !important } reset.',
  );
for (const [filename, source] of sources) {
  if (filename.endsWith('.css')) continue;
  let reset = appReset;
  if (filename.startsWith(path.join(root, 'docs')) && filename.endsWith('.html')) {
    reset = false;
    for (const link of source.matchAll(
      /<link\b[^>]*rel=['"]stylesheet['"][^>]*href=['"]([^'"]+)['"][^>]*>/gi,
    )) {
      const cssPath = link[1].startsWith('/')
        ? path.join(root, 'docs', link[1].slice(1))
        : path.resolve(path.dirname(filename), link[1]);
      if (await hasReset(cssPath)) reset = true;
    }
    if (!reset)
      problems.push(`${path.relative(root, filename)}:1: Link the global normal-font reset.`);
  }
  add(
    filename,
    /\.(?:html|svg)$/.test(filename)
      ? checkMarkup(source, reset, filename)
      : checkScript(source, reset, filename),
  );
}
if (problems.length) {
  problems.forEach((problem) => error(problem));
  process.exitCode = 1;
} else log(`Normal typography verified across ${files.length} authored source files.`);
