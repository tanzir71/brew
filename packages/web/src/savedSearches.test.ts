import { describe, expect, it } from 'vitest';
import {
  deleteSearch,
  readSavedSearches,
  readSearchUndo,
  savedSearchHref,
  savedSearchKey,
  savedSearchUndoKey,
  saveSearch,
  undoSearch,
  type SavedSearch,
} from './savedSearches';

class MemoryStorage {
  values = new Map<string, string>();
  failWrite = false;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrite) throw new Error('Storage quota exceeded.');
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.failWrite) throw new Error('Storage unavailable.');
    this.values.delete(key);
  }
}
const first: SavedSearch = { id: 'first', name: 'Design', query: 'design' };
const second: SavedSearch = { id: 'second', name: 'Interface', query: 'interface' };
const third: SavedSearch = { id: 'third', name: 'Later addition', query: 'later' };

describe('browser saved-search bookmarks', () => {
  it('retains legacy bookmarks, validates storage and restricts stored navigation to the matching local search', () => {
    const storage = new MemoryStorage();
    saveSearch(storage, first);
    expect(readSavedSearches(storage)).toEqual([first]);
    expect(savedSearchHref(first)).toBe('/search?q=design');
    const href = '/search?q=design&scope=folder&folderId=7&page=2&sort=oldest&unread=true';
    expect(savedSearchHref({ ...first, href })).toBe(
      '/search?q=design&scope=folder&folderId=7&unread=true&sort=oldest',
    );
    for (const href of [
      'https://evil.test/search?q=design',
      '//evil.test/search?q=design',
      '/search?q=different',
      '/search?q=design&scope=folder',
      '/rules/1',
      'javascript:alert(1)',
    ])
      expect(savedSearchHref({ ...first, href })).toBe('/search?q=design');
    for (const value of [
      'null',
      '{}',
      '[null]',
      '[{"name":"orphan","query":"design"}]',
      JSON.stringify([first, first]),
    ]) {
      storage.setItem(savedSearchKey, value);
      expect(() => readSavedSearches(storage)).toThrow();
      expect(() => saveSearch(storage, second)).toThrow();
      expect(storage.getItem(savedSearchKey)).toBe(value);
    }
  });
  it('recovers a deleted bookmark from stored Undo after reload and preserves other-tab additions and original ordering', () => {
    const storage = new MemoryStorage();
    const session = new MemoryStorage();
    saveSearch(storage, first);
    saveSearch(storage, second);
    deleteSearch(storage, session, first, 1_000);
    expect(readSavedSearches(storage)).toEqual([second]);
    expect(readSearchUndo(session, 2_000)?.search).toEqual(first);
    // A different view/tab writes after the deletion; Undo reads current storage.
    saveSearch(storage, third);
    undoSearch(storage, session, 3_000);
    expect(readSavedSearches(storage)).toEqual([first, second, third]);
    expect(session.getItem(savedSearchUndoKey)).toBeNull();
  });
  it('rejects stale deletion and conflicting Undo without overwriting newer edits, and expires recovery', () => {
    const storage = new MemoryStorage();
    const session = new MemoryStorage();
    saveSearch(storage, first);
    expect(() => deleteSearch(storage, session, { ...first, name: 'Old name' }, 0)).toThrow(
      'changed',
    );
    expect(readSavedSearches(storage)).toEqual([first]);
    deleteSearch(storage, session, first, 1_000);
    saveSearch(storage, { ...first, name: 'New definition', query: 'newer' });
    expect(() => undoSearch(storage, session, 2_000)).toThrow('changed');
    expect(readSavedSearches(storage)[0]!.query).toBe('newer');
    expect(() => undoSearch(storage, session, 31_000)).toThrow('expired');
    expect(session.getItem(savedSearchUndoKey)).toBeNull();
    expect(readSavedSearches(storage)[0]!.query).toBe('newer');
  });
  it('never removes a bookmark when either durable Undo or the deletion write fails', () => {
    const storage = new MemoryStorage();
    const session = new MemoryStorage();
    saveSearch(storage, first);
    session.failWrite = true;
    expect(() => deleteSearch(storage, session, first, 1_000)).toThrow();
    expect(readSavedSearches(storage)).toEqual([first]);
    session.failWrite = false;
    storage.failWrite = true;
    expect(() => deleteSearch(storage, session, first, 1_000)).toThrow();
    expect(readSavedSearches(storage)).toEqual([first]);
    expect(session.getItem(savedSearchUndoKey)).toBeNull();
    expect(() => saveSearch(storage, second)).toThrow();
    expect(readSavedSearches(storage)).toEqual([first]);
  });
  it('retains recovery after a failed restore and makes a lost Undo acknowledgement safe to retry', () => {
    const storage = new MemoryStorage();
    const session = new MemoryStorage();
    saveSearch(storage, first);
    deleteSearch(storage, session, first, 1_000);
    storage.failWrite = true;
    expect(() => undoSearch(storage, session, 2_000)).toThrow();
    expect(readSavedSearches(storage)).toEqual([]);
    expect(readSearchUndo(session, 2_000)?.search).toEqual(first);
    storage.failWrite = false;
    session.failWrite = true;
    undoSearch(storage, session, 2_000);
    expect(readSavedSearches(storage)).toEqual([first]);
    expect(readSearchUndo(session, 2_000)?.search).toEqual(first);
    session.failWrite = false;
    undoSearch(storage, session, 3_000);
    expect(readSavedSearches(storage)).toEqual([first]);
    expect(session.getItem(savedSearchUndoKey)).toBeNull();
  });
});
