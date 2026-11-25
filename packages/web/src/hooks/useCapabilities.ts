import { useQuery } from '@tanstack/react-query';
import { isCapabilities } from '@brew/core/types/capabilities';

export const capabilitiesQueryKey = ['capabilities'] as const;

export function useCapabilities() {
  const query = useQuery({
    queryKey: capabilitiesQueryKey,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/capabilities', {
        signal,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Could not load capabilities (HTTP ${response.status})`);
      const value: unknown = await response.json();
      if (!isCapabilities(value)) throw new Error('The server returned invalid capabilities');
      return value;
    },
  });
  // A failed refresh must not keep stale capability data available to gating controls.
  return query.isError ? { ...query, data: undefined } : query;
}
