export async function newsletterJson<T>(
  url: string,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const value = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(value?.error ?? 'Could not load newsletters. Try again.');
  }
  return response.json() as Promise<T>;
}
export const newsletterRefreshKeys = [
  'newsletter-overview',
  'newsletter-letters',
  'newsletter-letter',
  'reader-navigation',
  'brew-configs',
  'brew-composition',
  'brew-preview',
];
