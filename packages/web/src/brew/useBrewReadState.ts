import { useQuery } from '@tanstack/react-query';
import type { BrewReadState } from '@brew/core/types/legacy-brew';

export function useBrewReadState(id?: number) {
  return useQuery({
    queryKey: ['brew-state', id],
    enabled: id !== undefined,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/brews/${id}/state`, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load article state.');
      return response.json() as Promise<BrewReadState>;
    },
  });
}
