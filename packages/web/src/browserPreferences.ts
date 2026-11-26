export const preferenceOptions = {
  theme: ['system', 'light', 'dark'],
  images: ['proxy', 'direct'],
  landing: ['brew', 'reader'],
  openMode: ['overlay', 'pane'],
  readOnScroll: ['false', 'true'],
  agentMode: ['false', 'true'],
  font: ['serif', 'sans'],
  width: ['narrow', 'wide'],
  lineHeight: ['relaxed', 'compact'],
} as const;
export type Preference = keyof typeof preferenceOptions;
export type BrowserPreferences = { [K in Preference]: (typeof preferenceOptions)[K][number] };
export const preferenceDefaults: BrowserPreferences = {
  theme: 'system',
  images: 'proxy',
  landing: 'brew',
  openMode: 'overlay',
  readOnScroll: 'false',
  agentMode: 'false',
  font: 'serif',
  width: 'narrow',
  lineHeight: 'relaxed',
};
const keys = {
  theme: 'brew:theme',
  images: 'brew:direct-images',
  landing: 'brew:landing',
  openMode: 'brew:article-open-mode',
  readOnScroll: 'brew:mark-read-on-scroll',
  agentMode: 'brew:agent-mode',
} as const;
export const preferenceKeys: readonly string[] = [...Object.values(keys), 'brew:reading-prefs'];

/** A URL opts this view in without changing the browser's saved preference. */
export const agentModeEnabled = (search: string, saved: BrowserPreferences['agentMode']) =>
  new URLSearchParams(search).get('agent') === '1' || saved === 'true';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const valid = (key: Preference, value: unknown): value is string =>
  typeof value === 'string' && (preferenceOptions[key] as readonly string[]).includes(value);
function reading(storage: Storage): Record<string, unknown> {
  const value: unknown = JSON.parse(storage.getItem('brew:reading-prefs') ?? '{}');
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function readBrowserPreferences(storage: Storage): BrowserPreferences {
  const result = { ...preferenceDefaults };
  for (const [key, storageKey] of Object.entries(keys) as Array<[keyof typeof keys, string]>) {
    let value = storage.getItem(storageKey);
    if (key === 'images') value = value === 'true' ? 'direct' : 'proxy';
    if (valid(key, value)) Object.assign(result, { [key]: value });
  }
  let stored: Record<string, unknown>;
  try {
    stored = reading(storage);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    stored = {};
  }
  for (const key of ['font', 'width', 'lineHeight'] as const)
    if (valid(key, stored[key])) Object.assign(result, { [key]: stored[key] });
  return result;
}
export function saveBrowserPreference(storage: Storage, key: Preference, value: string): void {
  if (!valid(key, value)) throw new Error('Choose a valid preference.');
  if (key in keys) {
    storage.setItem(
      keys[key as keyof typeof keys],
      key === 'images' ? String(value === 'direct') : value,
    );
    return;
  }
  let current: Record<string, unknown>;
  try {
    current = reading(storage);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    current = {};
  }
  storage.setItem('brew:reading-prefs', JSON.stringify({ ...current, [key]: value }));
}
