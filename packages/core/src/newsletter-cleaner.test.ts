import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  cleanNewsletterHtml,
  cleanNewsletterUrl,
  newsletterTextHtml,
} from './newsletter-cleaner.js';
import { newsletterCorpus } from '../test/newsletter-corpus.js';

describe('newsletter cleaner', () => {
  it.each(newsletterCorpus)('cleans $name while preserving editorial text', (fixture) => {
    const result = cleanNewsletterHtml(fixture.html, fixture.selectors);
    const root = parseHTML(`<div>${result.html}</div>`).document;
    expect(root.textContent ?? root.querySelector('div')?.textContent).toContain(
      'Keep this story.',
    );
    expect(result.cleaning).toEqual({
      trackers: fixture.trackers,
      sponsorBlocks: fixture.sponsors,
      footerTrimmed: !!fixture.footer,
    });
    expect(result.html).not.toMatch(
      /secretadtoken|utm_|mc_eid|track\/click|ss\/c\/|<script|<form|<svg|onclick|onload|Hidden preview/,
    );
    for (const image of root.querySelectorAll('img'))
      expect(image.getAttribute('src')).toMatch(/^\/api\/img\?src=/);
    if (fixture.name === 'publisher hero photo') expect(result.html).toContain('alt="Forest"');
    if (fixture.name === 'editorial sponsor mention')
      expect(result.html).toContain('supports public archives');
  });

  it('unwraps only embedded HTTP targets, strips subscriber identifiers, and never keeps opaque redirects', () => {
    expect(
      cleanNewsletterUrl(
        'https://click.sendgrid.net/ls/click?url=https%3A%2F%2Fjournal.test%2Fa%3Fchapter%3D2%26_hsenc%3Dsecret',
      ),
    ).toEqual({ url: 'https://journal.test/a?chapter=2', tracked: true });
    expect(
      cleanNewsletterUrl('https://click.sendgrid.net/ls/click?url=javascript%3Aalert(1)').url,
    ).toBeNull();
    expect(
      cleanNewsletterUrl(
        'https://click.sendgrid.net/ls/click?url=https%3A%2F%2Fuser%3Apass%40journal.test',
      ).url,
    ).toBeNull();
    expect(cleanNewsletterUrl('https://click.sendgrid.net/ls/click?upn=opaque')).toEqual({
      url: null,
      tracked: true,
    });
  });

  it('captures the clean archive before trimming chrome and resolves relative editorial assets', () => {
    const result = cleanNewsletterHtml(
      '<p><a href="https://journal.test/issues/1?utm_source=mail">View in browser</a></p><p>Essay <a href="../essay">here</a></p><img src="/hero.jpg">',
    );
    expect(result.archiveUrl).toBe('https://journal.test/issues/1');
    expect(result.html).toContain('https://journal.test/essay');
    expect(result.html).toContain('src=https%3A%2F%2Fjournal.test%2Fhero.jpg');
    expect(result.html).not.toContain('View in browser');
    expect(result.cleaning.footerTrimmed).toBe(true);
  });

  it('drops unresolvable assets, active URLs, hidden blocks, and preserves editorial unsubscribe text', () => {
    const result = cleanNewsletterHtml(
      '<p>We explain how to <a href="https://journal.test/unsubscribe">unsubscribe</a> from noisy services.</p><img src="cid:private"><img src="/unknown"><a href="javascript:evil()">Link</a><div hidden>Secret preview</div><iframe src="https://evil.test"></iframe>',
    );
    expect(result.html).toContain('We explain how to unsubscribe from noisy services.');
    expect(result.html).not.toMatch(/<img|javascript:|iframe|Secret preview|href=/);
  });

  it('validates per-sender selectors, limits pathological configuration, and handles empty/hostile documents', () => {
    expect(() => cleanNewsletterHtml('<p>Story</p>', { sponsorSelectors: ['['] })).toThrow(
      'Invalid newsletter cleaning selector',
    );
    expect(() => cleanNewsletterHtml('', { footerSelectors: Array(21).fill('p') })).toThrow(
      'up to 20',
    );
    expect(cleanNewsletterHtml('<img width="1" src="https://journal.test/pixel">').html).toBeNull();
    expect(
      cleanNewsletterHtml(
        '<html><head><base href="https://evil.test"></head><body><p>Body</p></body></html>',
      ).html,
    ).toContain('Body');
    expect(newsletterTextHtml('<script>& story')).toBe('<pre>&lt;script&gt;&amp; story</pre>');
  });
});
