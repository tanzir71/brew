import { describe, expect, it } from 'vitest';
import { parseHTML, DOMParser } from 'linkedom';
import Parser from 'rss-parser';
import { marked } from 'marked';
import {
  renderBrewAtom,
  renderBrewEmail,
  renderBrewJson,
  renderBrewJsonFeed,
  renderBrewMarkdown,
  renderBrewOutputs,
  renderBrewWeb,
} from '../../packages/core/src/brew-outputs.js';
import { newBrewSection } from '../../packages/core/src/composition-model.js';
import type {
  BrewSnapshot,
  BrewSnapshotItem,
  BrewSnapshotSection,
} from '../../packages/core/src/types/brew.js';
import type { BrewIssueDocument } from '../../packages/core/src/types/outputs.js';

const baseUrl = 'https://brew.example.test';
const info = { id: 7, name: 'Weekend & reading', updatedAt: '2026-11-01T00:00:00Z' };
const article = (values: Partial<BrewSnapshotItem> = {}): BrewSnapshotItem => ({
  id: 10,
  title: 'Slow [reading] <today> & "tomorrow"',
  url: 'https://publisher.test/story?a=1&b=2',
  author: 'An author',
  publishedAt: '2026-11-24T00:00:00Z',
  readAt: null,
  feedTitle: 'Publisher & friends',
  readTimeMinutes: 3,
  imageUrl: 'https://publisher.test/photo.jpg',
  summaryHtml: '<p>An <strong>editorial</strong> excerpt &amp; more.</p>',
  contentHtml:
    '<p>Full <em>normal</em> reading &amp; a <a href="/a/10">local letter</a>.</p><ul><li>One</li><li>Two</li></ul><blockquote>A quotation.</blockquote><pre><code>const x = `code`;</code></pre><table><tr><th>Column</th></tr><tr><td>A value</td></tr></table><img src="https://publisher.test/body.jpg" alt="Landscape">',
  ...values,
});
const section = (id: string, values: Partial<BrewSnapshotSection> = {}): BrewSnapshotSection => ({
  ...newBrewSection(id),
  title: `Section ${id}`,
  matchingItems: 1,
  eligibleItems: 1,
  items: [article()],
  depth: 'full',
  images: true,
  ...values,
});
const snapshot = (): BrewSnapshot => ({
  version: 2,
  id: 50,
  issueNumber: 42,
  brewConfigId: 7,
  configName: 'Weekend & reading',
  generatedAt: '2026-11-25T20:00:00Z',
  timezone: 'Asia/Dhaka',
  scrollPosition: 123,
  sections: [
    section('lead', { layout: 'lead' }),
    section('grid', { layout: 'grid', depth: 'title', images: false }),
    section('magazine', { layout: 'magazine', depth: 'excerpt' }),
    section('headlines', { layout: 'headlines', depth: 'brief', images: false }),
    section('note', {
      kind: 'note',
      items: [],
      noteHtml: '<p>Read <strong>slowly</strong>. <a href="/b/7">Archive</a></p>',
    }),
    section('divider', { kind: 'divider', items: [] }),
    section('empty', { items: [] }),
  ],
});
const body = (html: string) => parseHTML(html).document.body;

