import { parseHTML } from 'linkedom';
import { sanitizeArticleHtml } from './html-sanitizer.js';
export const originalNewsletterContentPolicy =
  "default-src 'none'; img-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

// Uncleaned mail content remains visible (including sponsors/footer), but never
// runs sender code or requests assets. Raw HTML itself remains stored untouched.
export function originalNewsletterDocument(raw: string): string {
  const document = parseHTML('<!doctype html><html><body></body></html>').document;
  document.body.innerHTML = sanitizeArticleHtml(raw, { images: false }) ?? '';
  for (const anchor of document.body.querySelectorAll('a')) anchor.removeAttribute('href');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${originalNewsletterContentPolicy}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Original newsletter</title><style>html{color-scheme:light;background:Canvas;color:CanvasText}body{max-width:900px;margin:24px auto;padding:0 20px;font:18px/1.65 Georgia,serif}*{font-style:normal!important;overflow-wrap:anywhere}table{max-width:100%}pre{white-space:pre-wrap}a{color:inherit}h1,h2,h3{line-height:1.2}</style></head><body>${document.body.innerHTML}</body></html>`;
}
