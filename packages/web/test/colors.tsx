import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import tokens from '../../../design/tokens.json';
import '../src/styles.css';
import './colors.css';

const order = [
  'bg/canvas',
  'bg/surface',
  'bg/subtle',
  'bg/sunken',
  'bg/inverse',
  'border/default',
  'border/strong',
  'text/primary',
  'text/soft',
  'text/muted',
  'text/inverse',
  'accent/default',
  'accent/soft',
  'accent/on',
  'status/positive',
  'status/positive-soft',
  'status/warning',
  'status/warning-soft',
  'status/danger',
  'status/danger-soft',
  'highlight/amber',
  'highlight/sage',
  'highlight/plum',
  'highlight/sky',
  'art/1',
  'art/2',
  'art/3',
  'art/4',
  'art/5',
  'art/6',
  'art/7',
  'art/8',
] as const;
const initialTheme =
  new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.resolvedTheme = initialTheme;

export function ColorFoundations() {
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const apply = (next: 'light' | 'dark') => {
    document.documentElement.dataset.resolvedTheme = next;
    setTheme(next);
  };
  return (
    <>
      <main className="color-foundations" aria-label={`Color ${theme}`}>
        <h1>Color · {theme === 'light' ? 'Light' : 'Dark'}</h1>
        <div className="color-foundations-grid">
          {order.map((name) => (
            <div className="color-foundations-item" key={name}>
              <div
                className="color-foundations-swatch"
                data-token={name}
                style={{ backgroundColor: `var(--brew-${name.replaceAll('/', '-')})` }}
              />
              <p>{name}</p>
              <code>{tokens.colors[theme][name].toUpperCase()}</code>
            </div>
          ))}
        </div>
      </main>
      <section
        className="m-8 flex items-center gap-4 text-soft"
        aria-label="Tailwind token samples"
      >
        <button
          type="button"
          onClick={() => apply(theme === 'light' ? 'dark' : 'light')}
          className="rounded-md bg-inverse px-4 py-2 text-on-inverse shadow-raised"
        >
          Switch theme
        </button>
        <span className="rounded-full bg-positive-soft px-3 py-1 text-positive">Positive</span>
        <span className="rounded-full bg-warning-soft px-3 py-1 text-warning">Warning</span>
        <span className="rounded-full bg-danger-soft px-3 py-1 text-danger">Danger</span>
      </section>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<ColorFoundations />);
