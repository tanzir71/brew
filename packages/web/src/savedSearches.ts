import { parseReaderPage, readerPageHref } from '@brew/core/reader-pages';

export const savedSearchKey = 'brew:saved-searches';
export const savedSearchUndoKey = 'brew:saved-search-undo';
export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  href?: string;
}
export interface SavedSearchUndo {
  search: SavedSearch;
  index: number;
  expiresAt: number;
}
type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const isSearch = (item: unknown): item is SavedSearch => {
  if (!item || typeof item !== 'object') return false;
  const value = item as Partial<SavedSearch>;
  return (
    ['id', 'name', 'query'].every(
      (key) =>
        typeof value[key as keyof SavedSearch] === 'string' &&
        Boolean(value[key as keyof SavedSearch]?.trim()),
    ) &&
    (value.href === undefined || typeof value.href === 'string')
  );
};
export function readSavedSearches(storage: BrowserStorage): SavedSearch[] {
  const value: unknown = JSON.parse(storage.getItem(savedSearchKey) ?? '[]');
  if (
    !Array.isArray(value) ||
    !value.every(isSearch) ||
    new Set(value.map((item) => item.id)).size !== value.length
  )
    throw new Error('Invalid saved searches.');
  return value;
}
/** Stored URLs can only select this local search, never another page or origin. */
export function savedSearchHref(search: SavedSearch): string {
  if (search.href?.startsWith('/search?')) {
    try {
      const state = parseReaderPage(new URL(search.href, 'https://saved.brew.invalid'));
      if (state?.kind === 'search' && state.q === search.query.trim())
        return readerPageHref({ ...state, page: 1 });
    } catch {
      /* Old or invalid context falls back to the saved query. */
    }
  }
  return readerPageHref({
    kind: 'search',
    q: search.query,
    scope: 'all',
    page: 1,
    density: 'magazine',
    unread: false,
    sort: 'newest',
  });
}
export function saveSearch(storage: BrowserStorage, search: SavedSearch) {
  if (!isSearch(search)) throw new Error('Name and query are required.');
  const current = readSavedSearches(storage);
  if (current.some((item) => item.id === search.id)) throw new Error('Search already exists.');
  storage.setItem(savedSearchKey, JSON.stringify([...current, search]));
}
export function readSearchUndo(storage: BrowserStorage, now: number): SavedSearchUndo | null {
  const raw = storage.getItem(savedSearchUndoKey);
  if (raw === null) return null;
  const value = JSON.parse(raw) as Partial<SavedSearchUndo>;
  if (
    !isSearch(value?.search) ||
    !Number.isSafeInteger(value.index) ||
    value.index! < 0 ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt! <= now
  ) {
    storage.removeItem(savedSearchUndoKey);
    return null;
  }
  return value as SavedSearchUndo;
}
const sameSearch = (a: SavedSearch, b: SavedSearch) =>
  a.id === b.id && a.name === b.name && a.query === b.query && a.href === b.href;
export function deleteSearch(
  storage: BrowserStorage,
  session: BrowserStorage,
  expected: SavedSearch,
  now: number,
): SavedSearchUndo {
  const current = readSavedSearches(storage);
  const index = current.findIndex((item) => item.id === expected.id);
  if (index < 0 || !sameSearch(current[index]!, expected))
    throw new Error('This search changed. Close and reopen its actions before deleting.');
  const receipt = { search: current[index]!, index, expiresAt: now + 30_000 };
  // Persist recovery first. A failed storage write must never remove the bookmark.
  const previous = session.getItem(savedSearchUndoKey);
  session.setItem(savedSearchUndoKey, JSON.stringify(receipt));
  try {
    storage.setItem(
      savedSearchKey,
      JSON.stringify(current.filter((item) => item.id !== expected.id)),
    );
  } catch (error) {
    try {
      if (previous === null) session.removeItem(savedSearchUndoKey);
      else session.setItem(savedSearchUndoKey, previous);
    } catch {
      /* A retained receipt is harmless: Undo recognizes an existing search. */
    }
    throw error;
  }
  return receipt;
}
export function undoSearch(storage: BrowserStorage, session: BrowserStorage, now: number) {
  const receipt = readSearchUndo(session, now);
  if (!receipt) throw new Error('Undo has expired.');
  const current = readSavedSearches(storage);
  const existing = current.find((item) => item.id === receipt.search.id);
  if (existing && !sameSearch(existing, receipt.search))
    throw new Error('This search changed. Undo cannot replace the newer search.');
  if (!existing) {
    current.splice(Math.min(receipt.index, current.length), 0, receipt.search);
    storage.setItem(savedSearchKey, JSON.stringify(current));
  }
  // A retry after a failed acknowledgement is safe and preserves unrelated additions.
  try {
    session.removeItem(savedSearchUndoKey);
  } catch {
    /* Restoration is already durable. */
  }
  return receipt.search;
}
