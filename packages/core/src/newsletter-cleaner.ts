import { parseHTML } from 'linkedom';
import { sanitizeArticleHtml } from './html-sanitizer.js';
import type { NewsletterCleaning, NewsletterSelectors } from './types/newsletters.js';

const clickRedirect =
  /(?:list-manage\d*\.com\/track\/click|mandrillapp\.com\/track\/click|sendgrid\.net\/(?:ls|wf)\/click|(?:mailgun\.(?:org|net)|mailgun\.net)\/.*click|(?:clicks\.)?substack\.com\/redirect|(?:convertkit|kit-mail)\.com\/.*click|link\.mail\.beehiiv\.com\/ss\/c)/i;
const pixelUrl =
  /(?:\/track\/(?:open|pixel)|\/open\.gif|\/pixel\.(?:gif|png)|\/beacon(?:[/?]|$)|list-manage\d*\.com\/track\/open|sendgrid\.net\/wf\/open)/i;
const trackingParams = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref_src',
  'igshid',
  'mkt_tok',
  '_hsenc',
  '_hsmi',
  'vero_id',
  'vero_conv',
]);
const sponsorSelector =
  '.sponsor,.sponsored,.sponsor-block,.sponsored-content,.advertisement,.ad-slot,.paid-partner,[data-sponsored],[data-ad]';
const footerSelector =
  '.email-footer,.newsletter-footer,.unsubscribe,.manage-preferences,#email-footer';
const preheaderSelector = '.preheader,.preview-text,.previewText,.mcnPreviewText,[data-preheader]';
const mailChrome =
  /\b(?:unsubscribe|manage (?:your )?(?:preferences|subscription)|update (?:your )?(?:preferences|profile)|email preferences|opt out|view (?:this email )?in (?:your )?browser)\b/i;

const httpUrl = (value: string, base?: string): URL | null => {
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
};

/** Resolve only targets embedded in the message. Never follow a tracking redirect over the network. */
export function cleanNewsletterUrl(
  value: string,
  base?: string,
): { url: string | null; tracked: boolean } {
  let url = httpUrl(value, base);
  if (!url) return { url: null, tracked: false };
  let tracked = false;
  for (let depth = 0; depth < 3 && clickRedirect.test(`${url.hostname}${url.pathname}`); depth++) {
    tracked = true;
    const target: URL | undefined = [
      'url',
      'redirect',
      'redirect_url',
      'target',
      'destination',
      'link',
      'q',
      'u',
    ]
      .map((key) => httpUrl(url!.searchParams.get(key) ?? ''))
      .find((candidate): candidate is URL => candidate !== null);
    if (!target) return { url: null, tracked: true };
    url = target;
  }
  if (clickRedirect.test(`${url.hostname}${url.pathname}`)) return { url: null, tracked: true };
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || trackingParams.has(key.toLowerCase())) {
      tracked = true;
      url.searchParams.delete(key);
    }
  }
  return { url: url.toString(), tracked };
}

const textOf = (element: Element): string =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();
const dimension = (value: string | null): number | null =>
  value !== null && /^\s*\d+(?:\.\d+)?(?:px)?\s*$/i.test(value) ? Number.parseFloat(value) : null;
