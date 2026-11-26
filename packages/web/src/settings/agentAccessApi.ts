export async function agentAccessRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const value = await response.json().catch(() => null);
    throw new Error(value?.error ?? 'Could not reach Agent access. Try again.');
  }
  return response.json() as Promise<T>;
}
export const tokenKey = ['agent-tokens'];
export const activityKey = ['agent-activity'];
