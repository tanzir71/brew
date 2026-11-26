import { useCapabilities } from './useCapabilities';
import { useTextAlternates } from './useTextAlternates';

/** Saved-page twins are separate from unsaved form drafts and article content. */
export function usePageAlternates(path: string | null, title = 'Saved page state') {
  const caps = useCapabilities();
  useTextAlternates(caps.data?.outputs?.twins ? path : null, 10, title);
}