const styleValue = (element: Element, property: string): string | null =>
  element
    .getAttribute('style')
    ?.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;!]+)`, 'i'))?.[1]
    ?.trim() ?? null;
const invisible = (element: Element): boolean =>
  element.hasAttribute('hidden') ||
  styleValue(element, 'display') === 'none' ||
  styleValue(element, 'visibility') === 'hidden' ||
  styleValue(element, 'opacity') === '0';

function selectors(value: string[] | undefined): string[] {
  if (!value) return [];
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 256)
  )
    throw new Error(
      'Cleaning supports up to 20 CSS selectors of at most 256 characters per category.',
    );
  return value;
}

export interface CleanedNewsletter {
  html: string | null;
  archiveUrl: string | null;
  cleaning: NewsletterCleaning;
}

export function cleanNewsletterHtml(
  input: string,
  options: NewsletterSelectors & { archiveUrl?: string } = {},
): CleanedNewsletter {
  // Parse full messages as documents. A doctype inserted through body.innerHTML
  // leaves a DocumentType node in linkedom's fragment traversal.
  const document = parseHTML(
    /<html(?:\s|>)/i.test(input)
      ? input
      : `<!doctype html><html><body>${input.replace(/<!doctype[^>]*>/gi, '')}</body></html>`,
  ).document;
  const root = document.body;
  const cleaning: NewsletterCleaning = { trackers: 0, sponsorBlocks: 0, footerTrimmed: false };
  const explicitArchive = options.archiveUrl ? cleanNewsletterUrl(options.archiveUrl).url : null;
  const base = explicitArchive ?? undefined;
  let archiveUrl = explicitArchive;
  // Capture a publisher's direct archive link before removing email chrome.
  if (!archiveUrl)
    for (const anchor of root.querySelectorAll('a[href]')) {
      if (/^view (?:this email )?in (?:your )?browser$/i.test(textOf(anchor))) {
        archiveUrl = cleanNewsletterUrl(anchor.getAttribute('href')!).url;
        if (archiveUrl) break;
      }
    }
  const baseUrl = archiveUrl ?? base;
  const removeMatches = (selector: string, kind: 'sponsor' | 'footer' | 'preheader') => {
    let elements: Element[];
    try {
      elements = [...root.querySelectorAll(selector)];
    } catch {
      throw new Error(`Invalid newsletter cleaning selector: ${selector}`);
    }
    for (const element of elements) {
      if (!root.contains(element)) continue;
      element.remove();
      if (kind === 'sponsor') cleaning.sponsorBlocks++;
      if (kind === 'footer') cleaning.footerTrimmed = true;
    }
  };

  for (const image of root.querySelectorAll('img')) {
    const width = dimension(image.getAttribute('width')) ?? dimension(styleValue(image, 'width'));
    const height =
      dimension(image.getAttribute('height')) ?? dimension(styleValue(image, 'height'));
    if (
      invisible(image) ||
      (width !== null && width <= 1) ||
      (height !== null && height <= 1) ||
      (width !== null && height !== null && width <= 2 && height <= 2) ||
      pixelUrl.test(image.getAttribute('src') ?? '')
    ) {
      image.remove();
      cleaning.trackers++;
    }
  }
  removeMatches(preheaderSelector, 'preheader');
  for (const element of [...root.querySelectorAll('*')]) if (invisible(element)) element.remove();
  removeMatches(sponsorSelector, 'sponsor');
  for (const selector of selectors(options.sponsorSelectors)) removeMatches(selector, 'sponsor');
  // A leading disclosure in a small, distinct block is mail advertising. An editorial
  // mention of a sponsor, or a whole article with a disclosure, is kept.
  for (const block of root.querySelectorAll('aside,section,div,td,p')) {
    const text = textOf(block);
    if (
      root.contains(block) &&
      text.length <= 1000 &&
      !block.querySelector('article,main,h1,h2,h3') &&
      /^(?:sponsored by|a message from (?:our )?sponsor|paid (?:partnership|promotion)|advertisement)(?:\s|[:.])/i.test(
        text,
      )
    ) {
      block.remove();
      cleaning.sponsorBlocks++;
    }
  }
  removeMatches(footerSelector, 'footer');
  for (const selector of selectors(options.footerSelectors)) removeMatches(selector, 'footer');
  for (const footer of root.querySelectorAll('footer')) {
    if (mailChrome.test(textOf(footer))) {
      footer.remove();
      cleaning.footerTrimmed = true;
    }
  }
  for (const anchor of root.querySelectorAll('a[href]')) {
    if (!root.contains(anchor)) continue;
    const href = anchor.getAttribute('href')!;
    const label = textOf(anchor);
    if (
      /^unsubscribe$/i.test(anchor.getAttribute('rel') ?? '') ||
      (label.length < 100 && mailChrome.test(label)) ||
      /\/(?:unsubscribe|manage-preferences)(?:[/?#]|$)/i.test(href)
    ) {
      const block = anchor.closest('p,td,div,small');
      // Keep prose which merely discusses unsubscribing; trim only isolated chrome.
      if (
        block &&
        block !== root &&
        textOf(block).length < 500 &&
        !block.querySelector('article,main,h1,h2,h3,img') &&
        (textOf(block) === label ||
          /^(?:you (?:are receiving|received)|to unsubscribe|unsubscribe|©|copyright|view (?:this email )?in)/i.test(
            textOf(block),
          ))
      )
        block.remove();
      else anchor.replaceWith(...anchor.childNodes);
      cleaning.footerTrimmed = true;
      continue;
    }
    if (href.startsWith('#') || /^mailto:/i.test(href)) continue;
    const cleaned = cleanNewsletterUrl(href, baseUrl);
    if (cleaned.tracked) cleaning.trackers++;
    if (cleaned.url) anchor.setAttribute('href', cleaned.url);
    else anchor.removeAttribute('href');
  }
  for (const image of root.querySelectorAll('img')) {
    const cleaned = cleanNewsletterUrl(image.getAttribute('src') ?? '', baseUrl);
    if (cleaned.tracked) cleaning.trackers++;
    if (cleaned.url) image.setAttribute('src', cleaned.url);
    else image.remove();
  }
  return { html: sanitizeArticleHtml(root.innerHTML), archiveUrl, cleaning };
}

export const newsletterTextHtml = (text: string): string =>
  `<pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
