import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { renderTokenCss } from '../../scripts/lib/token-css.mjs';

const source = JSON.parse(
  await readFile(new URL('../../design/tokens.json', import.meta.url), 'utf8'),
);
it('keeps generated CSS reproducible and retains the Figma anchor colors', async () => {
  const generated = await renderTokenCss(source);
  expect(
    (await readFile(new URL('./src/styles/tokens.css', import.meta.url), 'utf8')).replaceAll(
      '\r\n',
      '\n',
    ),
  ).toBe(generated);
  expect(source.colors.light['bg/canvas']).toBe('#f7f5f1');
  expect(source.colors.dark['bg/canvas']).toBe('#121110');
  expect(source.colors.light['accent/default']).toBe('#a0471d');
  expect(source.colors.dark['accent/default']).toBe('#e1915f');
  expect(Object.keys(source.colors.light)).toHaveLength(32);
});
it('rejects a partial theme instead of silently leaving colors from the other mode', async () => {
  const partial = structuredClone(source);
  delete partial.colors.dark['bg/surface'];
  await expect(renderTokenCss(partial)).rejects.toThrow(
    'Light and dark must define the same color tokens',
  );
});
