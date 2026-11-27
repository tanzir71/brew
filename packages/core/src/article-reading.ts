import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { sanitizeArticleHtml } from './html-sanitizer.js';

export function articleReadTime(html: string | null): number {
  const text = html
    ? (parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body.textContent ??
      '')
    : '';
  return Math.max(1, Math.ceil((text.trim() ? text.trim().split(/\s+/).length : 0) / 225));
}
/** Fetch is injected; extraction and sanitization are shared by every runtime. */
export async function extractReadableHtml(input: string, fetcher: typeof fetch) {
  const target = new URL(input);
  if (!['http:', 'https:'].includes(target.protocol))
    throw new Error('Article URL is not fetchable');
  const response = await fetcher(target, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Article returned HTTP ${response.status}`);
  const html = await response.text();
  if (html.length > 5_000_000) throw new Error('Article page is too large');
  const { document } = parseHTML(html);
  for (const element of document.querySelectorAll('a[href], img[src]')) {
    const attribute = element.localName === 'a' ? 'href' : 'src',
      value = element.getAttribute(attribute);
    if (value) {
      try {
        element.setAttribute(attribute, new URL(value, response.url || target).toString());
      } catch {
        element.removeAttribute(attribute);
      }
    }
  }
  const parsed = new Readability(document as unknown as Document).parse();
  if (!parsed?.content) throw new Error('Could not extract readable article content');
  const clean = sanitizeArticleHtml(parsed.content);
  if (!clean) throw new Error('Extracted article was empty');
  return clean;
}
