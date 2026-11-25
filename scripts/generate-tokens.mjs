import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import { log, error } from 'node:console';
import { renderTokenCss } from './lib/token-css.mjs';
import { format } from 'prettier';

const source = new URL('../design/tokens.json', import.meta.url);
const destination = new URL('../packages/web/src/styles/tokens.css', import.meta.url);
const manifest = JSON.parse(await readFile(source, 'utf8'));
const css = await renderTokenCss(manifest);
const colorDestination = new URL(
  '../packages/core/src/output-colors.generated.ts',
  import.meta.url,
);
const colors = await format(
  `// Generated from design/tokens.json. Run npm run tokens:generate.\nexport const outputColors = ${JSON.stringify(manifest.colors)} as const;\n`,
  { parser: 'typescript', singleQuote: true },
);
if (process.argv.includes('--check')) {
  if ((await readFile(destination, 'utf8')).replaceAll('\r\n', '\n') !== css) {
    error('Generated tokens are out of date. Run npm run tokens:generate.');
    process.exitCode = 1;
  }
  if ((await readFile(colorDestination, 'utf8')).replaceAll('\r\n', '\n') !== colors) {
    error('Generated output colors are out of date. Run npm run tokens:generate.');
    process.exitCode = 1;
  }
} else {
  await writeFile(destination, css);
  await writeFile(colorDestination, colors);
  log('Generated light/dark colors, dimensions, elevations, typography and Tailwind aliases.');
}
