import { format } from 'prettier';

const variable = (name) => `--brew-${name.replaceAll('/', '-').toLowerCase()}`;

export async function renderTokenCss(tokens) {
  const names = Object.keys(tokens.colors.light).sort();
  if (names.join() !== Object.keys(tokens.colors.dark).sort().join())
    throw new Error('Light and dark must define the same color tokens');
  for (const mode of ['light', 'dark']) {
    for (const value of Object.values(tokens.colors[mode]))
      if (!/^#[\da-f]{6}$/i.test(value)) throw new Error('Colors must be six-digit hex values');
  }
  const declarations = (entries) =>
    Object.entries(entries)
      .map(([name, value]) => `${variable(name)}: ${value};`)
      .join('\n');
  const aliases = {
    canvas: 'bg/canvas',
    surface: 'bg/surface',
    subtle: 'bg/subtle',
    sunken: 'bg/sunken',
    inverse: 'bg/inverse',
    'on-inverse': 'text/inverse',
    ink: 'text/primary',
    soft: 'text/soft',
    muted: 'text/caption',
    quiet: 'text/muted',
    line: 'border/default',
    'line-strong': 'border/strong',
    accent: 'accent/default',
    'accent-soft': 'accent/soft',
    'on-accent': 'accent/on',
    positive: 'status/positive',
    'positive-soft': 'status/positive-soft',
    warning: 'status/warning',
    'warning-soft': 'status/warning-soft',
    danger: 'status/danger',
    'danger-soft': 'status/danger-soft',
    scrim: 'bg/scrim',
  };
  for (const name of ['amber', 'sage', 'plum', 'sky'])
    aliases[`highlight-${name}`] = `highlight/${name}`;
  for (let n = 1; n <= 8; n++) aliases[`art-${n}`] = `art/${n}`;
  const theme = Object.entries(aliases).map(
    ([name, target]) => `--color-${name}: var(${variable(target)});`,
  );
  for (const name of ['sm', 'md', 'lg', 'xl', 'full'])
    theme.push(`--radius-${name}: var(--brew-radius-${name});`);
  theme.push(
    '--radius-2xl: var(--brew-radius-xl);',
    '--radius-3xl: var(--brew-radius-xl);',
    '--spacing: var(--brew-space-4);',
  );
  for (const name of ['raised', 'card', 'overlay'])
    theme.push(`--shadow-${name}: var(--brew-elevation-${name});`);

  return format(
    `/* Generated from design/tokens.json. Run npm run tokens:generate; do not edit.
     Figma Brew / Color Light 22:2246 / Color Dark 22:2377. */
    :root {
      ${declarations(tokens.colors.light)}
      ${declarations(tokens.dimensions)}
      ${declarations(tokens.effects)}
      /* Derived caption ink meets AA on the canvas; raw Figma text/muted stays intact. */
      --brew-text-caption: color-mix(in srgb, var(--brew-text-muted) 80%, var(--brew-text-primary));
      --brew-bg-scrim: ${tokens.colors.dark['bg/canvas']};
      color-scheme: light;
    }
    :root[data-resolved-theme='dark'] {
      ${declarations(tokens.colors.dark)}
      color-scheme: dark;
    }
    @theme inline {
      --color-*: initial;
      ${theme.join('\n')}
    }
  `,
    { parser: 'css', singleQuote: true },
  );
}
