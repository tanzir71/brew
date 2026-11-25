import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import { log, error } from 'node:console';
import { renderTokenCss } from './lib/token-css.mjs';

const source = new URL('../design/tokens.json', import.meta.url);
const destination = new URL('../packages/web/src/styles/tokens.css', import.meta.url);
const css = await renderTokenCss(JSON.parse(await readFile(source, 'utf8')));
if (process.argv.includes('--check')) {
  if ((await readFile(destination, 'utf8')).replaceAll('\r\n', '\n') !== css) {
    error('Generated tokens are out of date. Run npm run tokens:generate.');
    process.exitCode = 1;
  }
} else {
  await writeFile(destination, css);
  log('Generated light/dark colors, dimensions, elevations and Tailwind aliases.');
}
