import { parseHTML } from 'linkedom';
import { sanitizeArticleHtml } from './html-sanitizer.js';

export const cleanOutputText = (value: string): string =>
  [...value]
    .filter((character) => {
      // XML 1.0 character ranges; preserve tabs/newlines and supplementary characters.
      const point = character.codePointAt(0)!;
      return (
        [9, 10, 13].includes(point) ||
        (point >= 0x20 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) ||
        point >= 0x10000
      );
    })
    .join('');

export const escapeOutputHtml = (value: string): string =>
  cleanOutputText(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

export function outputBaseUrl(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Output base URL must be an HTTP(S) URL without credentials.');
  return url.origin;
}

/** External formats cannot resolve instance-local links without an explicit origin. */
export function outputUrl(value: string, baseUrl?: string, local = true): string | null {
  try {
    const url = new URL(value, baseUrl ?? 'https://brew.invalid');
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password)
      return null;
    const relative = !/^[a-z][a-z\d+.-]*:/i.test(value.trim()) && !value.trim().startsWith('//');
    if (relative && !baseUrl) return local ? `${url.pathname}${url.search}${url.hash}` : null;
    return url.href;
  } catch {
    return null;
  }
}

export function outputImage(value: string, baseUrl?: string, local = true): string | null {
  const safe = outputUrl(value, baseUrl, local);
  if (!safe || safe.startsWith('mailto:')) return null;
  // Always use the instance proxy for remote publisher images, including // URLs.
  const parsed = new URL(safe, baseUrl ?? 'https://brew.invalid');
  const instance = baseUrl ?? 'https://brew.invalid';
  const path =
    parsed.origin === instance
      ? `${parsed.pathname}${parsed.search}`
      : `/api/img?src=${encodeURIComponent(parsed.href)}`;
  return outputUrl(path, baseUrl, local);
}

export function outputHtml(
  input: string | null | undefined,
  options: { images: boolean; baseUrl?: string; local: boolean },
): string {
  const html = sanitizeArticleHtml(cleanOutputText(input ?? ''), { images: options.images }) ?? '';
  const { document } = parseHTML(`<html><body><div id="output-root">${html}</div></body></html>`);
  const root = document.querySelector('#output-root')!;
  for (const link of root.querySelectorAll('a[href]')) {
    const href = outputUrl(link.getAttribute('href')!, options.baseUrl, options.local);
    if (href) link.setAttribute('href', href);
    else link.removeAttribute('href');
  }
  for (const image of root.querySelectorAll('img')) {
    const src = outputImage(image.getAttribute('src')!, options.baseUrl, options.local);
    if (src) image.setAttribute('src', src);
    else image.remove();
  }
  // Feed readers do not receive the web/email stylesheet. Reset semantic slants inline.
  for (const emphasis of root.querySelectorAll('em,i,cite,var'))
    emphasis.setAttribute('style', 'font-style:normal');
  return root.innerHTML;
}

export const escapeMarkdown = (value: string): string =>
  cleanOutputText(value)
    .replace(/\s+/g, ' ')
    .replace(/[\\`*_[\]<>#|~]/g, '\\$&');

/** Convert our sanitized article subset without leaking raw HTML or italic markup. */
export function outputBodyText(html: string, markdown: boolean): string {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const preformatted: string[] = [];
  const walk = (node: Node): string => {
    if (node.nodeType === 3) {
      const value = node.textContent ?? '';
      return markdown ? escapeMarkdown(value) : value.replace(/\s+/g, ' ');
    }
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    const content = () => [...element.childNodes].map(walk).join('');
    const tag = element.localName;
    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'img') {
      const alt = element.getAttribute('alt') ?? '';
      const src = element.getAttribute('src');
      return markdown && src ? `![${escapeMarkdown(alt)}](<${src}>)` : alt;
    }
    if (tag === 'a') {
      const label = content();
      const href = element.getAttribute('href');
      return href ? (markdown ? `[${label}](<${href}>)` : `${label} (${href})`) : label;
    }
    if (tag === 'pre' || tag === 'code') {
      const value = element.textContent ?? '';
      const fence = '`'.repeat(
        Math.max(3, ...[...value.matchAll(/`+/g)].map((match) => match[0].length + 1)),
      );
      const literal = markdown
        ? tag === 'pre'
          ? `${fence}\n${value.replace(/\n$/, '')}\n${fence}`
          : `${fence} ${value} ${fence}`
        : value;
      const token = `\u0000${preformatted.push(literal) - 1}\u0000`;
      return tag === 'pre' ? `\n\n${token}\n\n` : token;
    }
    if (tag === 'strong' || tag === 'b') return markdown ? `**${content()}**` : content();
    if (/^h[1-6]$/.test(tag))
      return `\n\n${markdown ? '#'.repeat(Math.min(6, Number(tag[1]) + 3)) + ' ' : ''}${content()}\n\n`;
    if (tag === 'blockquote')
      return `\n\n${content()
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n\n`;
    if (tag === 'ul' || tag === 'ol') {
      let index = Number(element.getAttribute('start')) || 1;
      return (
        '\n\n' +
        [...element.children]
          .map((child) => {
            const prefix = tag === 'ol' ? `${index++}. ` : '- ';
            return (
              prefix +
              [...child.childNodes]
                .map(walk)
                .join('')
                .trim()
                .replace(/\n/g, '\n' + ' '.repeat(prefix.length))
            );
          })
          .join('\n') +
        '\n\n'
      );
    }
    if (tag === 'table') {
      const rows = [...element.querySelectorAll('tr')].map((row) =>
        [...row.children].map((cell) =>
          [...cell.childNodes].map(walk).join('').trim().replace(/\n+/g, ' '),
        ),
      );
      if (!rows.length) return '';
      const lines = rows.map((cells) =>
        markdown ? `| ${cells.join(' | ')} |` : cells.join(' | '),
      );
      if (markdown) lines.splice(1, 0, `| ${rows[0]!.map(() => '---').join(' | ')} |`);
      return '\n\n' + lines.join('\n') + '\n\n';
    }
    if (['p', 'div', 'section', 'article', 'figure', 'table', 'dl', 'dt', 'dd'].includes(tag))
      return `\n\n${content()}\n\n`;
    return content();
  };
  return [...document.body.childNodes]
    .map(walk)
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .split('\u0000')
    .map((part, index) => (index % 2 ? preformatted[Number(part)]! : part))
    .join('');
}
