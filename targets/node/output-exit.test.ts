import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOMParser, parseHTML } from 'linkedom';
import Parser from 'rss-parser';
import { renderBrewAtom, renderBrewEmail } from '../../packages/core/src/brew-outputs.js';
import {
  newsletterOutputFixture,
  outputFixtures,
  outputOrigin,
  readingOutputFixture,
} from '../../packages/core/test/output-fixtures.js';

const golden = (name: string) =>
  fileURLToPath(new URL(`./test/fixtures/outputs/${name}`, import.meta.url));

describe('M11 output exit review', () => {
  it.each(outputFixtures)(
    '$name email locks down full HTML and plain text from frozen content',
    async ({ name, make }) => {
      const issue = make();
      const original = structuredClone(issue);
      const mail = renderBrewEmail(issue, { baseUrl: outputOrigin });
      await expect(mail.html).toMatchFileSnapshot(golden(`${name}.html`));
      await expect(mail.text).toMatchFileSnapshot(golden(`${name}.txt`));
      const { document } = parseHTML(mail.html);
      expect(document.querySelector('table[role="presentation"][width="600"]')).not.toBeNull();
      expect(document.querySelector('script,iframe,object,embed,[onclick],[onerror]')).toBeNull();
      for (const element of document.body.querySelectorAll('*')) {
        expect(element.getAttribute('style') ?? '').not.toMatch(/font-style:\s*(italic|oblique)/);
        for (const name of ['src', 'href']) {
          const url = element.getAttribute(name);
          if (url) expect(url).toMatch(/^https:\/\//);
        }
      }
      expect(mail.text).not.toMatch(/<\/?(?:p|table|strong|img)\b|\*\*|!\[/);
      expect(issue).toEqual(original);
      if (name === 'reading') {
        expect(mail.text).toContain('Thursday, 26 November 2026 · No. 8');
        expect(mail.text).toContain('context (https://brew.example.test/a/81)');
        expect(mail.text).toContain('বাংলা · 日本語 · 😌');
        expect(mail.text).toContain('Notebook | Remember');
      }
      if (name === 'newsletters') {
        expect(document.querySelectorAll('h3')).toHaveLength(20);
        expect(mail.html).not.toMatch(/secretadtoken|metrics\.test|utm_source|mc_eid/);
        expect(mail.text.match(/Keep this story/g)!.length).toBeGreaterThan(15);
      }
    },
  );

  // RFC 4287 §§3.2–3.3, 4.1.1–4.1.3, 4.2.6–4.2.7:
  // https://www.rfc-editor.org/rfc/rfc4287.html
  // rss-parser uses a strict XML parser, independently of the rendering DOM.
  it.each([false, true])(
    'validates required Atom metadata, dates, IDs, authors and escaped HTML (empty=%s)',
    async (empty) => {
      const issues = empty ? [] : [newsletterOutputFixture(), readingOutputFixture()];
      const xml = renderBrewAtom(
        { id: 17, name: 'Weekend & reading', updatedAt: '2026-11-01T00:00:00Z' },
        issues,
        { baseUrl: outputOrigin },
      );
      await expect(xml).toMatchFileSnapshot(golden(empty ? 'empty.atom' : 'issues.atom'));
      const parsed = await new Parser().parseString(xml);
      expect(parsed.items).toHaveLength(issues.length);
      const root = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
      expect(root.localName).toBe('feed');
      expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2005/Atom');
      const children = (element: Element, name: string) =>
        [...element.children].filter((child) => child.localName === name);
      const one = (element: Element, name: string) => {
        const found = children(element, name);
        expect(found, `${element.localName}/${name}`).toHaveLength(1);
        return found[0]!;
      };
      const date = (value: string) => {
        expect(value).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/);
        expect(Number.isFinite(Date.parse(value))).toBe(true);
      };
      const id = (element: Element) => {
        const value = one(element, 'id').textContent!;
        expect(new URL(value).protocol).toBe('https:');
        expect(value).not.toMatch(/\s/);
        return value;
      };
      expect(id(root)).toBe(`${outputOrigin}/b/17`);
      expect(one(root, 'title').textContent).toBe('Weekend & reading');
      date(one(root, 'updated').textContent!);
      expect(one(one(root, 'author'), 'name').textContent).toBe('Weekend & reading');
      const links = children(root, 'link');
      expect(links.filter((link) => link.getAttribute('rel') === 'self')).toHaveLength(1);
      expect(links.find((link) => link.getAttribute('rel') === 'self')!.getAttribute('href')).toBe(
        `${outputOrigin}/b/17.atom`,
      );
      const entries = children(root, 'entry');
      const ids: string[] = [];
      for (const entry of entries) {
        ids.push(id(entry));
        expect(one(entry, 'title').children).toHaveLength(0);
        date(one(entry, 'updated').textContent!);
        date(one(entry, 'published').textContent!);
        expect(one(entry, 'link').getAttribute('href')).toBe(ids.at(-1));
        const content = one(entry, 'content');
        expect(content.getAttribute('type')).toBe('html');
        expect(content.children).toHaveLength(0);
        const body = parseHTML(`<html><body>${content.textContent}</body></html>`).document.body;
        expect(body.querySelector('h2')).not.toBeNull();
        expect(body.querySelector('script,iframe,object,embed,[onclick],[onerror]')).toBeNull();
      }
      expect(new Set(ids).size).toBe(entries.length);
      expect(ids).toEqual(parsed.items.map((entry) => entry.id));
    },
  );
});
