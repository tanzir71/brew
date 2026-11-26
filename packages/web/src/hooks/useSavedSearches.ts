import { useCallback, useEffect, useState } from 'react';
import {
  savedSearchKey,
  savedSearchUndoKey,
  readSavedSearches,
  readSearchUndo,
  saveSearch,
  deleteSearch,
  undoSearch,
  type SavedSearch,
  type SavedSearchUndo,
} from '../savedSearches';

const changed = 'brew:saved-searches-changed';
function snapshot() {
  let searches: SavedSearch[] = [];
  let loadError = '';
  let receipt: SavedSearchUndo | null = null;
  try {
    searches = readSavedSearches(localStorage);
  } catch {
    loadError = 'Could not read saved searches in this browser. Check browser storage and retry.';
  }
  try {
    receipt = readSearchUndo(sessionStorage, Date.now());
  } catch {
    /* Unavailable recovery storage does not prevent reading existing bookmarks. */
  }
  return { searches, loadError, receipt };
}
export function useSavedSearches() {
  const [state, setState] = useState(snapshot);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = useCallback(() => setState(snapshot()), []);
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key === savedSearchKey || event.key === savedSearchUndoKey)
        refresh();
    };
    window.addEventListener('storage', storage);
    window.addEventListener(changed, refresh);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener(changed, refresh);
    };
  }, [refresh]);
  useEffect(() => {
    if (!state.receipt) return;
    const timer = window.setTimeout(refresh, Math.max(0, state.receipt.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [state.receipt, refresh]);
  const perform = (work: () => string) => {
    setError('');
    try {
      setMessage(work());
      window.dispatchEvent(new Event(changed));
      return true;
    } catch (failure) {
      refresh();
      setError(
        failure instanceof Error && /changed|expired/.test(failure.message)
          ? failure.message
          : 'Could not save this change in browser storage. Nothing was removed. Check storage and retry.',
      );
      return false;
    }
  };
  return {
    ...state,
    error,
    message,
    refresh,
    clearError: () => setError(''),
    dismiss: () => setMessage(''),
    save: (search: SavedSearch) =>
      perform(() => {
        saveSearch(localStorage, search);
        return `Saved search “${search.name}”.`;
      }),
    remove: (search: SavedSearch) =>
      perform(() => {
        deleteSearch(localStorage, sessionStorage, search, Date.now());
        return '';
      }),
    undo: () =>
      perform(() => {
        const search = undoSearch(localStorage, sessionStorage, Date.now());
        return `Restored saved search “${search.name}”.`;
      }),
  };
}
