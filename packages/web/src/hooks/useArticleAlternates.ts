import { useCapabilities } from './useCapabilities';
import { useTextAlternates } from './useTextAlternates';

export function useArticleAlternates(id: number | null) {
  const caps = useCapabilities();
  useTextAlternates(id && caps.data?.outputs?.twins ? `/a/${id}` : null, 20);
}