describe('portable frozen issue outputs', () => {
  it('shares the same renderers with preview, preserves section order/depth and never mutates the snapshot', () => {
    const value = snapshot();
    const frozen = structuredClone(value);
    const outputs = renderBrewOutputs(value, { baseUrl });
    expect(outputs.web).toBe(renderBrewWeb(value, { baseUrl }));
    expect(outputs.email).toBe(renderBrewEmail(value, { baseUrl }).html);
    expect(outputs.text).toBe(renderBrewEmail(value, { baseUrl }).text);
    expect(outputs.markdown).toBe(renderBrewMarkdown(value, { baseUrl }));
    expect(outputs.json).toBe(renderBrewJson(value, { baseUrl }));
    expect(outputs.feed).toBe(
      renderBrewAtom({ ...info, updatedAt: value.generatedAt }, [value], { baseUrl }),
    );
    expect(outputs.jsonFeed).toBe(renderBrewJsonFeed(info, [value], { baseUrl }));
    expect([...body(outputs.web).querySelectorAll('h2')].map((node) => node.textContent)).toEqual(
      value.sections.map((section) => section.title),
    );
    expect(body(outputs.web).querySelector('.layout-grid')!.textContent).not.toContain('excerpt');
    expect(body(outputs.web).querySelector('.layout-magazine')!.textContent).toContain(
      'editorial excerpt',
    );
    expect(body(outputs.web).querySelector('.layout-magazine')!.textContent).not.toContain(
      'Full normal',
    );
    expect(body(outputs.web).querySelector('.layout-headlines')!.textContent).not.toContain(
      'Full normal',
    );
    expect(outputs.web).toContain('Brief needs a configured AI provider.');
    expect(outputs.web).toContain('Thursday, 26 November 2026');
    expect(outputs.web).toContain('No matching stories for this issue.');
    expect(value).toEqual(frozen);
  });

  it('creates responsive web layouts with normal typography and matching light/dark colors', () => {
    const html = renderBrewWeb(snapshot());
    expect(html).toContain('name="viewport"');
    expect(html).toContain('@media(prefers-color-scheme:dark)');
    expect(html).toContain('font-style:normal!important');
    expect(html).toContain('@media(max-width:520px)');
    for (const layout of ['lead', 'magazine', 'grid', 'headlines'])
      expect(body(html).querySelector(`.layout-${layout}`)).not.toBeNull();
  });

  it('uses 600px presentation tables, inline content styles, paired colors and a readable plain-text alternative', () => {
    const { html, text } = renderBrewEmail(snapshot(), { baseUrl });
    const dom = body(html);
    expect(dom.querySelector('table[role="presentation"][width="600"]')).not.toBeNull();
    expect(html).toContain('<!--[if mso]>');
    expect(html).not.toMatch(/display:(?:grid|flex)|<article|<section/);
    expect(dom.querySelectorAll('h1,h2,h3,p,a,img,td').length).toBeGreaterThan(25);
    for (const element of dom.querySelectorAll('h1,h2,h3,p,a,img,td'))
      expect(element.hasAttribute('style'), element.outerHTML).toBe(true);
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain('[data-ogsc]');
    expect(html).toContain('border-color:');
    expect(dom.querySelector('em')!.getAttribute('style')).toContain('font-style:normal');
    expect(text).toContain(
      'Full normal reading & a local letter (https://brew.example.test/a/10).',
    );
    expect(text).toContain('- One\n- Two');
    expect(text).toContain('const x = `code`;');
    expect(text).not.toMatch(/<\/?(?:p|table|strong|img)\b|!\[|###|\*\*/);
  });

  it('produces actual Markdown with escaped titles, links, lists, quotes, code and images', () => {
    const markdown = renderBrewMarkdown(snapshot(), { baseUrl });
    expect(markdown).toContain('# Weekend & reading');
    expect(markdown).toContain(
      '### [Slow \\[reading\\] \\<today\\> & "tomorrow"](<https://publisher.test/story?a=1&b=2>)',
    );
    expect(markdown).toContain('**editorial**');
    expect(markdown).toContain('- One\n- Two');
    expect(markdown).toContain('> A quotation.');
    expect(markdown).toContain('```\nconst x = `code`;\n```');
    expect(markdown).toContain('![Landscape](<https://brew.example.test/api/img?src=');
    const rendered = body(`<html><body>${marked.parse(markdown, { async: false })}</body></html>`);
    expect(rendered.querySelector('h3')!.textContent).toBe(article().title);
    expect(rendered.querySelector('ul li')!.textContent).toBe('One');
    expect(rendered.querySelector('em')).toBeNull();
  });

  it('makes a deterministic content-only JSON twin and respects hidden bodies and images', () => {
    const value = snapshot();
    const rendered = renderBrewJson(value, { baseUrl });
    const doc = JSON.parse(rendered) as BrewIssueDocument;
    expect(doc.sections[0]!.items[0]!.contentHtml).toContain('Full');
    expect(doc.sections[1]!.items[0]).toMatchObject({ summaryHtml: null, imageUrl: null });
    expect(doc.sections[1]!.items[0]).not.toHaveProperty('contentHtml');
    expect(doc.sections[2]!.items[0]).not.toHaveProperty('contentHtml');
    expect(doc.sections[3]!.items[0]!.summaryHtml).toBeNull();
    expect(rendered).not.toMatch(
      /scrollPosition|readAt|sources|filter|matchingItems|eligibleItems|cleaning|delivery/,
    );
    value.scrollPosition = 999;
    value.sections[0]!.items[0]!.readAt = '2026-11-26T00:00:00Z';
    expect(renderBrewJson(value, { baseUrl })).toBe(rendered);
  });

  it('re-sanitizes frozen bodies, rejects active URLs and escapes content in every format', () => {
    const value = snapshot();
    const item = value.sections[0]!.items[0]!;
    item.title = 'Hostile <script>title</script>\u0000 😌';
    item.url = 'javascript:alert(1)';
    item.imageUrl = 'data:image/svg+xml,attack';
    item.summaryHtml = '<script>attack()</script><p onclick="attack()">Clean</p>';
    item.contentHtml =
      '<style>body{display:none}</style><p>Safe <a href="java&#x73;cript:alert(1)">label</a></p><iframe src="https://evil.test"></iframe><img src="https://evil.test/pixel" width="1" height="1"><img src="https://publisher.test/picture" onerror="attack()">';
    value.sections[4]!.noteHtml = '<svg onload="attack()"></svg><p>Safe note</p>';
    const outputs = renderBrewOutputs(value, { baseUrl });
    for (const html of [
      outputs.web,
      outputs.email,
      ...JSON.parse(outputs.jsonFeed).items.map(
        (item: { content_html: string }) => item.content_html,
      ),
    ]) {
      const dom = body(html.includes('<html') ? html : `<html><body>${html}</body></html>`);
      expect(dom.querySelector('script,iframe,svg,style,[onclick],[onerror]')).toBeNull();
      expect(dom.querySelector('a[href^="javascript:"]')).toBeNull();
      expect(dom.querySelector('h3')!.textContent).toContain('<script>title</script> 😌');
      for (const image of dom.querySelectorAll('img'))
        expect(image.getAttribute('src')).toMatch(/^https:\/\/brew.example.test\/api\/img\?/);
    }
    expect(outputs.feed).not.toContain('\u0000');
    expect(JSON.parse(outputs.json).sections[0].items[0].url).toBeNull();
  });

  it('keeps local URLs in email previews and twins, and resolves them for delivery', () => {
    const value = snapshot();
    value.sections[0]!.items[0]!.url = '/a/10';
    const outputs = renderBrewOutputs(value);
    for (const html of [outputs.web, outputs.email]) {
      expect(body(html).querySelector('h3 a')!.getAttribute('href')).toBe('/a/10');
      expect(body(html).querySelector('img')!.getAttribute('src')).toMatch(/^\/api\/img\?/);
    }
    expect(outputs.markdown).toContain('](</a/10>)');
    const content = JSON.parse(outputs.jsonFeed).items[0].content_html;
    const external = body(`<html><body>${content}</body></html>`);
    expect(external.querySelector('h3')!.querySelector('a')).toBeNull();
    expect(external.querySelector('img,a[href^="/"]')).toBeNull();
    expect(Object.values(outputs).join('')).not.toContain('https://brew.invalid');
    const delivered = body(renderBrewEmail(value, { baseUrl }).html);
    expect(delivered.querySelector('h3 a')!.getAttribute('href')).toBe(`${baseUrl}/a/10`);
    for (const image of delivered.querySelectorAll('img'))
      expect(image.getAttribute('src')).toMatch(/^https:\/\/brew.example.test\/api\/img\?/);
    for (const origin of [
      'javascript:alert(1)',
      'file:///tmp/brew',
      'https://user:secret@brew.test',
    ])
      expect(() => renderBrewOutputs(value, { baseUrl: origin })).toThrow();
  });

  it('preserves nested lists, literal code whitespace and content tables in Markdown', () => {
    const value = snapshot();
    value.sections[0]!.items[0]!.contentHtml =
      '<ul><li>Parent<ul><li>Child</li></ul></li></ul><pre><code>if (ready) {\n  run();\n\n\n  done();\n}</code></pre><p>Use <code>``literal``</code>.</p><table><tr><th>Name</th><th>Value</th></tr><tr><td>First</td><td>Second</td></tr></table>';
    const markdown = renderBrewMarkdown(value);
    const dom = body(`<html><body>${marked.parse(markdown, { async: false })}</body></html>`);
    expect(dom.querySelector('ul ul li')!.textContent).toBe('Child');
    expect(dom.querySelector('pre code')!.textContent).toBe(
      'if (ready) {\n  run();\n\n\n  done();\n}\n',
    );
    expect(dom.querySelector('p code')!.textContent).toBe('``literal``');
    expect(dom.querySelector('table tbody td')!.textContent).toBe('First');
    expect(renderBrewEmail(value).text).toContain('if (ready) {\n  run();\n\n\n  done();\n}');
  });

  it('honors images=false even for image HTML in old or imported frozen bodies and notes', () => {
    const value = snapshot();
    for (const section of value.sections) section.images = false;
    value.sections[4]!.noteHtml += '<img src="https://publisher.test/note.jpg">';
    const outputs = renderBrewOutputs(value, { baseUrl });
    expect(outputs.web).not.toContain('<img');
    expect(outputs.email).not.toContain('<img');
    expect(outputs.markdown).not.toContain('![');
    expect(
      JSON.parse(outputs.json).sections.every((s: BrewIssueDocument['sections'][number]) =>
        s.items.every((i) => i.imageUrl === null),
      ),
    ).toBe(true);
  });
});

describe('feeds of issues', () => {
  it('emits independently parseable Atom with required metadata and one entry per whole issue, newest first', async () => {
    const older = {
      ...snapshot(),
      issueNumber: 41,
      generatedAt: '2026-11-24T20:00:00Z',
      configName: 'Earlier name',
    };
    const latest = snapshot();
    const xml = renderBrewAtom(info, [older, latest], { baseUrl });
    const parsed = await new Parser().parseString(xml);
    expect(parsed.title).toBe(info.name);
    expect(parsed.feedUrl).toBe(`${baseUrl}/b/7.atom`);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items.map((item) => item.id)).toEqual([`${baseUrl}/b/7/42`, `${baseUrl}/b/7/41`]);
    expect(parsed.items[0]!.link).toBe(`${baseUrl}/b/7/42`);
    expect(parsed.items[0]!.content).toContain('<h2>Section note</h2>');
    expect(parsed.items[0]!.content).toContain('<h2>Section grid</h2>');
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    expect(dom.querySelector('feed > author > name')!.textContent).toBe(info.name);
    expect(dom.querySelector('feed > updated')!.textContent).toBe('2026-11-25T20:00:00.000Z');
    expect(xml).toBe(renderBrewAtom(info, [latest, older], { baseUrl }));
    expect(xml).toContain('&amp;');
  });

  it('emits JSON Feed 1.1 with the same issue identities, dates, absolute URLs and content', () => {
    const latest = snapshot();
    const older = { ...snapshot(), issueNumber: 41, generatedAt: '2026-11-24T20:00:00Z' };
    const json = JSON.parse(renderBrewJsonFeed(info, [older, latest], { baseUrl }));
    expect(json).toMatchObject({
      version: 'https://jsonfeed.org/version/1.1',
      title: info.name,
      home_page_url: `${baseUrl}/b/7`,
      feed_url: `${baseUrl}/b/7.json`,
      authors: [{ name: info.name }],
    });
    expect(json.items.map((item: { id: string }) => item.id)).toEqual([
      `${baseUrl}/b/7/42`,
      `${baseUrl}/b/7/41`,
    ]);
    expect(json.items[0]).toMatchObject({
      url: `${baseUrl}/b/7/42`,
      date_published: '2026-11-25T20:00:00.000Z',
      title: 'Weekend & reading · No. 42',
    });
    expect(json.items[0].content_html).toContain('<h2>Section note</h2>');
    expect(
      body(`<html><body>${json.items[0].content_html}</body></html>`)
        .querySelector('em')!
        .getAttribute('style'),
    ).toBe('font-style:normal');
    expect(json.items[0].content_text).toContain('Full normal reading & a local letter');
  });

  it('supports empty archives and rejects cross-Brew or duplicate issue input', async () => {
    const empty = renderBrewAtom(info, [], { baseUrl });
    expect((await new Parser().parseString(empty)).items).toEqual([]);
    expect(empty).toContain(`<updated>${info.updatedAt.replace('Z', '.000Z')}</updated>`);
    expect(JSON.parse(renderBrewJsonFeed(info, [])).items).toEqual([]);
    for (const render of [renderBrewAtom, renderBrewJsonFeed]) {
      expect(() => render(info, [snapshot(), snapshot()])).toThrow('distinct issues');
      expect(() => render({ ...info, id: 8 }, [snapshot()])).toThrow('same Brew');
    }
  });
});
