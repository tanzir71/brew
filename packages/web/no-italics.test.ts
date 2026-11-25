import { describe, expect, it } from 'vitest';
import {
  checkCss,
  checkMarkup,
  checkScript,
  italicUtility,
} from '../../scripts/lib/no-italics.mjs';

describe('normal typography policy', () => {
  it.each([
    'p { font-style: italic }',
    'p { font-style: oblique 12deg }',
    'p { font: italic 19px/31px Newsreader }',
    'p { font-style: /* no bypass */ italic !important }',
    String.raw`p { font-style: \69 talic }`,
  ])('rejects slanted CSS: %s', (css) => {
    expect(checkCss(css).problems).not.toEqual([]);
  });

  it('accepts normal fonts and quoted family names, and reports malformed CSS', () => {
    expect(checkCss('p { font-style: normal; font: 16px "Italic Family" }').problems).toEqual([]);
    expect(checkCss('p { font-style: normal').problems).not.toEqual([]);
  });

  it('requires an unconditional, universal important reset', () => {
    expect(
      checkCss('@layer base { *,::before,::after { font-style: normal !important } }').normalReset,
    ).toBe(true);
    for (const css of [
      'em { font-style: normal !important }',
      '* { font-style: normal }',
      '@media (min-width: 600px) { * { font-style: normal !important } }',
      '@supports (display: grid) { * { font-style: normal !important } }',
    ])
      expect(checkCss(css).normalReset).toBe(false);
  });

  it.each([
    'italic',
    'dark:hover:italic',
    '!italic',
    'italic!',
    'sm:[font-style:oblique]',
    '[font:italic_19px_Newsreader]',
  ])('rejects the %s utility', (value) => {
    expect(italicUtility(value)).toBe(true);
  });

  it('allows normal utilities and preserves semantic markup under the reset', () => {
    expect(italicUtility('not-italic font-serif [font-style:normal]')).toBe(false);
    const html =
      '<em>Emphasis</em><i>Term</i><cite>Source</cite><dfn>Definition</dfn><address>Address</address><var>x</var>';
    expect(checkMarkup(html, true)).toEqual([]);
    expect(checkMarkup(html, false)).toHaveLength(6);
    expect(checkScript('const text = <em>Emphasis</em>;', false)).toHaveLength(1);
    expect(checkScript('const text = <em>Emphasis</em>;', true)).toEqual([]);
  });

  it.each([
    '<p class="hover:italic">Text</p>',
    '<p style="font: oblique 16px serif">Text</p>',
    '<svg><text font-style="italic">Text</text></svg>',
    '<style>em { font-style: italic }</style>',
  ])('rejects authored markup styles: %s', (html) => {
    expect(checkMarkup(html, true)).not.toEqual([]);
  });

  it.each([
    'const text = <p className="italic" />;',
    'const text = <p className={active ? "italic" : "not-italic"} />;',
    'const className = "italic"; const text = <p className={className} />;',
    'const text = <p className={cx({ italic: active })} />;',
    'const style = { fontStyle: "italic" }; const text = <p style={style} />;',
    'const text = <p style={{ font: "oblique 16px serif" }} />;',
    'const text = <svg><text fontStyle="italic" /></svg>;',
    'element.className = "italic";',
    'element.classList.add("md:italic");',
    'element.style.fontStyle = "italic";',
    'element.style.setProperty("font-style", "italic");',
    'element.setAttribute("style", "font-style: oblique");',
    'element.innerHTML = `<em class="italic">Text</em>`;',
  ])('rejects JSX and script regressions: %s', (script) => {
    expect(checkScript(script, true)).not.toEqual([]);
  });

  it('accepts normal JSX and ignores prose outside style and class contexts', () => {
    expect(
      checkScript(
        'const text = <em className="not-italic" style={{ fontStyle: "normal" }}>The word italic</em>;',
        true,
      ),
    ).toEqual([]);
    expect(
      checkScript('const description = "italic"; const other = { style: "italic" };', true),
    ).toEqual([]);
  });
});
