import { Children, createElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compile, optimize } from '@tailwindcss/node';
import Nav from './sections/Nav';
import Hero from './sections/Hero';
import ThreeWays from './sections/SectionThreeWaysToRead';
import Compose from './sections/SectionCompose';
import Newsletters from './sections/SectionNewsletters';
import Modes from './sections/SectionRunItAnywhere';
import Rules from './sections/SectionRules';
import Agents from './sections/SectionForAgents';
import Compare from './sections/SectionCompare';
import BuiltOpen from './sections/SectionBuiltOpen';
import Faq from './sections/SectionFaq';
import Start from './sections/SectionStart';
import Footer from './sections/Footer';

const source = JSON.parse(await readFile('website/assets.json', 'utf8')) as {
  assets: { file: string; width: number; height: number }[];
};
const dimensions = new Map(source.assets.map((asset) => ['./' + asset.file, asset]));
const github = 'https://github.com/tanzir71/brew';
const setup = github + '#run-locally';
const sections = [
  [Nav, 'navigation'],
  [Hero, 'hero'],
  [ThreeWays, 'reading'],
  [Compose, 'compose'],
  [Newsletters, 'newsletters'],
  [Modes, 'run'],
  [Rules, 'rules'],
  [Agents, 'agents'],
  [Compare, 'compare'],
  [BuiltOpen, 'open'],
  [Faq, 'faq'],
  [Start, 'start'],
  [Footer, 'footer'],
] as const;
const links: Record<string, string> = {
  Reading: '#reading',
  Newsletters: '#newsletters',
  'Run it anywhere': '#run',
  'For agents': '#agents',
  Compare: '#compare',
  GitHub: github,
  'Live demo': './demo/',
  Compose: '#compose',
  'llms.txt': './llms.txt',
  Privacy: '#privacy',
  Changelog: github + '/commits/main/',
  'In your browser': '#run',
  'Your server': setup,
  Cloudflare: github + '/blob/main/docs/cloudflare-install.md',
  'Shared hosting': '#run',
  'GitHub Pages': '#run',
};
const headings = new Set([
  '18:313',
  '19:287',
  '19:900',
  '19:924',
  '19:1146',
  '21:435',
  '21:471',
  '21:586',
  '21:601',
]);
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : '';
}

