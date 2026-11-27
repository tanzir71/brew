import type { ReaderAccessSettings } from '@brew/core/reader-apps';

export const readerAccessKey = ['reader-access'] as const;
type ReaderSetup = { available: false } | { available: true; settings: ReaderAccessSettings };
export async function loadReaderAccess(signal?: AbortSignal): Promise<ReaderSetup> {
  const response = await fetch('/api/reader-access', {
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (response.status === 501) return { available: false };
  if (!response.ok) throw new Error('Could not load app access. Try again.');
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Could not load app access. Try again.');
  const value = raw as Record<string, unknown>;
  if (
    typeof value.enabled !== 'boolean' ||
    !(value.username === null || typeof value.username === 'string') ||
    typeof value.serverUrl !== 'string' ||
    typeof value.googleReaderUrl !== 'string' ||
    typeof value.feverUrl !== 'string' ||
    ![value.serverUrl, value.googleReaderUrl, value.feverUrl].every((url) =>
      /^https?:$/.test(new URL(url).protocol),
    )
  )
    throw new Error('Could not load app access. Try again.');
  // Only this safe projection enters the query cache. Passwords never do.
  return {
    available: true,
    settings: {
      enabled: value.enabled,
      username: value.username,
      serverUrl: value.serverUrl,
      googleReaderUrl: value.googleReaderUrl,
      feverUrl: value.feverUrl,
    },
  };
}
export async function changeReaderAccess(username?: string) {
  const response = await fetch('/api/reader-access', {
    method: username === undefined ? 'DELETE' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(username === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(username === undefined ? {} : { body: JSON.stringify({ username }) }),
  });
  if (!response.ok)
    throw new Error('Could not update app access. Check the connection and try again.');
  const raw: unknown = await response.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Could not confirm the app access change. Check access again.');
  const value = raw as Record<string, unknown>;
  if (username === undefined) {
    if (value.ok !== true)
      throw new Error('Could not confirm that app access was disabled. Check access again.');
    return null;
  }
  if (
    typeof value.username !== 'string' ||
    typeof value.password !== 'string' ||
    !/^[a-z\d_-]{32}$/i.test(value.password)
  )
    throw new Error(
      'Could not retrieve the generated password. Check access and generate another password.',
    );
  return { username: value.username, password: value.password };
}
