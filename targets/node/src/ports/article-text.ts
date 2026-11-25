import { parseHTML } from 'linkedom';
export const articleText = (html: string | null): string =>
  html
    ? (parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body.textContent ??
      '')
    : '';