/** Add semantic navigation to the static design; illustration stages stay inert. */
function pageNode(
  node: ReactNode,
  section: string,
  illustration = false,
  parentName = '',
): ReactNode {
  if (Array.isArray(node))
    return Children.toArray(
      node.map((child) => pageNode(child, section, illustration, parentName)),
    );
  if (!isValidElement<Record<string, unknown> & { children?: ReactNode }>(node)) return node;
  if (typeof node.type === 'function') {
    const component = node.type as (props: Record<string, unknown>) => ReactElement;
    const rendered = pageNode(component(node.props), section, illustration, parentName);
    return component.name === 'Wordmark' && (section === 'navigation' || section === 'footer')
      ? createElement('a', { href: './', 'aria-label': 'Brew home' }, rendered)
      : rendered;
  }
  let tag = node.type;
  const props = { ...node.props };
  if (typeof props['data-figma-asset'] === 'string')
    props['data-figma-asset'] = props['data-figma-asset'].replace(/^\/figma\//, './figma/');
  const id = String(props['data-node-id'] ?? '');
  const name = String(props['data-name'] ?? '');
  const label = textOf(props.children).trim();
  if (section === 'compare') {
    if (name === 'Comparison table') {
      props.role = 'table';
      props['aria-label'] = 'Reader feature comparison';
    }
    if (name === 'Header' || name.startsWith('Row ·')) props.role = 'row';
    if (parentName === 'Header') props.role = 'columnheader';
    if (parentName.startsWith('Row ·'))
      props.role = String(props.className).includes('w-[260px]') ? 'rowheader' : 'cell';
  }
  if (typeof props.id === 'string' && props.id.startsWith('node-')) {
    props['data-node-id'] = props.id.slice(5).replaceAll('_', ':');
    delete props.id;
  }
  const isIllustration = illustration || name === 'Stage' || name === 'Vignette' || id === '18:43';
  if (isIllustration && !illustration) props['aria-hidden'] = true;
  if (tag === 'img') {
    const asset = dimensions.get(String(props.src));
    if (asset) {
      props.width = asset.width;
      props.height = asset.height;
      props.style = {
        ...(props.style as Record<string, unknown> | undefined),
        width: asset.width,
        height: asset.height,
      };
      props.decoding = 'async';
    }
    props.draggable = false;
  }
  if (typeof props.style === 'object' && props.style) {
    props.style = Object.fromEntries(
      Object.entries(props.style).map(([key, value]) => [
        key,
        typeof value === 'string' ? value.replace(/(url\(["']?)\/figma\//g, '$1./figma/') : value,
      ]),
    );
    // The font's default wdth axis is 100; do not repeat it on every text node.
    delete (props.style as Record<string, unknown>).fontVariationSettings;
    const style = props.style as Record<string, unknown>;
    if (typeof style.maskImage === 'string') style.maskImage = style.maskImage.replaceAll('"', '');
    if (!Object.keys(style).length) delete props.style;
  }
  if (!isIllustration) {
    if (id === '18:26') tag = 'h1';
    if (headings.has(id)) tag = 'h2';
    const isNav = section === 'navigation' || section === 'footer';
    if ((isNav && links[label] && tag === 'p') || name.startsWith('Button/')) {
      tag = 'a';
      props.href =
        links[label] ??
        (/demo/i.test(label)
          ? './demo/'
          : /Choose where/.test(label)
            ? '#run'
            : /Cloudflare/.test(label)
              ? links.Cloudflare
              : /install|server|node/i.test(label)
                ? setup
                : '#run');
      props.className = String(props.className ?? '') + ' site-link';
    }
    if (name === 'Button/Copy command') {
      tag = 'button';
      delete props.href;
      props.type = 'button';
      props['data-copy'] =
        'git clone https://github.com/tanzir71/brew.git && cd brew && npm ci && npm run build && npm start';
    }
    const vendor = {
      'Feedly Pro+': 'https://feedly.com/i/pro',
      'Inoreader Pro': 'https://www.inoreader.com/pricing',
      Mailbrew: 'https://app.mailbrew.com/upgrade',
    }[label];
    if (section === 'compare' && vendor && tag === 'p') {
      tag = 'a';
      props.href = vendor;
      props.className = String(props.className) + ' site-link';
    }
  }
  let children = props.children;
  if (id === '18:26')
    children = [
      createElement(
        'span',
        { key: 'feeds', className: 'block leading-[80px]' },
        'Your feeds and newsletters, ',
      ),
      createElement(
        'span',
        { key: 'paper', className: 'block leading-[80px]' },
        'made into one calm daily paper.',
      ),
    ];
  // The design includes future runtimes. Keep the visual cards and state release status.
  if (id === '18:28')
    children =
      'Brew is an open-source reader that runs where you choose. Start on your own server or Cloudflare, with browser and published editions on the way. One file you own, and nobody watching.';
  if (id === '19:926')
    children =
      'Run on your own server or Cloudflare for background fetching and inbound mail. Browser, shared hosting and published editions are in development. Your data stays yours.';
  if (id === '21:603') children = 'Open the demo, or run your own Brew. No sign-up.';
  if (tag === 'p' && label === 'npx brew-reader') children = 'git clone …/brew';
  if (id === '19:958') children = 'In development';
  if (id === '19:959') {
    props['aria-disabled'] = true;
    props.href = '#run';
  }
  if (tag === 'p' && label === 'Start here') children = 'Coming soon';
  if (name.startsWith('Button/') && (label === 'Download Lite' || label === 'Use template')) {
    props['aria-disabled'] = true;
    props.href = '#run';
  }
  if (tag === 'p' && (label === 'Rules run in your browser' || label === 'Good for a reading list'))
    children = 'In development';
  if (tag === 'p' && label === 'Five ways') children = 'Node + Cloudflare';
  if (tag === 'p' && label === '$89.99/yr') children = '$90/yr';
  if (tag === 'p' && label === '$99 first year, then $144/yr')
    children = ['$144/yr', createElement('br', { key: 'price' }), 'First-year offers'];
  if (tag === 'p' && label === 'Title, excerpt, full text or a short brief')
    children = 'Title, excerpt or full text; briefs coming soon';
  if (tag === 'p' && label === 'Briefs cite every letter they draw from')
    children = 'Cited briefs are in development';
  if (tag === 'p' && label === 'OPML, Markdown, JSON or a single .brew file, whenever you like.')
    children = 'OPML, Markdown and JSON exports, whenever you like.';
  if (label === 'Start in this browser' && !isIllustration) {
    if (tag === 'p') children = 'Browser edition · coming soon';
    else {
      props['aria-disabled'] = true;
      props.href = '#run';
    }
  }
  delete props.children;
  return createElement(tag, props, pageNode(children, section, isIllustration, name));
}

let body = '';
for (const [Component, id] of sections) {
  const content = pageNode(createElement(Component), id);
  const element = id === 'navigation' ? 'nav' : id === 'footer' ? 'footer' : 'section';
  body += renderToStaticMarkup(
    createElement(
      element,
      { id, className: 'site-section', ...(id === 'navigation' ? { 'aria-label': 'Main' } : {}) },
      content,
    ),
  );
}
const navEnd = body.indexOf('</nav>') + 6;
const footerStart = body.indexOf('<footer');
body =
  body.slice(0, navEnd) +
  '<main id="main">' +
  body.slice(navEnd, footerStart) +
  '</main>' +
  body.slice(footerStart);
const html = `<!doctype html>
<html lang="en" data-resolved-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brew — Your calm daily paper</title><meta name="description" content="An open-source reader for feeds and newsletters. Daily Brews, unlimited rules, app sync and scoped agent tools. Run your own on Node or Cloudflare."><meta name="theme-color" content="#f7f5f1"><link rel="canonical" href="https://tanzir71.github.io/brew/"><link rel="describedby" href="./llms.txt" type="text/plain"><link rel="alternate" href="./index.md" type="text/markdown"><meta property="og:title" content="Brew — Your calm daily paper"><meta property="og:description" content="Your feeds and newsletters, made into one calm daily paper."><meta property="og:image" content="https://tanzir71.github.io/brew/og.png"><link rel="icon" href="./favicon.svg" type="image/svg+xml"><link rel="preload" href="./fonts/newsreader-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="./fonts/instrument-sans-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="./site.css"><script src="./site.js" defer></script></head><body><a class="skip-link" href="#main">Skip to content</a>${body}<dialog id="privacy" aria-labelledby="privacy-title"><h2 id="privacy-title">Your reading stays yours.</h2><p>This site has no analytics, cookies or third-party requests. The demo uses canned data; nothing is saved after you close it.</p><form method="dialog"><button class="brew-button brew-button--secondary brew-button--md">Close</button></form></dialog></body></html>`;
const css = await compile(await readFile('website/site.css', 'utf8'), {
  base: path.resolve('website'),
  onDependency() {},
});
const candidates = [...html.matchAll(/class="([^"]+)"/g)].flatMap((match) =>
  match[1]!.split(/\s+/),
);
const stylesheet = optimize(css.build(candidates), { minify: true }).code.replaceAll('url(/fonts/', 'url(./fonts/');
const stylesheetVersion = createHash('sha256').update(stylesheet).digest('hex').slice(0, 12);
await writeFile('docs/site.css', stylesheet);
await writeFile('docs/index.html', html.replace('href="./site.css"', `href="./site.css?v=${stylesheetVersion}"`));
await copyFile('website/site.js', 'docs/site.js');
console.log('Rendered Figma landing with shared app tokens, fonts and wordmark.');
