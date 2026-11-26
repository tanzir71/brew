import { useCallback, useEffect, useState } from 'react';
import {
  preferenceDefaults,
  preferenceKeys,
  readBrowserPreferences,
  saveBrowserPreference,
  type BrowserPreferences,
  type Preference,
} from '../browserPreferences';

const changed = 'brew:preferences-changed';
export function initialBrowserPreferences(): BrowserPreferences {
  try {
    return readBrowserPreferences(localStorage);
  } catch {
    return { ...preferenceDefaults };
  }
}
export function useBrowserPreferences() {
  const [state, setState] = useState(() => {
    try {
      return { values: readBrowserPreferences(localStorage), readError: '' };
    } catch {
      return {
        values: { ...preferenceDefaults },
        readError: 'Could not read browser preferences. Check browser storage and retry.',
      };
    }
  });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = useCallback(() => {
    try {
      setState({ values: readBrowserPreferences(localStorage), readError: '' });
    } catch {
      setState((current) => ({
        ...current,
        readError: 'Could not read browser preferences. Check browser storage and retry.',
      }));
    }
  }, []);
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (event.key === null || preferenceKeys.includes(event.key)) refresh();
    };
    window.addEventListener('storage', storage);
    window.addEventListener(changed, refresh);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener(changed, refresh);
    };
  }, [refresh]);
  const save = (key: Preference, value: string, label: string): boolean => {
    setError('');
    setMessage('');
    try {
      saveBrowserPreference(localStorage, key, value);
      window.dispatchEvent(new Event(changed));
      setMessage(`${label} saved in this browser.`);
      return true;
    } catch {
      setError(
        `Could not save ${label.toLowerCase()}. Your saved preference was kept. Check browser storage and try again.`,
      );
      return false;
    }
  };
  return { ...state, save, refresh, error, message };
}
