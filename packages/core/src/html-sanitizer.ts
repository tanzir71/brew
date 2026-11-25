import createDOMPurify from 'dompurify';
import { parseHTML } from 'linkedom';

const trackingParameters = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'ref_src', 'igshid']);
const allowedTags = new Set(['a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var']);
const discardWithContent = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'template', 'svg', 'math', 'noscript']);
const globalAttributes = new Set(['title', 'lang', 'dir']);
const attributesByTag: Record<string, Set<string>> = {
  a: new Set(['href']), img: new Set(['src', 'alt', 'width', 'height']), td: new Set(['colspan', 'rowspan']), th: new Set(['colspan', 'rowspan', 'scope']), col: new Set(['span']), time: new Set(['datetime']), q: new Set(['cite']), blockquote: new Set(['cite']), ins: new Set(['cite', 'datetime']), del: new Set(['cite', 'datetime']),
};

const stripUrlTrackers = (value: string): string => {
  try {
    const relative = !/^[a-z][a-z\d+.-]*:/i.test(value);
    const url = new URL(value, 'https://brew.invalid');
    for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('utm_') || trackingParameters.has(key.toLowerCase())) url.searchParams.delete(key);
    return relative ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch { return value; }
};

const tinyDimension = (value: string | null): boolean => value !== null && Number.parseFloat(value) <= 1;
const safeUrl = (value: string, image: boolean): boolean => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true;
  try { const protocol = new URL(value).protocol; return image ? ['http:', 'https:'].includes(protocol) : ['http:', 'https:', 'mailto:'].includes(protocol); } catch { return false; }
};

export function sanitizeArticleHtml(input: string | null | undefined, options: { images?: boolean } = {}): string | null {
  if (!input) return null;
  const { window } = parseHTML('<!doctype html><html><body></body></html>');
  const purifier = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);
  const purified = purifier.sanitize(input, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'srcset'],
  });
  const document = parseHTML(`<!doctype html><html><body><div id="brew-sanitizer-root">${String(purified)}</div></body></html>`).document;
  const root = document.querySelector('#brew-sanitizer-root');
  if (!root) return null;
  for (const element of [...root.querySelectorAll('*')].reverse()) {
    const tag = element.localName.toLowerCase();
    if (discardWithContent.has(tag)) { element.remove(); continue; }
    if (!allowedTags.has(tag)) { element.replaceWith(...element.childNodes); continue; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (!globalAttributes.has(name) && !attributesByTag[tag]?.has(name)) element.removeAttribute(attribute.name);
    }
    if (tag === 'a') { const href = element.getAttribute('href'); if (href && !safeUrl(href, false)) element.removeAttribute('href'); }
    if (tag === 'img') { const src = element.getAttribute('src'); if (!src || !safeUrl(src, true)) element.remove(); }
  }
  for (const image of root.querySelectorAll('img')) {
    if (options.images === false || tinyDimension(image.getAttribute('width')) || tinyDimension(image.getAttribute('height'))) image.remove();
    else { const src=image.getAttribute('src'); if(src&&/^https?:/i.test(src))image.setAttribute('src',`/api/img?src=${encodeURIComponent(src)}`); image.removeAttribute('width'); image.removeAttribute('height'); image.removeAttribute('loading'); }
  }
  for (const anchor of root.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (href) anchor.setAttribute('href', stripUrlTrackers(href));
    anchor.setAttribute('rel', 'noopener noreferrer');
  }
  return root.innerHTML.trim() || null;
}

export function normalizedArticleUrl(value: string): string {
  try {
    const url = new URL(stripUrlTrackers(value));
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch { return value.trim(); }
}
