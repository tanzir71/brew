import { createRoot } from 'react-dom/client';
import tokens from '../../../design/tokens.json';
import '../src/styles.css';
import './type.css';

document.documentElement.dataset.resolvedTheme =
  new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';

// Literal utility names let Tailwind discover every style used by the fixture.
const classes = {
  'display-xl': 'type-display-xl',
  'display-l': 'type-display-l',
  'title-l': 'type-title-l',
  'title-m': 'type-title-m',
  'title-s': 'type-title-s',
  'reading-body': 'type-reading-body',
  'reading-lede': 'type-reading-lede',
  'ui-heading-l': 'type-ui-heading-l',
  'ui-heading': 'type-ui-heading',
  'ui-body': 'type-ui-body',
  'ui-body-s': 'type-ui-body-s',
  'ui-label': 'type-ui-label',
  'ui-label-s': 'type-ui-label-s',
  'ui-caption': 'type-ui-caption',
  'ui-overline': 'type-ui-overline',
  'mono-s': 'type-mono-s',
  'mono-xs': 'type-mono-xs',
};

export function TypeFoundations() {
  return (
    <>
      <main className="type-foundations" aria-label="Typography foundations">
        <h1 className="type-ui-heading">
          Type · Newsreader for reading, Instrument Sans for UI, Geist Mono for addresses and code.
          No italics.
        </h1>
        {Object.entries(tokens.typography).map(([key, style]) => (
          <div className="type-foundations-row" key={key}>
            <div className="type-foundations-label type-mono-xs">
              <p>{style.name}</p>
              <p>
                {tokens.fonts[style.family as keyof typeof tokens.fonts].family}{' '}
                {style.weight === 600 ? 'SemiBold' : style.weight === 500 ? 'Medium' : 'Regular'}{' '}
                {style.size}/{style.lineHeight}
              </p>
            </div>
            <p data-type-style={key} className={classes[key as keyof typeof classes]}>
              {style.family === 'mono'
                ? 'k7f3@in.tanziro.com'
                : ['display-xl', 'display-l', 'title-l'].includes(key)
                  ? 'Morning'
                  : 'The quiet structure behind interfaces'}
            </p>
          </div>
        ))}
      </main>
      <section aria-label="Extended Latin coverage" className="m-8 flex gap-4">
        <p className="font-sans">Žluťoučký kůň</p>
        <p className="font-serif">Žluťoučký kůň</p>
        <p className="font-mono">Žluťoučký kůň</p>
      </section>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<TypeFoundations />);
