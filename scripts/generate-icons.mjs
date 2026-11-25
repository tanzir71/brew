import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import process from 'node:process';
import { format } from 'prettier';
import { error, log } from 'node:console';

const manifest = JSON.parse(
  await readFile(new URL('../design/icons.json', import.meta.url), 'utf8'),
);
const symbols = [];
const viewBoxes = {};
for (const icon of manifest.icons) {
  if (!/^[a-z][a-z-]*$/.test(icon.name) || viewBoxes[icon.name])
    throw new Error('Invalid or duplicate icon name');
  const source = (
    await readFile(
      new URL(`../packages/web/public/figma/icons/${icon.name}.svg`, import.meta.url),
      'utf8',
    )
  ).replaceAll('\r\n', '\n');
  if (createHash('sha256').update(source).digest('hex') !== icon.sha256)
    throw new Error(`Source changed: ${icon.name}`);
  const match = source.trim().match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/);
  if (!match || /<(?:script|image|foreignObject)|\bon\w+=|(?:href|src)=/i.test(source))
    throw new Error(`Unsafe SVG: ${icon.name}`);
  if (!match[1].includes(`viewBox="${icon.viewBox}"`))
    throw new Error(`ViewBox changed: ${icon.name}`);
  const ids = new Map(
    [...match[2].matchAll(/\bid="([^"]+)"/g)].map((m, n) => [m[1], `brew-${icon.name}-${n}`]),
  );
  let body = match[2]
    .replace(/\bid="([^"]+)"/g, (_, id) => `id="${ids.get(id)}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${ids.get(id)})`);
  body = body.replace(/(fill|stroke)="#4E4842"/gi, '$1="currentColor"');
  if (/(?:fill|stroke)="#/i.test(body)) throw new Error(`Unexpected paint: ${icon.name}`);
  symbols.push(
    `<symbol id="brew-icon-${icon.name}" viewBox="${icon.viewBox}" fill="none">${body}</symbol>`,
  );
  viewBoxes[icon.name] = icon.viewBox;
}
const output = await format(
  `// Generated from Figma 5:2 exports. Run npm run icons:generate.
export const iconViewBoxes = ${JSON.stringify(viewBoxes)} as const;
export type IconName = keyof typeof iconViewBoxes;
export const iconSymbols = ${JSON.stringify(symbols.join('\n'))};`,
  { parser: 'typescript', singleQuote: true },
);
const destination = new URL('../packages/web/src/components/icons.generated.ts', import.meta.url);
if (process.argv.includes('--check')) {
  if ((await readFile(destination, 'utf8')).replaceAll('\r\n', '\n') !== output) {
    error('Generated icons are out of date. Run npm run icons:generate.');
    process.exitCode = 1;
  }
} else {
  await writeFile(destination, output);
  log(`Generated ${symbols.length} Figma icon symbols.`);
}
