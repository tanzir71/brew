import { parseHTML } from 'linkedom';
import { outputColors } from './output-colors.generated.js';
import { escapeOutputHtml as escapeHtml } from './brew-output-content.js';
import type { BrewIssueDocument } from './types/outputs.js';

const { light, dark } = outputColors;
const bodyStyle = `font:15px/24px Arial,sans-serif;font-style:normal;color:${light['text/primary']};background-color:${light['bg/surface']}`;
const table = (content: string, width = '100%', style = '') =>
  `<table role="presentation" width="${width}" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;${style}">${content}</table>`;
const row = (content: string, style = '') =>
  `<tr><td class="brew-surface" style="${bodyStyle};${style}">${content}</td></tr>`;
const heading = (title: string, level: 1 | 2 | 3) =>
  `<h${level} style="margin:0 0 12px;font:${level === 1 ? '32px/38px' : level === 2 ? '24px/30px' : '20px/26px'} Georgia,serif;font-style:normal;color:${light['text/primary']}">${title}</h${level}>`;

/** Inline every publisher element too: email clients often discard head styles. */
function emailBody(html: string): string {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  for (const element of document.body.querySelectorAll('*')) {
    const tag = element.localName;
    const style = [`font-style:normal;color:${light['text/primary']}`];
    if (tag === 'a') style.push('text-decoration:underline;overflow-wrap:anywhere');
    if (/^h[1-6]$/.test(tag)) style.push('margin:20px 0 12px;font:20px/26px Georgia,serif');
    if (['p', 'blockquote', 'figure', 'ul', 'ol', 'pre'].includes(tag))
      style.push('margin:0 0 16px');
    if (['pre', 'code', 'kbd', 'samp'].includes(tag))
      style.push('font-family:monospace;white-space:pre-wrap;overflow-wrap:anywhere');
    if (tag === 'img') style.push('display:block;max-width:100%;height:auto;border:0');
    if (tag === 'table') {
      element.setAttribute('width', '100%');
      element.setAttribute('cellpadding', '0');
      element.setAttribute('cellspacing', '0');
      style.push('border-collapse:collapse;table-layout:fixed');
    }
    if (tag === 'td' || tag === 'th')
      style.push('padding:8px;vertical-align:top;overflow-wrap:anywhere');
    (element as HTMLElement).style.cssText = style.join(';');
    if (
      [
        'section',
        'article',
        'main',
        'aside',
        'header',
        'footer',
        'figure',
        'details',
        'summary',
      ].includes(tag)
    ) {
      const replacement = document.createElement('div');
      for (const attribute of element.attributes)
        replacement.setAttribute(attribute.name, attribute.value);
      replacement.append(...element.childNodes);
      element.replaceWith(replacement);
    }
  }
  return document.body.innerHTML;
}

export function emailDocument(issue: BrewIssueDocument, date: string): string {
  const sections = issue.sections
    .map((section) => {
      const title = heading(escapeHtml(section.title), 2);
      if (section.kind === 'divider')
        return row(title, `padding-top:28px;border-top:1px solid ${light['border/default']}`);
      if (section.kind === 'note')
        return row(title + emailBody(section.noteHtml ?? ''), 'padding-top:28px');
      const brief =
        section.depth === 'brief'
          ? '<p style="margin:0 0 16px;font-style:normal">Brief needs a configured AI provider. Source articles:</p>'
          : '';
      const stories = section.items
        .map((item) => {
          const title = item.url
            ? `<a href="${escapeHtml(item.url)}" style="color:${light['text/primary']};text-decoration:underline;font-style:normal">${escapeHtml(item.title)}</a>`
            : escapeHtml(item.title);
          const picture = item.imageUrl
            ? `<img alt="" src="${escapeHtml(item.imageUrl)}" width="528" border="0" style="display:block;width:100%;max-width:528px;height:auto;margin:0 0 16px">`
            : '';
          const content =
            section.depth === 'full' ? (item.contentHtml ?? item.summaryHtml) : item.summaryHtml;
          return row(
            `${picture}<p style="margin:0 0 6px;font:12px/18px Arial,sans-serif;font-style:normal;color:${light['text/soft']}">${escapeHtml(item.feedTitle)} · ${item.readTimeMinutes} min</p>${heading(title, 3)}${emailBody(content ?? '')}`,
            `padding:18px 0;border-bottom:1px solid ${light['border/default']};overflow-wrap:anywhere`,
          );
        })
        .join('');
      return row(
        title +
          brief +
          table(
            stories ||
              row('<p style="margin:0;font-style:normal">No matching stories for this issue.</p>'),
          ),
        'padding-top:28px',
      );
    })
    .join('');
  const content =
    row(
      `<p style="margin:0 0 12px;font:12px/18px Arial,sans-serif;font-style:normal;color:${light['text/soft']}">${escapeHtml(date)} · No. ${issue.issueNumber}</p>${heading(escapeHtml(issue.configName), 1)}`,
    ) + sections;
  const inner = table(
    row(table(content), 'padding:36px'),
    '600',
    `width:100%;max-width:600px;${bodyStyle}`,
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(issue.configName)}</title><style>:root{color-scheme:light dark;supported-color-schemes:light dark}*{font-style:normal!important}@media(prefers-color-scheme:dark){body,.brew-surface{background-color:${dark['bg/surface']}!important}body,td,th,p,a,h1,h2,h3,h4,h5,h6,div,span,li,blockquote,strong,b,em,i,pre,code{color:${dark['text/primary']}!important}td{border-color:${dark['border/default']}!important}}[data-ogsc] .brew-surface{background-color:${dark['bg/surface']}!important;color:${dark['text/primary']}!important}[data-ogsc] a{color:${dark['text/primary']}!important}</style></head><body class="brew-surface" style="margin:0;padding:0;${bodyStyle}">${table(`<tr><td align="center" class="brew-surface" style="${bodyStyle}"><!--[if mso]><table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0"><tr><td><![endif]-->${inner}<!--[if mso]></td></tr></table><![endif]--></td></tr>`, '100%', bodyStyle)}</body></html>`;
}
