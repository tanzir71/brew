import { describe, expect, it } from 'vitest';
import {
  preferenceDefaults,
  readBrowserPreferences,
  saveBrowserPreference,
} from './browserPreferences';

function storage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
describe('browser preference persistence', () => {
  it('reads the existing keys and legacy JSON without writes or new defaults in storage', () => {
    const s = storage({
      'brew:theme': 'dark',
      'brew:direct-images': 'true',
      'brew:landing': 'reader',
      'brew:article-open-mode': 'pane',
      'brew:mark-read-on-scroll': 'true',
      'brew:reading-prefs': '{"font":"sans","width":"wide","lineHeight":"compact"}',
    });
    const before = [...s.data];
    expect(readBrowserPreferences(s)).toEqual({
      theme: 'dark',
      images: 'direct',
      landing: 'reader',
      openMode: 'pane',
      readOnScroll: 'true',
      font: 'sans',
      width: 'wide',
      lineHeight: 'compact',
    });
    expect([...s.data]).toEqual(before);
  });
  it.each(['[', 'null', '["sans"]', '{"font":"unknown","width":9,"lineHeight":false}'])(
    'uses safe defaults for invalid reading preferences %s without replacing saved data',
    (raw) => {
      const s = storage({ 'brew:reading-prefs': raw, 'brew:theme': 'invalid' });
      expect(readBrowserPreferences(s)).toEqual(preferenceDefaults);
      expect(s.getItem('brew:reading-prefs')).toBe(raw);
    },
  );
  it('merges each typography edit with the latest stored fields and preserves unrelated data', () => {
    const s = storage({
      'brew:reading-prefs': '{"font":"sans","future":"kept"}',
      unrelated: 'untouched',
    });
    saveBrowserPreference(s, 'width', 'wide');
    saveBrowserPreference(s, 'lineHeight', 'compact');
    saveBrowserPreference(s, 'font', 'serif');
    expect(JSON.parse(s.getItem('brew:reading-prefs')!)).toEqual({
      font: 'serif',
      future: 'kept',
      width: 'wide',
      lineHeight: 'compact',
    });
    expect(s.getItem('unrelated')).toBe('untouched');
  });
  it('rejects invalid choices before a write and surfaces read/write storage failures', () => {
    const s = storage({ 'brew:theme': 'dark' });
    expect(() => saveBrowserPreference(s, 'theme', 'sepia')).toThrow('valid preference');
    const failing = {
      ...s,
      setItem: () => {
        throw new Error('Quota exceeded');
      },
    };
    expect(() => saveBrowserPreference(failing, 'theme', 'light')).toThrow('Quota exceeded');
    expect(s.getItem('brew:theme')).toBe('dark');
    const unreadable = {
      ...s,
      getItem: () => {
        throw new Error('Storage blocked');
      },
    };
    expect(() => readBrowserPreferences(unreadable)).toThrow('Storage blocked');
    expect(() => saveBrowserPreference(unreadable, 'font', 'sans')).toThrow('Storage blocked');
    expect([...s.data]).toEqual([['brew:theme', 'dark']]);
  });
});
